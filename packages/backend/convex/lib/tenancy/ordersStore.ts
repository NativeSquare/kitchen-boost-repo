import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  FrozenModifier,
  OrderMode,
  OrderStatus,
  PricingSnapshot,
} from "../../table/orders";

/**
 * 2.3-A — the SANCTIONED tenant-scoped data-access seam for the `orders`,
 * `orderItems` (FROZEN) and `orderEvents` tables, plus the `tenants`
 * operationalPause field (the isolation discipline of ADR 0010).
 *
 * All four touch points carry `tenantId` (or, for the pause, are gated on the
 * resolved `tenantId`), so business code must reach them ONLY through the tenancy
 * wrappers — never raw `ctx.db.query("orders")` (the `no-untenanted-query` rule,
 * 1.x-H). This file lives in the EXEMPT `convex/lib/tenancy/**` path (the single
 * sanctioned `ctx.db` site for these tables), exactly like `deliveriesStore.ts`
 * for `deliveries` or `pricingRulesStore.ts` for `pricingRules`. The business
 * module `lib/orders/**` (NOT exempt) calls THESE helpers instead of `ctx.db`.
 *
 * Every helper is TENANT-SCOPED by construction: it takes the caller's resolved
 * `tenantId` (sourced from `ctx.tenantId` inside a tenant wrapper handler), keys
 * reads on the `by_tenant*` / `by_order` indexes, and re-checks `tenantId`
 * ownership before reading a row fetched by id — so an `orderId` from another
 * tenant can never be read or written from here.
 *
 * Line items are FROZEN: `insertTenantOrder` deep-copies the modifiers/allergens
 * into immutable `orderItems` rows (no FK into the menu, PRD 10 §7). No delete
 * helper: a tenant's order history is RETAINED (no hard delete V1).
 */

/** One frozen line item to persist (a denormalised snapshot — PRD 10 §7). */
export type NewOrderItem = {
  itemName: string;
  unitPrice: number;
  quantity: number;
  modifiers: FrozenModifier[];
  allergens: string[];
};

/** The fields set when an order is first placed (status forced to `nouvelle`). */
export type NewOrder = {
  customerId: Id<"customers">;
  mode: OrderMode;
  address?: string;
  lat?: number;
  lng?: number;
  restaurantNote?: string;
  pricingSnapshot?: PricingSnapshot;
  items: NewOrderItem[];
};

/**
 * The fields set when an order is created AT CHECKOUT, BEFORE payment (2.3-B).
 * Same shape as `NewOrder` minus the pricing snapshot — that is filled/frozen at
 * PAYMENT (slice C), never at checkout. The status is forced to `en attente de
 * paiement` (invisible to the resto until paid, PRD 10 §10/§11).
 */
export type NewPendingOrder = {
  customerId: Id<"customers">;
  mode: OrderMode;
  address?: string;
  lat?: number;
  lng?: number;
  restaurantNote?: string;
  items: NewOrderItem[];
};

/** An order joined with its frozen items + time-ordered events (read model). */
export type OrderWithDetail = Doc<"orders"> & {
  items: Doc<"orderItems">[];
  events: Doc<"orderEvents">[];
};

// ---------------------------------------------------------------------------
// orders / orderItems / orderEvents — reads
// ---------------------------------------------------------------------------

/** All of a tenant's orders, NEWEST FIRST, keyed on `by_tenant`. */
export async function listTenantOrders(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"orders">[]> {
  return ctx.db
    .query("orders")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .order("desc")
    .collect();
}

/** A tenant's orders in one workflow status, NEWEST FIRST (the kitchen queue). */
export async function listTenantOrdersByStatus(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  status: OrderStatus,
): Promise<Doc<"orders">[]> {
  return ctx.db
    .query("orders")
    .withIndex("by_tenant_status", (q) =>
      q.eq("tenantId", tenantId).eq("status", status),
    )
    .order("desc")
    .collect();
}

/**
 * Read one order by id ONLY IF it belongs to `tenantId`; else `null`. The
 * tenant-ownership re-check is what makes a cross-tenant `orderId` unreachable
 * even though Convex ids are not themselves tenant-scoped.
 */
export async function getTenantOrder(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
): Promise<Doc<"orders"> | null> {
  const row = await ctx.db.get(orderId);
  if (row === null || row.tenantId !== tenantId) return null;
  return row;
}

/**
 * Like `getTenantOrder`, but throws a typed `NOT_FOUND` `ConvexError` when the
 * order is absent OR belongs to another tenant — so a foreign `orderId` is
 * indistinguishable from a missing one (no cross-tenant existence oracle).
 */
export async function requireTenantOrder(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
): Promise<Doc<"orders">> {
  const row = await getTenantOrder(ctx, tenantId, orderId);
  if (row === null) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Order not found for this tenant.",
    });
  }
  return row;
}

/** The frozen line items of a tenant's order, keyed on `by_order`. */
export async function listTenantOrderItems(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
): Promise<Doc<"orderItems">[]> {
  return ctx.db
    .query("orderItems")
    .withIndex("by_order", (q) =>
      q.eq("tenantId", tenantId).eq("orderId", orderId),
    )
    .collect();
}

/** The time-ordered events of a tenant's order, oldest first, keyed `by_order`. */
export async function listTenantOrderEvents(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
): Promise<Doc<"orderEvents">[]> {
  return ctx.db
    .query("orderEvents")
    .withIndex("by_order", (q) =>
      q.eq("tenantId", tenantId).eq("orderId", orderId),
    )
    .collect();
}

/** Read an order with its frozen items + events, or `null` if not this tenant's. */
export async function getTenantOrderWithDetail(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
): Promise<OrderWithDetail | null> {
  const order = await getTenantOrder(ctx, tenantId, orderId);
  if (order === null) return null;
  const [items, events] = await Promise.all([
    listTenantOrderItems(ctx, tenantId, orderId),
    listTenantOrderEvents(ctx, tenantId, orderId),
  ]);
  return { ...order, items, events };
}

// ---------------------------------------------------------------------------
// orders / orderItems / orderEvents — writes
// ---------------------------------------------------------------------------

/** The per-status transition timestamp field, if any (PRD 20 §5). */
function transitionStampFor(
  status: OrderStatus,
): Partial<Doc<"orders">> | undefined {
  const now = Date.now();
  switch (status) {
    case "en préparation":
      return { acceptedAt: now };
    case "prête":
      return { readyAt: now };
    case "remise":
      return { handedOverAt: now };
    case "livrée":
    case "collectée":
      return { completedAt: now };
    case "refusée":
      return { refusedAt: now };
    default:
      return undefined;
  }
}

/**
 * Place an order for `tenantId`: insert the `orders` row (status `nouvelle`,
 * source `direct`), DEEP-COPY each line into a FROZEN `orderItems` row, and append
 * the initial `nouvelle` `orderEvents` row. Returns the new order id.
 */
export async function insertTenantOrder(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  data: NewOrder,
  actorUserId?: Id<"users">,
): Promise<Id<"orders">> {
  const now = Date.now();
  const orderId = await ctx.db.insert("orders", {
    tenantId,
    customerId: data.customerId,
    status: "nouvelle",
    mode: data.mode,
    source: "direct", // V1 = direct only (ADR 0009)
    address: data.address,
    lat: data.lat,
    lng: data.lng,
    restaurantNote: data.restaurantNote,
    pricingSnapshot: data.pricingSnapshot,
    createdAt: now,
  });

  // Freeze the line items — a denormalised, deep-copied snapshot (PRD 10 §7).
  for (const item of data.items) {
    await ctx.db.insert("orderItems", {
      tenantId,
      orderId,
      itemName: item.itemName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      modifiers: item.modifiers.map((m) => ({ ...m })),
      allergens: [...item.allergens],
    });
  }

  await ctx.db.insert("orderEvents", {
    tenantId,
    orderId,
    status: "nouvelle",
    actorUserId,
    at: now,
  });

  return orderId;
}

/**
 * Create an order AT CHECKOUT, BEFORE payment (2.3-B): insert the `orders` row in
 * status `en attente de paiement` (source `direct`, NO `pricingSnapshot` — that is
 * frozen at payment by slice C) and DEEP-COPY each line into a FROZEN `orderItems`
 * row (a denormalised snapshot, NOT FKs into the menu — PRD 10 §7). Unlike
 * `insertTenantOrder`, NO initial `orderEvents` row is appended: the workflow audit
 * starts only once the order becomes visible to the resto (`nouvelle`, at payment).
 * Returns the new order id (consumed by 2.5 to create the PaymentIntent).
 */
export async function insertTenantPendingOrder(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  data: NewPendingOrder,
): Promise<Id<"orders">> {
  const now = Date.now();
  const orderId = await ctx.db.insert("orders", {
    tenantId,
    customerId: data.customerId,
    status: "en attente de paiement",
    mode: data.mode,
    source: "direct", // V1 = direct only (ADR 0009)
    address: data.address,
    lat: data.lat,
    lng: data.lng,
    restaurantNote: data.restaurantNote,
    createdAt: now,
  });

  // Freeze the line items — a denormalised, deep-copied snapshot (PRD 10 §7).
  for (const item of data.items) {
    await ctx.db.insert("orderItems", {
      tenantId,
      orderId,
      itemName: item.itemName,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      modifiers: item.modifiers.map((m) => ({ ...m })),
      allergens: [...item.allergens],
    });
  }

  return orderId;
}

/**
 * Move an order owned by `tenantId` to `status`: patch the `orders` row (status +
 * the matching transition timestamp) and append an `orderEvents` row. Throws
 * NOT_FOUND for a missing OR foreign `orderId` (ownership re-check).
 */
export async function recordTenantOrderStatus(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
  status: OrderStatus,
  opts: { reason?: string; actorUserId?: Id<"users"> } = {},
): Promise<void> {
  await requireTenantOrder(ctx, tenantId, orderId);
  const now = Date.now();
  await ctx.db.patch(orderId, { status, ...transitionStampFor(status) });
  await ctx.db.insert("orderEvents", {
    tenantId,
    orderId,
    status,
    actorUserId: opts.actorUserId,
    reason: opts.reason,
    at: now,
  });
}

// ---------------------------------------------------------------------------
// tenants — operationalPause (the slice's tenant domain field)
// ---------------------------------------------------------------------------

/**
 * Read the calling tenant's operational pause (or `null`). Lives in this
 * sanctioned seam because `tenants` is reached via raw `ctx.db` here; the CALLER
 * (a tenant wrapper handler) has already gated access to `tenantId`.
 */
export async function getTenantOperationalPause(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<{ until: number } | null> {
  const tenant = await ctx.db.get(tenantId);
  return tenant?.operationalPause ?? null;
}

/** Set the tenant's transient operational pause (PRD 20 §7). */
export async function setTenantOperationalPause(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  until: number,
): Promise<void> {
  await ctx.db.patch(tenantId, { operationalPause: { until } });
}

/** Clear the tenant's operational pause (auto-reprise / manual resume). */
export async function clearTenantOperationalPause(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
): Promise<void> {
  await ctx.db.patch(tenantId, { operationalPause: undefined });
}
