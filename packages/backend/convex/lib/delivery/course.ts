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
  confirmTenantOrderPayment,
  getTenantById,
  getTenantDeliveryByOrder,
  getTenantOrder,
  getTenantPaymentByOrder,
  patchTenantDelivery,
  readCustomerFicheById,
  requireTenantOrder,
} from "../tenancy";
import { uberPickupFromComponents } from "../uberDirect/quote";

/**
 * 2.6-C + 2.3-fix (#108) — `createCourseOnPaymentConfirmed`: turn the [[Course]]
 * seeded by 2.5 at `payment_intent.succeeded` into a real Uber Direct delivery (PRD
 * 40 §3, delivery CONTEXT) AND, under the STRICT payment↔delivery coupling (#108),
 * be the GATE that makes a delivery order visible. 2.5 (NOT this slice) wires the
 * Stripe webhook and SEEDS a `pending` `deliveries` row at payment-confirmed WITHOUT
 * confirming a delivery order (it stays `en attente de paiement`, invisible,
 * uncounted); this action is the delivery-domain EXECUTOR it triggers — it reads
 * that seeded row, and:
 *  - mode `click_collect` ⇒ NO Uber call, no Course created, fee 0 (no-op — the
 *    pickup order was already confirmed at payment, no course gate);
 *  - mode `delivery` ⇒ call `lib/uberDirect.createDelivery` (the ONLY Uber caller)
 *    and persist `uberDeliveryId` + status + pickup/dropoff ETA + courier on the
 *    row. ON SUCCESS, CONFIRM the order (`en attente de paiement → nouvelle`, freeze
 *    pricing, +1 `customerOrdersPerTenant` MOAT stats) — this is the EXACT moment the
 *    resto sees the order (beep), gated on the course existing. If Uber REFUSES the
 *    course (PRD 40 §5 Cas A / [[Cmd avortée]]), the order is NEVER confirmed (it
 *    stays invisible + uncounted): flag the row `refused_post_payment` AND trigger
 *    the 2.5-D auto-refund (#49) — SCHEDULED via `ctx.scheduler.runAfter(0,
 *    internal.lib.stripe.refund.refundAbortedOrder, …)` (the Stripe call lives in
 *    the payment domain's action; this slice only triggers it).
 *
 * SYSTEM-SIDE (no actor): the trigger is the Stripe webhook scheduler, which
 * carries NO user-supplied tenant id. The `tenantId` is resolved STRUCTURALLY
 * (the seeded `deliveries` / `orders` row already carries it), so this can only
 * ever touch the owning tenant — exactly like 2.5-B `confirmPaymentSucceeded`. All
 * persistence goes through the sanctioned `lib/tenancy` store seams (the only
 * `ctx.db` site); `lib/delivery` itself never touches raw `ctx.db`
 * (`no-untenanted-query`). It is INTERNAL — never an exposed public function.
 */

/**
 * Read the seeded delivery + its order + tenant for the course-creation decision,
 * PLUS the customer's `firstName` for the Uber `dropoff_name` field. The GLOBAL
 * `customers` table is the MOAT (ADR 0010) — reached through the sanctioned
 * `readCustomerFicheById` seam by the order's `customerId`, never raw `ctx.db`.
 * Only the firstName (cosmetic on the Uber manifest) crosses out; the resto still
 * never sees the cross-tenant customers base.
 */
export const readCourseInputs = internalQuery({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  handler: async (
    ctx,
    args,
  ): Promise<{
    delivery: Doc<"deliveries"> | null;
    order: Doc<"orders"> | null;
    tenant: Doc<"tenants"> | null;
    customerFirstName: string | null;
  }> => {
    const delivery = await getTenantDeliveryByOrder(
      ctx,
      args.tenantId,
      args.orderId,
    );
    const order = await getTenantOrder(ctx, args.tenantId, args.orderId);
    const tenant = await getTenantById(ctx, args.tenantId);
    const customer =
      order !== null
        ? await readCustomerFicheById(ctx, order.customerId)
        : null;
    return {
      delivery,
      order,
      tenant,
      customerFirstName: customer?.firstName ?? null,
    };
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

/**
 * 2.3-fix (#108) — CONFIRM a delivery order once its Uber course exists: the GATE
 * that makes a delivery order visible to the resto (`en attente de paiement →
 * nouvelle`, freeze pricing, +1 MOAT stats) under the strict payment↔delivery
 * coupling. Runs in ONE transaction via the sanctioned `confirmTenantOrderPayment`
 * seam (which guards the state machine + records the customer aggregates). IDEMPOTENT:
 * a re-trigger after the order is already `nouvelle` (or any non-pending state) is a
 * clean no-op — the `confirmTenantOrderPayment` guard requires `en attente de
 * paiement`, so we check first and skip rather than throw. The frozen pricing is
 * read from the `payments` row (where 2.5-B `recordPaymentIntent` persisted it) —
 * NOT from `order.pricingSnapshot`, which is undefined until THIS confirmation
 * writes it (a delivery order carries no snapshot before it is confirmed, so
 * reading it from the order self-blocked the gate). System-side (no actor); the
 * tenant is structural. Returns whether it confirmed on this call.
 */
export const confirmDeliveryOrderOnCourseCreated = internalMutation({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  returns: v.object({ confirmed: v.boolean() }),
  handler: async (ctx, args): Promise<{ confirmed: boolean }> => {
    const order = await requireTenantOrder(ctx, args.tenantId, args.orderId);
    // Only the gated pending state transitions; anything else (already confirmed on
    // a prior run, or aborted) is left untouched — idempotent, never a double count.
    if (order.status !== "en attente de paiement") return { confirmed: false };
    // The immutable charged amount lives on the `payments` row (set at
    // `recordPaymentIntent`), not on the order (which only gets its frozen
    // snapshot HERE, via `confirmTenantOrderPayment`). Source it from there.
    const payment = await getTenantPaymentByOrder(
      ctx,
      args.tenantId,
      args.orderId,
    );
    if (payment === null || payment.pricingSnapshot === undefined) {
      return { confirmed: false };
    }
    await confirmTenantOrderPayment(
      ctx,
      args.tenantId,
      args.orderId,
      payment.pricingSnapshot,
    );
    return { confirmed: true };
  },
});

export const createCourseOnPaymentConfirmed = internalAction({
  args: { tenantId: v.id("tenants"), orderId: v.id("orders") },
  returns: v.object({ courseCreated: v.boolean() }),
  handler: async (ctx, args): Promise<{ courseCreated: boolean }> => {
    const { delivery, order, tenant, customerFirstName } = await ctx.runQuery(
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

    // Build the tenant `pickup_address` EXACTLY as the quote endpoint does it
    // (lib/uberDirect/quote `requestQuote`): the JSON-encoded structured shape
    // from the 4-tuple when present, falling back to the raw display string for a
    // legacy tenant. Uber REQUIRES `pickup_address` + `pickup_phone_number` on
    // Create even with a quote; the pickup is the tenant's own address/phone.
    const pickupAddress =
      tenant.addressComponents !== undefined
        ? JSON.stringify(uberPickupFromComponents(tenant.addressComponents))
        : (tenant.address ?? "");

    const result = await ctx.runAction(
      internal.lib.uberDirect.createDelivery.createDelivery,
      {
        tenantId: args.tenantId,
        quoteId,
        manifestReference: args.orderId,
        pickupName: tenant.name, // the resto display name (real KB data)
        pickupAddress,
        ...(tenant.phone !== undefined
          ? { pickupPhoneNumber: tenant.phone }
          : {}),
        dropoffAddress: order.address ?? "",
        // dropoff_name is the customer's firstName (cosmetic; createDelivery
        // falls back to "Client" when absent); dropoff_phone_number is the
        // denormalised customer phone on the order.
        ...(customerFirstName !== null
          ? { dropoffName: customerFirstName }
          : {}),
        ...(order.customerPhone !== undefined
          ? { dropoffPhoneNumber: order.customerPhone }
          : {}),
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

    // #108 — the course EXISTS now, so the strict coupling is satisfied: confirm the
    // delivery order (`en attente de paiement → nouvelle` + freeze pricing + MOAT
    // stats). This is the exact moment the resto sees it (beep). Idempotent.
    await ctx.runMutation(
      internal.lib.delivery.course.confirmDeliveryOrderOnCourseCreated,
      { tenantId: args.tenantId, orderId: args.orderId },
    );
    return { courseCreated: true };
  },
});
