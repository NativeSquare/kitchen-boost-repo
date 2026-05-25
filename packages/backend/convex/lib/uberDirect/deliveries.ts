import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  deliveryIncidentType,
  deliveryMode,
  deliveryStatus,
} from "../../table/deliveries";
import {
  type TenantRole,
  getTenantDeliveryByOrder,
  insertTenantDelivery,
  listTenantDeliveries,
  patchTenantDelivery,
  requireTenantDelivery,
  tenantMutation,
  tenantQuery,
} from "../tenancy";

/**
 * 2.6-A — `deliveries` tenant-scoped persistence (PRD 40, delivery CONTEXT, ADR
 * 0010).
 *
 * Every function goes through a tenancy wrapper, strictly keyed on `ctx.tenantId`,
 * and reaches the table only through the sanctioned `lib/tenancy/deliveriesStore`
 * seam — never raw `ctx.db` here (`no-untenanted-query` + the cross-tenant fuzz
 * suite enforce isolation). Reads allow `kb_manager` + `staff` (KB Orders is
 * operational, multi-tenant CONTEXT RBAC), writes are `kb_manager`-scoped (the
 * default), with `kb_admin` passing via the root override on both.
 *
 * No real Uber call here — this slice is persistence + isolation only. Creating
 * the course and consuming webhooks are later 2.6 stories; they will WRITE
 * through `patchDelivery` (delivery id, courier, status, incidents). Historical
 * rows are RETAINED (no delete helper — a suspended tenant keeps its deliveries,
 * acceptance criteria).
 *
 * `courierPhone` lives on the row (visible to KB Orders) but is NOT part of any
 * client-facing surface in V1 (PRD 40 §4) — that gate belongs to the client read
 * model (10_pwa), not to this internal store.
 */

/** Reads allow operational staff in addition to the manager (KB Orders). */
const READ_ALLOW: { allow: TenantRole[] } = {
  allow: ["kb_manager", "staff"],
};

/** List all of the calling tenant's deliveries. */
export const listDeliveries = tenantQuery(READ_ALLOW)({
  args: {},
  handler: async (ctx): Promise<Doc<"deliveries">[]> =>
    listTenantDeliveries(ctx, ctx.tenantId),
});

/** The calling tenant's delivery for one order, or `null`. */
export const getDeliveryByOrder = tenantQuery(READ_ALLOW)({
  args: { orderId: v.string() },
  handler: async (ctx, args): Promise<Doc<"deliveries"> | null> =>
    getTenantDeliveryByOrder(ctx, ctx.tenantId, args.orderId),
});

/**
 * Create a delivery / click & collect row on the calling tenant (kb_manager).
 * `uberDeliveryId` is left ABSENT here (assigned later when Uber returns it, and
 * never set for click & collect). Returns the new row id.
 */
export const createDelivery = tenantMutation()({
  args: {
    orderId: v.string(),
    mode: deliveryMode,
    status: deliveryStatus,
    quoteId: v.optional(v.string()),
    quoteFee: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Id<"deliveries">> =>
    insertTenantDelivery(ctx, ctx.tenantId, {
      orderId: args.orderId,
      mode: args.mode,
      status: args.status,
      quoteId: args.quoteId,
      quoteFee: args.quoteFee,
    }),
});

/**
 * Patch tracking / incident fields on one of the tenant's deliveries (the seam
 * throws NOT_FOUND for a missing OR foreign `deliveryId`, so a cross-tenant id is
 * unreachable). Only the supplied fields are written; `updatedAt` is bumped.
 */
export const patchDelivery = tenantMutation()({
  args: {
    deliveryId: v.id("deliveries"),
    patch: v.object({
      uberDeliveryId: v.optional(v.string()),
      status: v.optional(deliveryStatus),
      pickupEta: v.optional(v.number()),
      dropoffEta: v.optional(v.number()),
      courierName: v.optional(v.string()),
      courierPhone: v.optional(v.string()),
      quoteId: v.optional(v.string()),
      quoteFee: v.optional(v.number()),
      incidentType: v.optional(deliveryIncidentType),
      cumulativeEtaDriftMs: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args): Promise<void> => {
    // Ownership (NOT_FOUND for a missing OR foreign row) is enforced by the seam.
    await requireTenantDelivery(ctx, ctx.tenantId, args.deliveryId);
    await patchTenantDelivery(ctx, ctx.tenantId, args.deliveryId, args.patch);
  },
});
