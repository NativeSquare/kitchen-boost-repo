import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import { internalMutation } from "../../_generated/server";
import { pricingSnapshot, refusalReason } from "../../table/orders";
import {
  channelAvailabilityFrom,
  planTransactionalSends,
} from "../notifications";
import {
  type OrderWithDetail,
  type TenantRole,
  autoExpireTenantOrder,
  confirmTenantOrderPayment,
  customerQuery,
  getCustomerOwnOrderWithDetail,
  getTenantOrder,
  insertTenantNotificationEvent,
  listCustomerOwnOrdersForTenant,
  listTenantLiveOrders,
  listTenantTerminalOrders,
  readCustomerAggregateFields,
  readCustomerFicheByUser,
  requireTenantOrder,
  tenantMutation,
  tenantQuery,
  transitionTenantOrder,
} from "../tenancy";
import { withIdempotence } from "../webhooks";

/**
 * 2.3-C — `confirmPayment`: the ORDER-SIDE handler of "le paiement confirme la
 * commande", the junction Orders ↔ Payment ↔ Customer Data (PRD 10 §10/§11, PRD
 * 20 §5, PRD 30 §3, client-ordering + kb-orders + customer-data CONTEXTs, ADR
 * 0010).
 *
 * On a CONFIRMED payment (the Stripe `payment_intent.succeeded` event relayed by
 * chantier 2.5 — there is NO real Stripe call here, that frontier is 2.5/#42),
 * this is the single mutation that, in ONE Convex transaction (atomicity):
 *  - transitions the order `en attente de paiement → nouvelle` (it becomes visible
 *    to the resto / drives the KB Orders beep) — guarded by the state machine, so
 *    a confirm on any other state is REJECTED, never silently re-applied;
 *  - stamps `paidAt` and FREEZES the `pricingSnapshot` (the immutable charged
 *    amount, latched from 2.4);
 *  - appends the `nouvelle` `orderEvents` (the workflow audit starts here);
 *  - increments `customerOrdersPerTenant` (totalOrders / lastOrderAt / ltv) for
 *    the order's OWN `(customerId, tenantId)` — the MOAT aggregates, never a raw
 *    customer exposed to the resto.
 *
 * ── Idempotence (foundation 1.x-F, NOT re-implemented here) ───────────────────
 * External providers deliver AT LEAST ONCE: the same confirmation may arrive
 * twice. The body runs inside `withIdempotence(ctx, "stripe", eventId, …)`, so a
 * replayed `(stripe, eventId)` is a clean no-op — no second transition, no
 * double-counted stats. The dedup mark + the side effects commit/roll back
 * together (same transaction): if the transition throws (e.g. a wrong-state
 * order), nothing is marked processed and nothing is written.
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * A `tenantMutation` keyed on the EXPLICIT order's `tenantId` (resolved by the 2.5
 * webhook httpAction from the PaymentIntent metadata before invoking this). The
 * store re-checks the order belongs to `tenantId` (NOT_FOUND for a foreign id), so
 * a cross-tenant `orderId` can never be confirmed or have its stats written. All
 * persistence goes through the sanctioned `lib/tenancy` seam — no raw `ctx.db`
 * here (`no-untenanted-query`). Identity flows only via the wrapper's
 * `getCurrentActor` (ADR 0011). Audited (a payment-confirming write). Ships a
 * cross-tenant fuzz suite.
 */
export const confirmPayment = tenantMutation()({
  args: {
    orderId: v.id("orders"),
    // The provider's own event id — the `(stripe, eventId)` dedup key (1.x-F).
    eventId: v.string(),
    // The frozen pricing (computed by 2.4, charged by 2.5) — latched onto the order.
    pricingSnapshot,
  },
  audit: true,
  action: "order.confirmPayment",
  handler: async (ctx, args): Promise<void> => {
    await withIdempotence(ctx, "stripe", args.eventId, async () => {
      await confirmTenantOrderPayment(
        ctx,
        ctx.tenantId,
        args.orderId,
        args.pricingSnapshot,
        ctx.actor.userId,
      );
    });
  },
});

/**
 * 2.3-D — the RESTO WORKFLOW state machine consumed by the KB Orders app (PRD 20
 * §5, kb-orders CONTEXT). Three guarded transitions + the kitchen/customer read
 * queries.
 *
 * ── RBAC (multi-tenant CONTEXT) ───────────────────────────────────────────────
 * The kitchen workflow is OPERATIONAL: the transitions + the resto reads allow
 * `kb_manager` + `staff` (a cuisinier on a tablet works the queue). `kb_admin`
 * passes via the root override. The customer reads require the GLOBAL `customer`
 * role and are SELF-SCOPED (`customerQuery`). The issue body does NOT differentiate
 * staff vs manager for these transitions — both may perform them.
 *
 * ── State machine (PRD 20 §5) ─────────────────────────────────────────────────
 * Each transition is GUARDED by `assertLegalTransition` (inside the store seam): an
 * illegal edge (state jump, re-transition of a terminal order) THROWS and writes
 * nothing, and each legal transition appends a timestamped `orderEvents` row (#30).
 *   acknowledge   : nouvelle       → en préparation
 *   markPrepared  : en préparation → prête
 *   markHandedOff : prête          → remise  ── then, for `pickup` only, → collectée
 * `markHandedOff` adapts the terminal to the order's `mode` (frozen at payment):
 *   - delivery   → stays `remise`; `livrée` is driven later by Uber Direct events (2.6).
 *   - pickup     → archived immediately at handoff (`remise` then `collectée`).
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * Every function is a tenancy wrapper keyed on the explicit `tenantId`; the store
 * re-checks order ownership (foreign id → NOT_FOUND / null), so a cross-tenant id is
 * unreachable. No raw `ctx.db` here (`no-untenanted-query`). Identity flows only via
 * the wrapper's `getCurrentActor` (ADR 0011). The transitions are audited (workflow
 * writes). Ships a cross-tenant fuzz suite over every exported function.
 */

/** The kitchen workflow + resto reads allow operational staff (KB Orders). */
const OPERATIONAL_ALLOW: { allow: TenantRole[] } = {
  allow: ["kb_manager", "staff"],
};

// ---------------------------------------------------------------------------
// transitions — kb_manager + staff, each appends an orderEvents (PRD 20 §5)
// ---------------------------------------------------------------------------

/** `nouvelle → en préparation` — the cuisinier accepts the order (stops the beep). */
export const acknowledge = tenantMutation(OPERATIONAL_ALLOW)({
  args: { orderId: v.id("orders") },
  audit: true,
  action: "order.acknowledge",
  handler: async (ctx, args): Promise<void> => {
    await transitionTenantOrder(
      ctx,
      ctx.tenantId,
      args.orderId,
      "en préparation",
      { actorUserId: ctx.actor.userId },
    );
  },
});

/** `en préparation → prête` — the order is ready to be handed off. */
export const markPrepared = tenantMutation(OPERATIONAL_ALLOW)({
  args: { orderId: v.id("orders") },
  audit: true,
  action: "order.markPrepared",
  handler: async (ctx, args): Promise<void> => {
    await transitionTenantOrder(ctx, ctx.tenantId, args.orderId, "prête", {
      actorUserId: ctx.actor.userId,
    });
  },
});

/**
 * `prête → remise` — hand the order off. For `pickup` (click & collect) the order
 * is terminal at handoff, so it immediately advances `remise → collectée` (archived,
 * both transitions audited). For `delivery` it stops at `remise`; `livrée` is driven
 * later by the Uber Direct courier events (chantier 2.6).
 */
export const markHandedOff = tenantMutation(OPERATIONAL_ALLOW)({
  args: { orderId: v.id("orders") },
  audit: true,
  action: "order.markHandedOff",
  handler: async (ctx, args): Promise<void> => {
    // Resolve the mode (frozen at payment) BEFORE the first transition — its guard
    // also re-checks tenant ownership, so a foreign / wrong-state id is rejected.
    const order = await requireTenantOrder(ctx, ctx.tenantId, args.orderId);
    await transitionTenantOrder(ctx, ctx.tenantId, args.orderId, "remise", {
      actorUserId: ctx.actor.userId,
    });
    if (order.mode === "pickup") {
      await transitionTenantOrder(
        ctx,
        ctx.tenantId,
        args.orderId,
        "collectée",
        { actorUserId: ctx.actor.userId },
      );
    }
  },
});

/**
 * 2.3-E — `refuse`: the resto refuses a `nouvelle` order and the refund is emitted
 * IMMEDIATELY (PRD 20 §6 + 20-Q9 acté "remboursement IMMÉDIAT"; PRD 30 §5;
 * kb-orders CONTEXT "Refusal"; payment CONTEXT "Refund": "Orders est le trigger,
 * Payment fournit la mécanique"). Operational action — `kb_manager` + `staff`.
 *
 * ── One atomic transaction (all-or-nothing) ──────────────────────────────────
 * A Convex mutation is a single transaction, so the three effects below commit or
 * roll back together — there is never a refusal without the refund order emitted,
 * nor a refund order emitted without the client notification queued:
 *  1. transition `nouvelle → refusée` (TERMINAL) THROUGH the state machine guard
 *     (`assertLegalTransition`): only `nouvelle → refusée` is legal, so refusing an
 *     order in any other state — or re-refusing an already-terminal one — throws and
 *     writes nothing (no double refund). The transition stamps `refusedAt` and
 *     appends the `refusée` `orderEvents` row carrying the closed-set `reason`.
 *  2. TRIGGER the 2.5 payment-domain refund MECHANISM (#49). The `refusée`
 *     `orderEvents` row written in step 1 IS the refund order (tenant + order +
 *     reason + time); Orders is the trigger, Payment runs the Stripe refund. The
 *     actual `POST /refunds` lives in an action (`lib/stripe.refund.refundOnRefusal`),
 *     SCHEDULED here via `ctx.scheduler.runAfter(0, …)` so it runs AFTER this
 *     mutation commits (the Stripe network call belongs in an action, not a mutation,
 *     and the refusal must be durably committed before we refund). The refund action
 *     resolves the `payments` row itself (tenant-scoped) and is idempotent (a row
 *     already `refunded` is a no-op — no double refund).
 *  3. EMIT THE CLIENT NOTIFICATION (`refund_issued`, PRD 80 §1 trigger 6): plan the
 *     transactional sends from the customer's 2.1 reachability (ADR 0012, never
 *     duplicated) and JOURNAL each as `queued`. The actual push/email send is 2.7 —
 *     here we only emit the event; an unreachable customer simply yields no send.
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * `tenantMutation` keyed on the explicit `tenantId`; `transitionTenantOrder` /
 * `requireTenantOrder` re-check ownership (a foreign `orderId` → NOT_FOUND, no
 * cross-tenant write) and an unauthorized actor is rejected (Forbidden) by the
 * wrapper. No raw `ctx.db` here (`no-untenanted-query`) — every write goes through
 * the sanctioned `lib/tenancy` seam. Identity only via `getCurrentActor` (ADR 0011).
 * Audited (a sensitive write — refund-triggering). Ships a cross-tenant fuzz suite.
 */
export const refuse = tenantMutation(OPERATIONAL_ALLOW)({
  args: {
    orderId: v.id("orders"),
    // Closed set (PRD 20 §6) — the validator rejects an invented reason.
    reason: refusalReason,
  },
  audit: true,
  action: "order.refuse",
  handler: async (ctx, args): Promise<void> => {
    // 1 + 2 — transition `nouvelle → refusée` (state machine guard) AND emit the
    // refund order: the refusée orderEvent carrying the reason IS that refund order
    // toward 2.5 (Orders is the trigger; the Stripe refund is chantier 2.5 / #42).
    await transitionTenantOrder(ctx, ctx.tenantId, args.orderId, "refusée", {
      reason: args.reason,
      actorUserId: ctx.actor.userId,
    });

    // 3 — emit the client `refund_issued` notification (sending is 2.7). Resolve the
    // order through the same tenant-scoped seam (ownership re-checked) to route its
    // customer; same transaction as the refusal, so it cannot diverge from it.
    const order = await requireTenantOrder(ctx, ctx.tenantId, args.orderId);
    const fields = await readCustomerAggregateFields(ctx, order.customerId);
    const availability = channelAvailabilityFrom(fields ?? {});
    const sends = planTransactionalSends("refund_issued", availability);
    for (const send of sends) {
      await insertTenantNotificationEvent(ctx, ctx.tenantId, {
        customerId: order.customerId,
        trigger: "refund_issued",
        category: send.category,
        channel: send.channel,
        status: "queued", // planned, not yet dispatched (the transport is 2.7)
      });
    }

    // 4 — TRIGGER the Stripe refund (#49). Scheduled to run AFTER this mutation
    // commits: the Stripe network call belongs in an action, and the refusal must be
    // durable before we refund. The action is idempotent (a re-run is a no-op).
    await ctx.scheduler.runAfter(
      0,
      internal.lib.stripe.refund.refundOnRefusal,
      { tenantId: ctx.tenantId, orderId: args.orderId },
    );
  },
});

/**
 * #404 — `expireIfNotAcknowledged`: the SYSTEM-SIDE tick of the 5-min timeout
 * d'acceptation (PRD 20 §6b + ADR 0016 + kb-orders CONTEXT "Cmd manquée"),
 * armed at `confirmTenantOrderPayment` (the moment the order becomes
 * `nouvelle`, BOTH pickup and gated-delivery paths). At fire time, in ONE
 * Convex transaction:
 *
 *  1. THE IDEMPOTENCE GUARD (`autoExpireTenantOrder` re-reads the CURRENT
 *     status): if the order is still `nouvelle` ⇒ transition `nouvelle →
 *     auto_expired` (TERMINAL, distinct from `refusée` — ADR 0016 signaux
 *     orthogonaux: refus humain = signal business, auto_expired = signal
 *     opérationnel) + append a system-side `auto_expired` `orderEvents` row.
 *     If the cuisinier already accepted / refused (or the tick fires twice on
 *     an order already `auto_expired`) ⇒ clean no-op — NO transition, NO
 *     refund, NO push. This idempotence IS the whole reason ADR 0016 chose a
 *     single scheduled tick checking current state at fire time; a double
 *     refund would be a regression. Cross-tenant: the seam's
 *     `getTenantOrder` ownership check makes a tick armed on tenant A
 *     unreachable on tenant B (a hardening, not a real scenario — the
 *     scheduler is always armed with the correct tenant id).
 *
 *  2. ON `{ expired: true }` (and ONLY then): EMIT the client `refund_issued`
 *     notification (PRD 80 §1 trigger 6 — same trigger as the human refus, the
 *     template differentiation motif/neutre is the 2.7 sender's concern, not
 *     this slice). Plan the transactional sends from the customer's 2.1
 *     reachability (ADR 0012, never duplicated) and journal each as `queued`
 *     (the actual transport is 2.7). An unreachable customer simply yields no
 *     send — atomic with the transition (all-or-nothing in one tx).
 *
 *  3. ON `{ expired: true }` (and ONLY then): SCHEDULE the Stripe refund via
 *     the EXISTING 2.5-D action `refundOnRefusal` (REUSED — same code path as
 *     the human refus per the issue body: "réutilise le même helper / la même
 *     mutation backend"). Scheduled to run AFTER this mutation commits: the
 *     Stripe network call belongs in an action, and the `auto_expired`
 *     transition must be durable before we refund. The action is itself
 *     idempotent — a `payments` row already `refunded` skips the Stripe call.
 *
 * SYSTEM-SIDE `internalMutation` — never exposed publicly. The tenant id is
 * NOT user-supplied: the scheduler armed by `confirmTenantOrderPayment`
 * passes the tenant id it had already resolved structurally from the
 * `payments` row (ADR 0010). The seam helpers re-check ownership, so a tick
 * pointing at a foreign tenant's order is a clean no-op (defence in depth).
 */
export const expireIfNotAcknowledged = internalMutation({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  returns: v.object({ expired: v.boolean() }),
  handler: async (ctx, args): Promise<{ expired: boolean }> => {
    // 1 — idempotent transition through the seam (the heart of #404).
    const { expired } = await autoExpireTenantOrder(
      ctx,
      args.tenantId,
      args.orderId,
    );
    if (!expired) return { expired: false };

    // 2 — emit the client `refund_issued` notification (sending is 2.7). Resolve
    // the customer through the same tenant-scoped seam to route the notif.
    // `getTenantOrder` returns null for a cross-tenant id, but we already
    // expired ⇒ the order belongs to `tenantId` (NEVER null here in practice).
    const order = await getTenantOrder(ctx, args.tenantId, args.orderId);
    if (order !== null) {
      const fields = await readCustomerAggregateFields(ctx, order.customerId);
      const availability = channelAvailabilityFrom(fields ?? {});
      const sends = planTransactionalSends("refund_issued", availability);
      for (const send of sends) {
        await insertTenantNotificationEvent(ctx, args.tenantId, {
          customerId: order.customerId,
          trigger: "refund_issued",
          category: send.category,
          channel: send.channel,
          status: "queued",
        });
      }
    }

    // 3 — TRIGGER the Stripe refund — REUSE the existing 2.5-D `refundOnRefusal`
    // action (same code path as the human refus per the issue: "réutilise le
    // même helper / la même mutation backend"). Scheduled to run AFTER this
    // mutation commits; the action is idempotent (a row already `refunded`
    // skips the Stripe call, so a re-trigger refunds exactly once).
    await ctx.scheduler.runAfter(
      0,
      internal.lib.stripe.refund.refundOnRefusal,
      { tenantId: args.tenantId, orderId: args.orderId },
    );

    return { expired: true };
  },
});

// ---------------------------------------------------------------------------
// kitchen reads — kb_manager + staff (KB Orders accueil + historique)
// ---------------------------------------------------------------------------

/**
 * The KB Orders LIVE queue (PRD 20 §2): the calling tenant's orders the kitchen is
 * actively working, newest first. NEVER includes `en attente de paiement` (invisible
 * until paid) nor the terminal states (those live in the history).
 */
export const tenantOrders = tenantQuery(OPERATIONAL_ALLOW)({
  args: {},
  handler: async (ctx): Promise<Doc<"orders">[]> =>
    listTenantLiveOrders(ctx, ctx.tenantId),
});

/**
 * The KB Orders HISTORY (PRD 20 §8): the calling tenant's TERMINAL orders
 * (livrée / collectée / refusée), newest first.
 */
export const tenantOrderHistory = tenantQuery(OPERATIONAL_ALLOW)({
  args: {},
  handler: async (ctx): Promise<Doc<"orders">[]> =>
    listTenantTerminalOrders(ctx, ctx.tenantId),
});

// ---------------------------------------------------------------------------
// customer reads — global role `customer`, self-scoped (PWA "mes commandes")
// ---------------------------------------------------------------------------

/**
 * The current customer's OWN orders at the tenant, newest first (the PWA "mes
 * commandes"). Self-scoped: resolves the caller's OWN fiche from `ctx.actor.userId`,
 * so only the caller's orders are returned. A customer with no fiche yet (never
 * checked out) gets an empty list — no provisioning side effect in a read.
 */
export const myOrders = customerQuery({
  args: {},
  handler: async (ctx): Promise<Doc<"orders">[]> => {
    const fiche = await readCustomerFicheByUser(ctx, ctx.actor.userId);
    if (fiche === null) return [];
    return listCustomerOwnOrdersForTenant(ctx, ctx.tenantId, fiche._id);
  },
});

/**
 * One of the current customer's OWN orders WITH detail (frozen items + events), or
 * `null`. Self-scoped: returns the order only if it belongs to the caller's own
 * fiche at this tenant — a foreign id (or an order owned by another customer) reads
 * as `null` (no existence oracle).
 */
export const myOrder = customerQuery({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args): Promise<OrderWithDetail | null> => {
    const fiche = await readCustomerFicheByUser(ctx, ctx.actor.userId);
    if (fiche === null) return null;
    return getCustomerOwnOrderWithDetail(
      ctx,
      ctx.tenantId,
      fiche._id,
      args.orderId,
    );
  },
});
