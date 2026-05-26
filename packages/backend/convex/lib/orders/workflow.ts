import { v } from "convex/values";
import { pricingSnapshot } from "../../table/orders";
import { confirmTenantOrderPayment, tenantMutation } from "../tenancy";
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
