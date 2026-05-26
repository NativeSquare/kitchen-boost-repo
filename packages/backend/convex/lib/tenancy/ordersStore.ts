import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  FrozenModifier,
  OrderMode,
  OrderStatus,
  PricingSnapshot,
} from "../../table/orders";
import { recordCustomerOrderForTenant } from "./customerOrdersStore";

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

/**
 * 2.3-D — the resto WORKFLOW state machine (PRD 20 §5 + the issue body). The CLOSED
 * set of legal edges: every transition NOT listed here is rejected by
 * `assertLegalTransition`. Not invented — each edge is documented:
 *  - `en attente de paiement → nouvelle`  : payment confirmed (2.3-C confirmPayment).
 *  - `nouvelle → en préparation`          : acknowledge (PRD 20 §5 "Accepter").
 *  - `nouvelle → refusée`                 : refuse (PRD 20 §6, slice E — listed legal
 *                                           so the refusal mutation reuses this guard).
 *  - `en préparation → prête`             : markPrepared (PRD 20 §5 "Prête").
 *  - `prête → remise`                     : markHandedOff (PRD 20 §5 "Remise").
 *  - `remise → livrée`                    : delivery, driven by Uber Direct events (2.6).
 *  - `remise → collectée`                 : click & collect, immediate at handoff.
 *
 * Terminal states (`livrée` / `collectée` / `refusée`) have NO outgoing edge — they
 * are non-re-transitionable.
 */
const LEGAL_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  {
    "en attente de paiement": ["nouvelle"],
    nouvelle: ["en préparation", "refusée"],
    "en préparation": ["prête"],
    prête: ["remise"],
    remise: ["livrée", "collectée"],
    livrée: [],
    collectée: [],
    refusée: [],
  };

/**
 * Whether `from → to` is a legal workflow edge (PRD 20 §5). Pure — no DB access.
 */
export function isLegalTransition(from: OrderStatus, to: OrderStatus): boolean {
  return LEGAL_TRANSITIONS[from].includes(to);
}

/**
 * Throw `INVALID_STATE` unless `from → to` is a legal workflow edge. Centralises the
 * state-machine guard so a state jump (e.g. `nouvelle → remise`) or a re-transition
 * of a terminal order (e.g. `livrée → nouvelle`) is rejected, never silently applied.
 */
export function assertLegalTransition(
  from: OrderStatus,
  to: OrderStatus,
): void {
  if (!isLegalTransition(from, to)) {
    throw new ConvexError({
      code: "INVALID_STATE",
      message: `Illegal order transition "${from}" → "${to}".`,
    });
  }
}

/**
 * 2.3-D — advance one of `tenantId`'s orders to `to` THROUGH THE STATE MACHINE: it
 * re-checks tenant ownership (NOT_FOUND for a missing OR foreign id — no
 * cross-tenant write), GUARDS the edge with `assertLegalTransition` (an illegal
 * transition throws and writes nothing), patches the status + its transition
 * timestamp, and appends a timestamped `orderEvents` row. Returns the new status.
 * The single sanctioned `ctx.db` site for a guarded workflow transition; the
 * business module (`lib/orders/workflow`, NOT exempt) calls THIS, never raw `ctx.db`.
 */
export async function transitionTenantOrder(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
  to: OrderStatus,
  opts: { reason?: string; actorUserId?: Id<"users"> } = {},
): Promise<OrderStatus> {
  const order = await requireTenantOrder(ctx, tenantId, orderId);
  assertLegalTransition(order.status, to);
  await recordTenantOrderStatus(ctx, tenantId, orderId, to, opts);
  return to;
}

/**
 * The terminal workflow states (PRD 20 §5): an order is archived out of the kitchen
 * queue and into the history once it reaches one of these.
 */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = [
  "livrée",
  "collectée",
  "refusée",
];

/**
 * The KB Orders LIVE queue: a tenant's orders the kitchen is actively working,
 * newest first. EXCLUDES `en attente de paiement` (invisible until paid, PRD 10
 * §10/§11) AND the terminal states (archived into the history). Built on the
 * tenant-scoped `listTenantOrders` then filtered — small per-tenant cardinality.
 */
export async function listTenantLiveOrders(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"orders">[]> {
  const all = await listTenantOrders(ctx, tenantId);
  return all.filter(
    (o) =>
      o.status !== "en attente de paiement" &&
      !TERMINAL_ORDER_STATUSES.includes(o.status),
  );
}

/** A tenant's TERMINAL orders (livrée / collectée / refusée), newest first. */
export async function listTenantTerminalOrders(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"orders">[]> {
  const all = await listTenantOrders(ctx, tenantId);
  return all.filter((o) => TERMINAL_ORDER_STATUSES.includes(o.status));
}

/**
 * A customer's OWN orders at one tenant, newest first. SELF-SCOPED: the caller
 * (a `customerQuery` handler) has resolved `customerId` from its OWN
 * `ctx.actor.userId`; reads are keyed on the `by_customer_created` index then
 * filtered to `tenantId`, so no other customer's order is reachable. An order from
 * another tenant is excluded by the `tenantId` filter.
 */
export async function listCustomerOwnOrdersForTenant(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
): Promise<Doc<"orders">[]> {
  const rows = await ctx.db
    .query("orders")
    .withIndex("by_customer_created", (q) => q.eq("customerId", customerId))
    .order("desc")
    .collect();
  return rows.filter((o) => o.tenantId === tenantId);
}

/**
 * One of a customer's OWN orders WITH detail (frozen items + events) at `tenantId`,
 * or `null`. SELF-SCOPED: returns the order only if BOTH the tenant matches AND the
 * order belongs to `customerId` (the caller's own fiche), so a foreign customer's
 * order id reads as `null` (no existence oracle), like the resto-side
 * `getTenantOrderWithDetail`.
 */
export async function getCustomerOwnOrderWithDetail(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
  orderId: Id<"orders">,
): Promise<OrderWithDetail | null> {
  const order = await getTenantOrder(ctx, tenantId, orderId);
  if (order === null || order.customerId !== customerId) return null;
  const [items, events] = await Promise.all([
    listTenantOrderItems(ctx, tenantId, orderId),
    listTenantOrderEvents(ctx, tenantId, orderId),
  ]);
  return { ...order, items, events };
}

/**
 * 2.3-C — apply a CONFIRMED payment to one of `tenantId`'s pending orders, in a
 * SINGLE Convex transaction (atomicity = all-or-nothing):
 *  1. require the order belongs to `tenantId` (NOT_FOUND for a missing OR foreign
 *     id — no cross-tenant write),
 *  2. STATE-MACHINE GUARD: it MUST be `en attente de paiement` (PRD 20 §5 / PRD 10
 *     §10-§11) — else throw `INVALID_STATE` (a confirm on an already-paid / further
 *     order is rejected, never silently re-applied),
 *  3. patch it to `nouvelle` (visible to the resto), stamp `paidAt`, and FREEZE the
 *     `pricingSnapshot` (the immutable charged amount, from 2.4),
 *  4. append the `nouvelle` `orderEvents` (the workflow audit starts here — the
 *     pending order had none),
 *  5. increment `customerOrdersPerTenant` for the order's OWN `(tenant, customer)`.
 *
 * No payment / Stripe call here (frontier 2.5) — the caller supplies the already-
 * frozen `pricingSnapshot`. Idempotency is the CALLER's concern (`withIdempotence`
 * wraps this), so this helper assumes it runs at most once per confirmed event.
 */
export async function confirmTenantOrderPayment(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
  pricingSnapshot: PricingSnapshot,
  actorUserId?: Id<"users">,
): Promise<void> {
  const order = await requireTenantOrder(ctx, tenantId, orderId);
  if (order.status !== "en attente de paiement") {
    throw new ConvexError({
      code: "INVALID_STATE",
      message: `Order is "${order.status}", expected "en attente de paiement".`,
    });
  }

  const now = Date.now();
  await ctx.db.patch(orderId, {
    status: "nouvelle",
    paidAt: now,
    pricingSnapshot,
  });
  await ctx.db.insert("orderEvents", {
    tenantId,
    orderId,
    status: "nouvelle",
    actorUserId,
    at: now,
  });

  // Per-tenant customer stats (the MOAT aggregates) — the order's OWN customer.
  await recordCustomerOrderForTenant(ctx, tenantId, order.customerId, {
    totalCents: pricingSnapshot.total,
    orderAt: now,
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
