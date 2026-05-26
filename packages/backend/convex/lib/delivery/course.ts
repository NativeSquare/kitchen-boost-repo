import { v } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import { deliveryIncidentType } from "../../table/deliveries";
import {
  getTenantById,
  getTenantDeliveryByOrder,
  getTenantOrder,
  patchTenantDelivery,
} from "../tenancy";

/**
 * 2.6-C — `createCourseOnPaymentConfirmed`: turn the [[Course]] seeded by 2.5 at
 * `payment_intent.succeeded` into a real Uber Direct delivery (PRD 40 §3, delivery
 * CONTEXT). 2.5 (NOT this slice) wires the Stripe webhook and SEEDS a `pending`
 * `deliveries` row at payment-confirmed; this action is the delivery-domain
 * EXECUTOR it triggers — it reads that seeded row, and:
 *  - mode `click_collect` ⇒ NO Uber call, no Course created, fee 0 (no-op);
 *  - mode `delivery` ⇒ call `lib/uberDirect.createDelivery` (the ONLY Uber caller)
 *    and persist `uberDeliveryId` + status + pickup/dropoff ETA + courier on the
 *    row. If Uber REFUSES the course (PRD 40 §5 Cas A / [[Cmd avortée]]), flag the
 *    row `refused_post_payment` AND trigger the 2.5-D auto-refund (#49): the payment
 *    `succeeded` but the course can't be created, so KB refunds the client in full,
 *    pulls the order out of KB Orders, and pushes the client — SCHEDULED via
 *    `ctx.scheduler.runAfter(0, internal.lib.stripe.refund.refundAbortedOrder, …)`
 *    (the Stripe call lives in the payment domain's action; this slice only triggers
 *    it, exactly as 2.5-B emits the course toward delivery).
 *
 * SYSTEM-SIDE (no actor): the trigger is the Stripe webhook scheduler, which
 * carries NO user-supplied tenant id. The `tenantId` is resolved STRUCTURALLY
 * (the seeded `deliveries` / `orders` row already carries it), so this can only
 * ever touch the owning tenant — exactly like 2.5-B `confirmPaymentSucceeded`. All
 * persistence goes through the sanctioned `lib/tenancy` store seams (the only
 * `ctx.db` site); `lib/delivery` itself never touches raw `ctx.db`
 * (`no-untenanted-query`). It is INTERNAL — never an exposed public function.
 */

/** Read the seeded delivery + its order for the course-creation decision. */
export const readCourseInputs = internalQuery({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    delivery: Doc<"deliveries"> | null;
    order: Doc<"orders"> | null;
    tenant: Doc<"tenants"> | null;
  }> => {
    const delivery = await getTenantDeliveryByOrder(
      ctx,
      args.tenantId,
      args.orderId,
    );
    const order = await getTenantOrder(ctx, args.tenantId, args.orderId);
    const tenant = await getTenantById(ctx, args.tenantId);
    return { delivery, order, tenant };
  },
});

/** Persist the created course (or the Cas A refusal) onto the delivery row. */
export const applyCourseResult = internalMutation({
  args: {
    tenantId: v.id("tenants"),
    orderId: v.id("orders"),
    patch: v.object({
      uberDeliveryId: v.optional(v.string()),
      status: v.optional(
        v.union(
          v.literal("pending"),
          v.literal("pickup"),
          v.literal("pickup_complete"),
          v.literal("dropoff"),
          v.literal("delivered"),
          v.literal("canceled"),
          v.literal("returned"),
          v.literal("failed"),
        ),
      ),
      pickupEta: v.optional(v.number()),
      dropoffEta: v.optional(v.number()),
      courierName: v.optional(v.string()),
      courierPhone: v.optional(v.string()),
      incidentType: v.optional(deliveryIncidentType),
    }),
  },
  handler: async (ctx, args): Promise<void> => {
    const delivery = await getTenantDeliveryByOrder(
      ctx,
      args.tenantId,
      args.orderId,
    );
    if (delivery === null) return; // no seeded row → nothing to update (no-op)
    await patchTenantDelivery(ctx, args.tenantId, delivery._id, args.patch);
  },
});

export const createCourseOnPaymentConfirmed = internalAction({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  returns: v.object({ courseCreated: v.boolean() }),
  handler: async (ctx, args): Promise<{ courseCreated: boolean }> => {
    const { delivery, order, tenant } = await ctx.runQuery(
      internal.lib.delivery.course.readCourseInputs,
      { tenantId: args.tenantId, orderId: args.orderId },
    );

    // No seeded row, no order/tenant, or click & collect ⇒ NO Uber call, no Course.
    if (
      delivery === null ||
      order === null ||
      tenant === null ||
      delivery.mode === "click_collect"
    ) {
      return { courseCreated: false };
    }

    // A re-trigger after the course already exists is a no-op (idempotent).
    if (delivery.uberDeliveryId !== undefined) {
      return { courseCreated: false };
    }

    const quoteId = delivery.quoteId;
    // Without an accepted quote there is nothing to bind the course to — flag the
    // refusal (Cas A / [[Cmd avortée]]) rather than invent a quote, and trigger the
    // 2.5-D auto-refund (#49).
    if (quoteId === undefined) {
      await ctx.runMutation(internal.lib.delivery.course.applyCourseResult, {
        tenantId: args.tenantId,
        orderId: args.orderId,
        patch: { incidentType: "refused_post_payment" },
      });
      await ctx.scheduler.runAfter(
        0,
        internal.lib.stripe.refund.refundAbortedOrder,
        { tenantId: args.tenantId, orderId: args.orderId },
      );
      return { courseCreated: false };
    }

    const result = await ctx.runAction(
      internal.lib.uberDirect.createDelivery.createDelivery,
      {
        tenantId: args.tenantId,
        quoteId,
        manifestReference: args.orderId,
        pickupName: tenant.name, // the resto display name (real KB data)
        dropoffAddress: order.address ?? "",
      },
    );

    if (!result.ok) {
      // Cas A — course refused by Uber post-payment (PRD 40 §5 / [[Cmd avortée]]).
      // Record the incident on the delivery row AND trigger the 2.5-D auto-refund
      // (#49): full refund + the order leaves KB Orders + client push. Scheduled so
      // the Stripe call runs in the payment domain's action after this commits.
      await ctx.runMutation(internal.lib.delivery.course.applyCourseResult, {
        tenantId: args.tenantId,
        orderId: args.orderId,
        patch: { incidentType: "refused_post_payment" },
      });
      await ctx.scheduler.runAfter(
        0,
        internal.lib.stripe.refund.refundAbortedOrder,
        { tenantId: args.tenantId, orderId: args.orderId },
      );
      return { courseCreated: false };
    }

    await ctx.runMutation(internal.lib.delivery.course.applyCourseResult, {
      tenantId: args.tenantId,
      orderId: args.orderId,
      patch: {
        uberDeliveryId: result.uberDeliveryId,
        status: result.status,
        ...(result.pickupEta !== undefined
          ? { pickupEta: result.pickupEta }
          : {}),
        ...(result.dropoffEta !== undefined
          ? { dropoffEta: result.dropoffEta }
          : {}),
        ...(result.courierName !== undefined
          ? { courierName: result.courierName }
          : {}),
        ...(result.courierPhone !== undefined
          ? { courierPhone: result.courierPhone }
          : {}),
      },
    });
    return { courseCreated: true };
  },
});
