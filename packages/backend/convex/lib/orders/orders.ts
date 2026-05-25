import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  frozenModifier,
  orderMode,
  orderStatus,
  pricingSnapshot,
} from "../../table/orders";
import {
  type OrderWithDetail,
  type TenantRole,
  clearTenantOperationalPause,
  getTenantOperationalPause,
  getTenantOrderWithDetail,
  insertTenantOrder,
  listTenantOrders,
  listTenantOrdersByStatus,
  recordTenantOrderStatus,
  setTenantOperationalPause,
  tenantMutation,
  tenantQuery,
} from "../tenancy";

/**
 * 2.3-A — `orders` + `orderItems` (FROZEN) + `orderEvents` tenant-scoped
 * persistence + the tenant operationalPause (PRD 10 / PRD 20, ADR 0010).
 *
 * Every function goes through a tenancy wrapper, strictly keyed on `ctx.tenantId`,
 * and reaches the tables only through the sanctioned `lib/tenancy/ordersStore`
 * seam — never raw `ctx.db` here (`no-untenanted-query` + the cross-tenant fuzz
 * suite enforce isolation).
 *
 * RBAC (multi-tenant CONTEXT): KB Orders is OPERATIONAL, so READS + the kitchen
 * workflow (`recordStatus`) allow `kb_manager` + `staff`; PLACING an order is a
 * checkout-side write (kb_manager / system), and toggling the operational PAUSE
 * is a manager action — both default to `kb_manager`. `kb_admin` passes via the
 * root override on all of them.
 *
 * Line items are FROZEN (PRD 10 §7): `placeOrder` hands the store a denormalised
 * snapshot of name/price/modifiers/allergens — NOT FKs into the menu — so an
 * order is self-contained and immutable. No real payment / delivery call here;
 * those are later 2.3/2.4/2.5/2.6 slices that WRITE `paymentRef` / `deliveryRef`
 * / `pricingSnapshot` and drive `recordStatus`.
 */

/** Reads + the kitchen workflow allow operational staff (KB Orders). */
const OPERATIONAL_ALLOW: { allow: TenantRole[] } = {
  allow: ["kb_manager", "staff"],
};

// ---------------------------------------------------------------------------
// orders — reads (kb_manager + staff)
// ---------------------------------------------------------------------------

/**
 * List the calling tenant's orders, newest first. With `status`, returns only the
 * orders in that workflow state (the kitchen queue, `by_tenant_status` index).
 */
export const listOrders = tenantQuery(OPERATIONAL_ALLOW)({
  args: { status: v.optional(orderStatus) },
  handler: async (ctx, args) =>
    args.status === undefined
      ? listTenantOrders(ctx, ctx.tenantId)
      : listTenantOrdersByStatus(ctx, ctx.tenantId, args.status),
});

/**
 * One order with its FROZEN items + time-ordered events, or `null`. The store
 * re-checks tenant ownership, so a foreign `orderId` reads as `null` (and the
 * caller cannot even reach this for a tenant it has no access to — the wrapper
 * throws first).
 */
export const getOrder = tenantQuery(OPERATIONAL_ALLOW)({
  args: { orderId: v.id("orders") },
  handler: async (ctx, args): Promise<OrderWithDetail | null> =>
    getTenantOrderWithDetail(ctx, ctx.tenantId, args.orderId),
});

// ---------------------------------------------------------------------------
// orders — writes
// ---------------------------------------------------------------------------

/**
 * Place an order on the calling tenant (kb_manager / system): persists the order
 * (status `nouvelle`, source `direct`), FREEZES the line items, and stamps the
 * initial `nouvelle` event. Returns the new order id. Audited (a checkout write).
 */
export const placeOrder = tenantMutation()({
  args: {
    customerId: v.id("customers"),
    mode: orderMode,
    address: v.optional(v.string()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    restaurantNote: v.optional(v.string()),
    pricingSnapshot: v.optional(pricingSnapshot),
    items: v.array(
      v.object({
        itemName: v.string(),
        unitPrice: v.number(),
        quantity: v.number(),
        modifiers: v.array(frozenModifier),
        allergens: v.array(v.string()),
      }),
    ),
  },
  audit: true,
  action: "order.place",
  handler: async (ctx, args): Promise<Id<"orders">> =>
    insertTenantOrder(
      ctx,
      ctx.tenantId,
      {
        customerId: args.customerId,
        mode: args.mode,
        address: args.address,
        lat: args.lat,
        lng: args.lng,
        restaurantNote: args.restaurantNote,
        pricingSnapshot: args.pricingSnapshot,
        items: args.items,
      },
      ctx.actor.userId,
    ),
});

/**
 * Advance one of the calling tenant's orders to `status` (the kitchen workflow,
 * kb_manager + staff): patches the order + appends an `orderEvents` row. `reason`
 * is recorded for a `refusée`. The store throws NOT_FOUND for a missing OR
 * foreign `orderId` (ownership re-check), so a cross-tenant id is unreachable.
 */
export const recordStatus = tenantMutation(OPERATIONAL_ALLOW)({
  args: {
    orderId: v.id("orders"),
    status: orderStatus,
    reason: v.optional(v.string()),
  },
  audit: true,
  action: "order.recordStatus",
  handler: async (ctx, args): Promise<void> => {
    await recordTenantOrderStatus(
      ctx,
      ctx.tenantId,
      args.orderId,
      args.status,
      {
        reason: args.reason,
        actorUserId: ctx.actor.userId,
      },
    );
  },
});

// ---------------------------------------------------------------------------
// operationalPause — transient tenant status (PRD 20 §7, kb_manager)
// ---------------------------------------------------------------------------

/** The calling tenant's operational pause (or `null` if not paused). */
export const getOperationalPause = tenantQuery(OPERATIONAL_ALLOW)({
  args: {},
  handler: async (ctx): Promise<{ until: number } | null> =>
    getTenantOperationalPause(ctx, ctx.tenantId),
});

/** Set a transient operational pause on the calling tenant (manager). Audited. */
export const setOperationalPause = tenantMutation()({
  args: { until: v.number() },
  audit: true,
  action: "tenant.operationalPause.set",
  handler: async (ctx, args): Promise<void> => {
    await setTenantOperationalPause(ctx, ctx.tenantId, args.until);
  },
});

/** Clear the calling tenant's operational pause (manager). Audited. */
export const clearOperationalPause = tenantMutation()({
  args: {},
  audit: true,
  action: "tenant.operationalPause.clear",
  handler: async (ctx): Promise<void> => {
    await clearTenantOperationalPause(ctx, ctx.tenantId);
  },
});
