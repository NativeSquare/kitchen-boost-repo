import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import { pricingSnapshot } from "../../table/orders";
import {
  type OrderWithDetail,
  type TenantRole,
  confirmTenantOrderPayment,
  customerQuery,
  getCustomerOwnOrderWithDetail,
  listCustomerOwnOrdersForTenant,
  listTenantLiveOrders,
  listTenantTerminalOrders,
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
