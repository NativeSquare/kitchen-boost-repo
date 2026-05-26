import { v } from "convex/values";
import { internalMutation } from "../../_generated/server";
import { getPaymentByIntentId, logAudit } from "../tenancy";
import { withIdempotence } from "../webhooks";

/**
 * 2.5-E — Chargeback monitoring: the Stripe `charge.dispute.created` webhook
 * ingestion (PRD 30 §6 + Q30-Q6 acté 2026-05-23, payment CONTEXT "Chargeback").
 *
 * V1 is MONITORING ONLY. KB is **NOT merchant of record**, so KB:
 *  - does NOT relay evidence to Stripe via API,
 *  - does NOT store any evidence,
 *  - ships NO KB Admin UI (V2 = email auto resto + badge KB Admin, V3 = full
 *    tooling).
 * The resto answers the dispute through its OWN native Stripe Dashboard (already
 * tooled: evidence form, timeline, upload). The single KB side effect is an ops
 * Slack alert so Alex can ping the resto by WhatsApp with the recap he needs:
 * **ID cmd / montant / motif / deadline**.
 *
 * The HTTP route is wired in `convex/http.ts`; it verifies the `Stripe-Signature`
 * HMAC on the RAW body (POC #1 ✅: `await request.text()` before any parse,
 * `crypto.subtle`, default Convex runtime — no `"use node"`) and then calls this
 * internal mutation. The work is wrapped in `withIdempotence(ctx, "stripe",
 * eventId, …)` so the SAME `(stripe, eventId)` redelivered (Stripe delivers
 * at-least-once) alerts + audits exactly ONCE — the mutation returns whether the
 * alert should fire, and the httpAction posts to Slack only on first delivery (a
 * network call belongs in an action, not a mutation).
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * SYSTEM-SIDE: INTERNAL (never exposed publicly), carries NO user-supplied tenant
 * id. The disputed payment is resolved STRUCTURALLY from the Stripe-supplied
 * `paymentIntentId` (the only handle the event carries) through the sanctioned
 * `lib/tenancy` seam (`getPaymentByIntentId`); the resolved row carries its own
 * `tenantId`, so an event can only ever surface the tenant that actually owns
 * that payment — there is no tenant id to forge. An unknown intent is a clean
 * no-op (still marked processed so a replay stays a no-op). No raw `ctx.db` here.
 *
 * ── Audit (issue #49) ─────────────────────────────────────────────────────────
 * Each first-seen dispute writes ONE `auditLog` row, system-side (`actorRole:
 * "system"`, no `actorUserId`) — the dispute is opened by the cardholder's bank,
 * not a KB human. It records the tenant + the disputed payment + the recap.
 */

/**
 * Outcome of applying one `charge.dispute.created` event (drives the Slack alert
 * posted by the httpAction). `alert: false` ⇒ duplicate delivery (idempotent
 * no-op) OR unknown paymentIntent ⇒ no Slack post.
 */
export type DisputeCreatedOutcome = {
  /** false ⇒ duplicate delivery OR unknown intent (no Slack alert). */
  alert: boolean;
  /** The resolved tenant id, when `alert`. */
  tenantId?: string;
  /** The disputed order id (the "ID cmd" of the recap), when `alert`. */
  orderId?: string;
  /** Disputed amount in the smallest currency unit (cts), echoed for the recap. */
  amount?: number;
  /** ISO-4217 currency of the dispute. */
  currency?: string;
  /** Stripe dispute `reason` (the "motif" of the recap). */
  reason?: string;
  /** `evidence_details.due_by` — the resto's deadline (epoch seconds). */
  dueBy?: number;
};

/**
 * Apply a Stripe `charge.dispute.created` event, exactly once per
 * `(stripe, eventId)`. Resolves the disputed payment by its Stripe-supplied
 * `paymentIntentId`; an unknown intent is a no-op. Returns whether an ops Slack
 * alert should be posted plus the recap fields (ID cmd / montant / motif /
 * deadline). MONITORING ONLY: the `payments` row is left untouched (KB does not
 * intervene on a dispute).
 *
 * INTERNAL — called only from the verified webhook `httpAction` in `http.ts`.
 */
export const applyDisputeCreated = internalMutation({
  args: {
    eventId: v.string(),
    paymentIntentId: v.string(),
    amount: v.number(),
    currency: v.string(),
    reason: v.string(),
    dueBy: v.optional(v.number()),
  },
  returns: v.object({
    alert: v.boolean(),
    tenantId: v.optional(v.string()),
    orderId: v.optional(v.string()),
    amount: v.optional(v.number()),
    currency: v.optional(v.string()),
    reason: v.optional(v.string()),
    dueBy: v.optional(v.number()),
  }),
  handler: async (ctx, args): Promise<DisputeCreatedOutcome> => {
    let outcome: DisputeCreatedOutcome = { alert: false };
    await withIdempotence(ctx, "stripe", args.eventId, async () => {
      const payment = await getPaymentByIntentId(ctx, args.paymentIntentId);
      // Unknown intent → nothing to monitor (still marked processed so a replay
      // of this stray event is a clean no-op).
      if (payment === null) return;

      // MONITORING ONLY: do NOT touch the payment lifecycle, do NOT store any
      // evidence — the resto answers via its native Stripe Dashboard.
      await logAudit(ctx, {
        actorRole: "system",
        action: "payment.dispute.created",
        tenantId: payment.tenantId,
        targetType: "payment",
        targetId: payment._id,
        metadata: {
          paymentIntentId: payment.paymentIntentId,
          orderId: payment.orderId,
          amount: args.amount,
          currency: args.currency,
          reason: args.reason,
          dueBy: args.dueBy,
        },
      });

      outcome = {
        alert: true,
        tenantId: payment.tenantId,
        orderId: payment.orderId,
        amount: args.amount,
        currency: args.currency,
        reason: args.reason,
        dueBy: args.dueBy,
      };
    });
    return outcome;
  },
});
