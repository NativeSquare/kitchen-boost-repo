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
 * account. In ONE transaction (idempotent per `(stripe, eventId)`), applying the
 * STRICT payment↔delivery coupling (#108 — corrects #38):
 *  1. resolve the local `payments` row from the Stripe `paymentIntentId` (an
 *     unknown intent is a clean no-op);
 *  2. mark the payment `succeeded`;
 *  3. branch on the order's fulfilment mode (frozen at checkout):
 *     - PICKUP (click & collect): CONFIRM the order NOW — `en attente de paiement →
 *       nouvelle`, stamp `paidAt`, FREEZE the pricing snapshot, increment the
 *       `customerOrdersPerTenant` MOAT aggregates — there is no Uber course to gate
 *       on, so the resto sees it immediately (PRD 10 §10/§11, payment+delivery
 *       CONTEXTs "Click & collect");
 *     - DELIVERY: do NOT confirm yet — the order STAYS `en attente de paiement`
 *       (invisible to the resto, no beep) and the stats are NOT incremented. The
 *       transition `→ nouvelle` + the stats increment are GATED on the Uber course
 *       being created successfully, and happen inside the 2.6-C executor
 *       (`createCourseOnPaymentConfirmed`). This is the [[Cmd avortée]] guarantee
 *       (payment+delivery CONTEXTs): "si l'un échoue à la création, on annule tout"
 *       and "la cmd n'est jamais transmise à KB Orders" — so a course that fails
 *       leaves no kitchen trace and no MOAT stat.
 *  4. SEED the fulfilment row (`pending`) — `delivery` for a delivery order, a
 *     `click_collect` row for a pickup (no Uber dispatch) — then SCHEDULE the 2.6-C
 *     executor (`createCourseOnPaymentConfirmed`) to make the real Uber Course once
 *     this mutation commits (a no-op for click & collect, which is already
 *     confirmed). 2.6 owns the executor; this slice only EMITS toward the delivery
 *     domain (the Uber HTTP call belongs in an action), exactly as 2.3-E emits the
 *     refund toward Payment.
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

      const order = await requireTenantOrder(
        ctx,
        payment.tenantId,
        payment.orderId,
      );
      const isPickup = order.mode === "pickup";

      // PICKUP only: confirm the order NOW (transition + paidAt + frozen pricing +
      // MOAT stats) — no course to gate on. DELIVERY is gated on course-created, so
      // it is left `en attente de paiement` here (the 2.6-C executor confirms it on
      // success). No actor — this is a system-side write.
      if (isPickup) {
        await confirmTenantOrderPayment(
          ctx,
          payment.tenantId,
          payment.orderId,
          payment.pricingSnapshot,
        );
      }

      // Seed the fulfilment row toward the delivery domain (2.6-C executes it).
      await insertTenantDelivery(ctx, payment.tenantId, {
        orderId: payment.orderId,
        mode: isPickup ? "click_collect" : "delivery",
        status: "pending",
      });

      // Hand off to the delivery domain (2.6-C): once committed, create the real
      // Uber Course (a no-op for click & collect) and — for DELIVERY — confirm the
      // order on success. Scheduled AFTER this mutation commits so the seeded row is
      // visible; the Uber HTTP call belongs in an action, not this mutation. 2.6 owns
      // the executor — 2.5 only emits.
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
