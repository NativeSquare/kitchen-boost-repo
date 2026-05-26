import { v } from "convex/values";
import { internal } from "../../_generated/api";
import { internalMutation } from "../../_generated/server";
import {
  confirmTenantOrderPayment,
  getPaymentByIntentId,
  insertTenantDelivery,
  recordPaymentFailure,
  requireTenantOrder,
  setPaymentStatus,
} from "../tenancy";
import { withIdempotence } from "../webhooks";

/**
 * 2.5-B — the SYSTEM-side payment webhook mutations dispatched by the verified
 * `stripeWebhook` httpAction (PRD 30 §3/§4, payment CONTEXT, STACK §2.7). These
 * are INTERNAL (never exposed publicly): the webhook httpAction verifies the HMAC
 * on the raw body, resolves the Stripe event, and schedules these via
 * `ctx.scheduler.runAfter(0, …)`.
 *
 * ── Idempotence (foundation 1.x-F) ────────────────────────────────────────────
 * Stripe delivers AT LEAST ONCE. Each handler runs inside
 * `withIdempotence(ctx, "stripe", eventId, …)`, so a replayed `(stripe, eventId)`
 * is a clean no-op — no double-confirm, no double-seeded course, no double-counted
 * failure. The dedup mark + the side effects commit/roll back together.
 *
 * ── Isolation (ADR 0010) ──────────────────────────────────────────────────────
 * The webhook carries NO user-supplied tenant id: the tenant is resolved
 * STRUCTURALLY from the Stripe-supplied `paymentIntentId` (the `payments` row
 * carries its own `tenantId`), so these can only ever touch the owning tenant. All
 * persistence goes through the sanctioned `lib/tenancy` seam — no raw `ctx.db`
 * here (`no-untenanted-query`). There is no actor (system side): the order
 * confirmation is stamped with no `actorUserId`.
 */

/** Past this many distinct failures the payment is abandoned (PRD 30 §4). */
const MAX_PAYMENT_ATTEMPTS = 3;

/**
 * `payment_intent.succeeded` — the payment cleared on the resto's connected
 * account. In ONE transaction (idempotent per `(stripe, eventId)`):
 *  1. resolve the local `payments` row from the Stripe `paymentIntentId` (an
 *     unknown intent is a clean no-op);
 *  2. mark the payment `succeeded`;
 *  3. CONFIRM the order — `en attente de paiement → nouvelle`, stamping `paidAt`
 *     and FREEZING the pricing snapshot RECEIVED from Pricing (#20), via the
 *     orders seam (which also increments the customer MOAT aggregates);
 *  4. SEED the delivery course (a `pending` `deliveries` row) — an Uber course for
 *     a `delivery` order, a click & collect row for a `pickup` order (no Uber
 *     dispatch) — then SCHEDULE the chantier 2.6-C executor
 *     (`createCourseOnPaymentConfirmed`) to make the real Uber Course once this
 *     mutation commits (a no-op for click & collect). 2.6 owns the executor; this
 *     slice only EMITS the course toward the delivery domain (the Uber HTTP call
 *     belongs in an action, not here), exactly as 2.3-E emits the refund toward
 *     Payment.
 *
 * `applied` is false on a duplicate delivery OR an unknown payment intent.
 */
export const confirmPaymentSucceeded = internalMutation({
  args: { eventId: v.string(), paymentIntentId: v.string() },
  returns: v.object({ applied: v.boolean() }),
  handler: async (ctx, args): Promise<{ applied: boolean }> => {
    let applied = false;
    await withIdempotence(ctx, "stripe", args.eventId, async () => {
      const payment = await getPaymentByIntentId(ctx, args.paymentIntentId);
      // Unknown intent → nothing to confirm (still marked processed so a replay of
      // this stray event is a clean no-op).
      if (payment === null) return;

      await setPaymentStatus(ctx, payment._id, "succeeded");

      // Confirm the order (transition + paidAt + frozen pricing + MOAT stats). No
      // actor — this is a system-side write.
      await confirmTenantOrderPayment(
        ctx,
        payment.tenantId,
        payment.orderId,
        payment.pricingSnapshot,
      );

      // Seed the fulfilment course toward the delivery domain (2.6-C executes it).
      const order = await requireTenantOrder(
        ctx,
        payment.tenantId,
        payment.orderId,
      );
      await insertTenantDelivery(ctx, payment.tenantId, {
        orderId: payment.orderId,
        mode: order.mode === "pickup" ? "click_collect" : "delivery",
        status: "pending",
      });

      // Hand off to the delivery domain (2.6-C): once committed, create the real
      // Uber Course (a no-op for click & collect). Scheduled AFTER this mutation
      // commits so the seeded row is visible; the Uber HTTP call belongs in an
      // action, not this mutation. 2.6 owns the executor — 2.5 only emits.
      await ctx.scheduler.runAfter(
        0,
        internal.lib.delivery.course.createCourseOnPaymentConfirmed,
        { tenantId: payment.tenantId, orderId: payment.orderId },
      );

      applied = true;
    });
    return { applied };
  },
});

/**
 * `payment_intent.payment_failed` — the charge failed. In ONE transaction
 * (idempotent per `(stripe, eventId)`): mark the payment `payment_failed` and
 * count the attempt. The order is NEVER confirmed here (it stays `en attente de
 * paiement`); after `MAX_PAYMENT_ATTEMPTS` distinct failures the payment is
 * ABANDONED (PRD 30 §4 — 3 retries max, no order created). The client notification
 * + retry link is a notifications concern (2.7); this slice records the state and
 * reports whether the payment is now abandoned.
 *
 * `applied` is false on a duplicate delivery OR an unknown payment intent.
 */
export const recordPaymentFailed = internalMutation({
  args: { eventId: v.string(), paymentIntentId: v.string() },
  returns: v.object({ applied: v.boolean(), abandoned: v.boolean() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ applied: boolean; abandoned: boolean }> => {
    let applied = false;
    let abandoned = false;
    await withIdempotence(ctx, "stripe", args.eventId, async () => {
      const payment = await getPaymentByIntentId(ctx, args.paymentIntentId);
      if (payment === null) return;
      const attempts = await recordPaymentFailure(ctx, payment);
      applied = true;
      abandoned = attempts >= MAX_PAYMENT_ATTEMPTS;
    });
    return { applied, abandoned };
  },
});
