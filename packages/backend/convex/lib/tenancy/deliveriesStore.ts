import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  DeliveryIncidentType,
  DeliveryMode,
  DeliveryStatus,
} from "../../table/deliveries";

/**
 * 2.6-A — the SANCTIONED tenant-scoped data-access seam for the `deliveries`
 * table (the isolation discipline of ADR 0010).
 *
 * `deliveries` carries `tenantId`, so business code must reach it ONLY through
 * the tenancy wrappers — never raw `ctx.db.query("deliveries")` (the
 * `no-untenanted-query` rule, 1.x-H). This file lives in the EXEMPT
 * `convex/lib/tenancy/**` path (the single sanctioned `ctx.db` site for the
 * table), exactly like `pricingRulesStore.ts` for `pricingRules` or
 * `lib/crypto/credentials.ts` for per-tenant secrets. The business module
 * `lib/uberDirect/**` (NOT exempt) calls THESE helpers instead of `ctx.db`.
 *
 * Every helper is TENANT-SCOPED by construction: it takes the caller's resolved
 * `tenantId` (sourced from `ctx.tenantId` inside a tenant wrapper handler), keys
 * reads on the `by_tenant` / `by_order` indexes, and re-checks `tenantId`
 * ownership before any patch of a row fetched by id — so a `deliveryId` from
 * another tenant can never be read or patched from here.
 *
 * No delete helper: a tenant's historical deliveries are RETAINED (no hard
 * delete V1, including a suspended tenant — PRD 40 / acceptance criteria).
 */

/** The mutable fields of a delivery, all optional (a partial patch). */
export type DeliveryPatch = {
  uberDeliveryId?: string;
  status?: DeliveryStatus;
  pickupEta?: number;
  dropoffEta?: number;
  courierName?: string;
  courierPhone?: string;
  quoteId?: string;
  quoteFee?: number;
  incidentType?: DeliveryIncidentType;
  cumulativeEtaDriftMs?: number;
};

/** The fields set when a delivery row is first created. */
export type NewDelivery = {
  orderId: string;
  mode: DeliveryMode;
  status: DeliveryStatus;
  quoteId?: string;
  quoteFee?: number;
  uberDeliveryId?: string;
};

/** List ALL deliveries of one tenant, newest-agnostic, keyed on `by_tenant`. */
export async function listTenantDeliveries(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"deliveries">[]> {
  return ctx.db
    .query("deliveries")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
}

/** The one delivery for a tenant's order (or `null`), keyed on `by_order`. */
export async function getTenantDeliveryByOrder(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  orderId: string,
): Promise<Doc<"deliveries"> | null> {
  return ctx.db
    .query("deliveries")
    .withIndex("by_order", (q) =>
      q.eq("tenantId", tenantId).eq("orderId", orderId),
    )
    .unique();
}

/**
 * The one delivery a tenant owns carrying `uberDeliveryId` (or `null`). The Uber
 * webhook carries the `uberDeliveryId` (NOT the KB order id); it is resolved on
 * the global `by_uber_delivery_id` index and then RE-CHECKED against `tenantId`,
 * so an event routed to one tenant's webhook can never reach (or patch) ANOTHER
 * tenant's delivery — the routed tenant is the isolation boundary (ADR 0010).
 */
export async function getTenantDeliveryByUberId(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  uberDeliveryId: string,
): Promise<Doc<"deliveries"> | null> {
  const row = await ctx.db
    .query("deliveries")
    .withIndex("by_uber_delivery_id", (q) =>
      q.eq("uberDeliveryId", uberDeliveryId),
    )
    .unique();
  if (row === null || row.tenantId !== tenantId) return null;
  return row;
}

/**
 * Read one delivery by id ONLY IF it belongs to `tenantId`; else `null`. The
 * tenant-ownership re-check is what makes a cross-tenant `deliveryId`
 * unreachable even though Convex ids are not themselves tenant-scoped.
 */
export async function getTenantDelivery(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  deliveryId: Id<"deliveries">,
): Promise<Doc<"deliveries"> | null> {
  const row = await ctx.db.get(deliveryId);
  if (row === null || row.tenantId !== tenantId) return null;
  return row;
}

/**
 * Like `getTenantDelivery`, but throws a typed `NOT_FOUND` `ConvexError` when the
 * row is absent OR belongs to another tenant — so a foreign `deliveryId` is
 * indistinguishable from a missing one (no cross-tenant existence oracle).
 */
export async function requireTenantDelivery(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  deliveryId: Id<"deliveries">,
): Promise<Doc<"deliveries">> {
  const row = await getTenantDelivery(ctx, tenantId, deliveryId);
  if (row === null) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Delivery not found for this tenant.",
    });
  }
  return row;
}

/** Insert a new delivery row for `tenantId`. Returns the new row id. */
export async function insertTenantDelivery(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  data: NewDelivery,
): Promise<Id<"deliveries">> {
  const now = Date.now();
  return ctx.db.insert("deliveries", {
    tenantId,
    orderId: data.orderId,
    mode: data.mode,
    status: data.status,
    quoteId: data.quoteId,
    quoteFee: data.quoteFee,
    uberDeliveryId: data.uberDeliveryId,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Patch a delivery the caller already proved owned by `tenantId` (the
 * `deliveryId` MUST be re-checked via `requireTenantDelivery` first). Bumps
 * `updatedAt`. Only the provided fields are written.
 */
export async function patchTenantDelivery(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  deliveryId: Id<"deliveries">,
  patch: DeliveryPatch,
): Promise<void> {
  await requireTenantDelivery(ctx, tenantId, deliveryId);
  await ctx.db.patch(deliveryId, { ...patch, updatedAt: Date.now() });
}

/**
 * Stamp the tenant's Uber Direct sub-account id (`customer_id`) onto its
 * `tenants` row — the link to the Uber account, set when credentials are stored
 * (2.6-A). Lives in this sanctioned seam because `tenants` is reached via raw
 * `ctx.db` here; the CALLER (a tenant wrapper handler) has already gated access
 * to `tenantId`, so this never writes a tenant the actor cannot reach.
 */
export async function setTenantUberCustomerId(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  uberCustomerId: string,
): Promise<void> {
  await ctx.db.patch(tenantId, { uberCustomerId });
}
