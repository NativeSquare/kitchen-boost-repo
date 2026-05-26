import { ConvexError, v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { DeliveryIncidentType } from "../../table/deliveries";
import {
  getTenantDeliveryByOrder,
  patchTenantDelivery,
  tenantMutation,
} from "../tenancy";

/**
 * 2.6-D — the PURE delivery-incident policy (delivery CONTEXT Q40-Q6→Q40-Q14
 * acted, PRD 40 §5). No I/O: it is the deterministic decision layer the webhook
 * state machine (`applyUberWebhookEvent`) and the course executor consume to act
 * on the 4 ACTED incident cases. The cases are taken VERBATIM from the CONTEXT —
 * none is invented, and there is no 5th case.
 *
 * The 4 acted cases (delivery CONTEXT):
 *  - **Cas A `refused_post_payment`** (Create Delivery refusal / refusal webhook
 *    after payment) ⇒ auto-refund immédiat via 2.5 + push "désolé, livraison non
 *    disponible, tu as été remboursé". Cuisine NON notifiée (la cmd n'a jamais été
 *    transmise au KDS) ⇒ `suppressKds`.
 *  - **Cas B `courier_cancel_before_pickup`** (silent re-dispatch) ⇒ PASSIF: KB
 *    relaie le nouveau courier sans message d'incident. Push "petit retard ⏰"
 *    UNIQUEMENT si la dérive d'ETA cumulée DÉPASSE 10 min. Pas de refund. This case
 *    has no `DeliveryIncidentType` (it leaves no incident record) — it is decided by
 *    `resolveCourierDrift`, not `incidentRefundPolicy`.
 *  - **Cas C `incident_after_pickup`** (`canceled`/`failed` après pickup) ⇒ refund
 *    auto TOTAL immédiat via 2.5 + push "incident livraison, tu as été remboursé".
 *    KB n'intervient PAS dans la réclamation Uber/resto (Article 2 contrat).
 *  - **Cas D `customer_absent`** (`returned`) ⇒ PAS de refund auto (client en
 *    faute) + push "le coursier ne t'a pas trouvé, contacte le resto" + bouton
 *    refund MANUEL exposé au resto (geste commercial à sa discrétion).
 *
 * The "incident push" identifiers below are NOT part of the closed transactional
 * trigger taxonomy (ADR 0006): the customer-absent and the delivery-unavailable /
 * incident messages are dedicated client messages, surfaced as SIGNALS the Phase 3
 * fronts consume (the issue: "on expose les signaux/flags") — they are not written
 * as `notificationEvents` rows (which would require a closed trigger). The
 * `uber_course_failed` closed trigger is still emitted by the pure `mapWebhookEvent`
 * (slice C) for Cas A/C; this signal is the ADDITIONAL dedicated push copy.
 */

/** The dedicated client push a case raises (NOT a closed transactional trigger). */
export type IncidentPush =
  /** Cas A — "désolé, livraison non disponible, tu as été remboursé". */
  | "delivery_unavailable"
  /** Cas C — "incident livraison, tu as été remboursé, désolé". */
  | "delivery_incident"
  /** Cas D — "le coursier ne t'a pas trouvé, contacte le resto au [num]". */
  | "customer_absent";

/** The acted policy for one persisted incident case. */
export type IncidentRefundPolicy = {
  /** Auto-refund total immédiat, triggered VIA 2.5 (2.6 never refunds itself). */
  autoRefund: boolean;
  /** Expose the resto's discretionary manual-refund button (Cas D only). */
  manualRefundAvailable: boolean;
  /** The dedicated client push copy for the case. */
  incidentPush: IncidentPush;
  /** Suppress any kitchen (KDS) signal — the cmd was never transmitted (Cas A). */
  suppressKds: boolean;
};

/**
 * The static, acted policy for each persisted incident type (delivery CONTEXT
 * Q40-Q6→Q40-Q14). A closed `switch` over the 3 `DeliveryIncidentType` literals —
 * exhaustive, so a new literal would be a compile error rather than a silent gap.
 */
export function incidentRefundPolicy(
  incidentType: DeliveryIncidentType,
): IncidentRefundPolicy {
  switch (incidentType) {
    case "refused_post_payment":
      // Cas A — refund auto + cuisine non notifiée (jamais transmise au KDS).
      return {
        autoRefund: true,
        manualRefundAvailable: false,
        incidentPush: "delivery_unavailable",
        suppressKds: true,
      };
    case "incident_after_pickup":
      // Cas C — refund auto total; KB n'ouvre PAS de réclamation Uber/resto.
      return {
        autoRefund: true,
        manualRefundAvailable: false,
        incidentPush: "delivery_incident",
        suppressKds: false,
      };
    case "customer_absent":
      // Cas D — PAS de refund auto (client en faute) + bouton refund manuel resto.
      return {
        autoRefund: false,
        manualRefundAvailable: true,
        incidentPush: "customer_absent",
        suppressKds: false,
      };
  }
}

/** The cumulative ETA-drift threshold past which the "petit retard ⏰" push fires. */
export const PETIT_RETARD_THRESHOLD_MS = 10 * 60 * 1000; // 10 min (delivery CONTEXT)

/** The prior ETA state read from the delivery row (Cas B drift accumulation). */
export type PriorEta = {
  pickupEta?: number;
  dropoffEta?: number;
  cumulativeEtaDriftMs?: number;
};

/** The (possibly new) ETA carried by an `event.courier_update` (Cas B). */
export type EtaUpdate = {
  pickupEta?: number;
  dropoffEta?: number;
};

/** The outcome of accumulating a Cas B re-dispatch ETA slip. */
export type CourierDriftResult = {
  /** The new cumulative positive slip to persist on the delivery row. */
  cumulativeEtaDriftMs: number;
  /**
   * Whether THIS update crosses the 10-min threshold for the first time — the
   * one-shot signal that fires the "petit retard ⏰" push. Already-over updates do
   * NOT re-fire (no spam): the push only fires on the crossing.
   */
  petitRetard: boolean;
};

/**
 * Cas B — accumulate the positive ETA slip of a silent re-dispatch and decide
 * whether the "petit retard ⏰" push fires (delivery CONTEXT: push UNIQUEMENT si la
 * dérive d'ETA cumulée DÉPASSE 10 min). The slip is `max(0, newEta - priorEta)`
 * (a courier that becomes EARLIER never reduces the cumulative drift). Pickup ETA
 * is preferred; dropoff ETA is used when no pickup ETA is present. The push is a
 * STRICT `> threshold` ONE-SHOT crossing — it fires only when the drift was at or
 * below the threshold before and is strictly above it after.
 */
export function resolveCourierDrift(
  prior: PriorEta,
  update: EtaUpdate,
): CourierDriftResult {
  const priorCumulative = prior.cumulativeEtaDriftMs ?? 0;

  // Prefer the pickup-ETA slip; fall back to the dropoff-ETA slip.
  let slip = 0;
  if (prior.pickupEta !== undefined && update.pickupEta !== undefined) {
    slip = Math.max(0, update.pickupEta - prior.pickupEta);
  } else if (
    prior.dropoffEta !== undefined &&
    update.dropoffEta !== undefined
  ) {
    slip = Math.max(0, update.dropoffEta - prior.dropoffEta);
  }

  const cumulativeEtaDriftMs = priorCumulative + slip;
  // One-shot: fire only on the crossing (was ≤ threshold, now strictly >).
  const petitRetard =
    priorCumulative <= PETIT_RETARD_THRESHOLD_MS &&
    cumulativeEtaDriftMs > PETIT_RETARD_THRESHOLD_MS;

  return { cumulativeEtaDriftMs, petitRetard };
}

/**
 * 2.6-D — `triggerManualRefund`: the resto's DISCRETIONARY manual refund for a
 * `customer_absent` (Cas D) — the geste commercial the CONTEXT exposes as a "bouton
 * refund manuel" to the resto (Q40-Q13 acted). There is NO auto-refund for Cas D
 * (the client is at fault); the resto MAY choose to refund anyway. Allowed only
 * when the delivery is FLAGGED `customer_absent` + `manualRefundAvailable` — a
 * refund on any other state throws (no arbitrary refund), so this can never become
 * a backdoor to the auto-refund path.
 *
 * Like every other refund in V1, the Stripe refund is EXECUTED BY 2.5
 * (`refundAbortedOrder`, #49 — total refund on the connected account + pull the
 * order out of KB Orders + client push + `logAudit`). 2.6 only TRIGGERS it, exactly
 * as the incident state machine does for the auto cases — 2.6 never refunds itself.
 * Scheduled via `ctx.scheduler.runAfter(0, …)` so the Stripe network call runs in
 * the payment domain's action after this mutation commits. The button is cleared
 * (`manualRefundAvailable: false`) in the same transaction so it cannot be clicked
 * twice (the refund action is itself idempotent — no double refund regardless).
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * A `tenantMutation` (default allow `kb_manager` — the owner decides the geste
 * commercial) keyed on the explicit `tenantId`; the delivery is resolved through
 * the sanctioned `lib/tenancy` seam (a foreign `orderId` resolves to no row ⇒
 * NOT_FOUND, no cross-tenant refund) and an unauthorized actor is rejected by the
 * wrapper. Identity only via `getCurrentActor` (ADR 0011). No raw `ctx.db`.
 * Audited (`audit: true`) — the refund itself is also audited inside 2.5.
 */
export const triggerManualRefund = tenantMutation()({
  args: { orderId: v.id("orders") },
  audit: true,
  action: "delivery.manual_refund",
  returns: v.object({ triggered: v.boolean() }),
  handler: async (ctx, args): Promise<{ triggered: boolean }> => {
    const delivery = await getTenantDeliveryByOrder(
      ctx,
      ctx.tenantId,
      args.orderId,
    );
    // The manual refund is ONLY for a customer-absent delivery whose button is
    // still available — anything else is rejected (no arbitrary refund).
    if (
      delivery === null ||
      delivery.incidentType !== "customer_absent" ||
      delivery.manualRefundAvailable !== true
    ) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "No manual refund available for this delivery.",
      });
    }

    // Consume the button (one-shot) and TRIGGER the 2.5 refund mechanism (#49).
    await patchTenantDelivery(ctx, ctx.tenantId, delivery._id, {
      manualRefundAvailable: false,
    });
    await ctx.scheduler.runAfter(
      0,
      internal.lib.stripe.refund.refundAbortedOrder,
      { tenantId: ctx.tenantId, orderId: args.orderId as Id<"orders"> },
    );
    return { triggered: true };
  },
});
