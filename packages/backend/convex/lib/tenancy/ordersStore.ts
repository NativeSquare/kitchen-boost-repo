import { ConvexError } from "convex/values";
import { internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  FrozenModifier,
  OrderMode,
  OrderStatus,
  PricingSnapshot,
} from "../../table/orders";
import {
  recordCustomerOrderForTenant,
  revertCustomerOrderForTenant,
} from "./customerOrdersStore";

/** #404 — Auto-expired timeout d'acceptation (PRD 20 §6b + ADR 0016). */
const AUTO_EXPIRED_TIMEOUT_MS = 5 * 60 * 1000;

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
    case "auto_expired":
      return { autoExpiredAt: now };
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
 *
 * `customReason` (ADR 0019) — texte libre propagé sur l'event row, set par le
 * caller seulement quand `reason === "autre"`. La validation (trim + 1-280
 * chars + "autre" requis) vit dans la mutation `refuse` (caller-side guard) ;
 * ici on stocke tel quel ce qui est passé.
 */
export async function recordTenantOrderStatus(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
  status: OrderStatus,
  opts: {
    reason?: string;
    customReason?: string;
    actorUserId?: Id<"users">;
  } = {},
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
    customReason: opts.customReason,
    at: now,
  });
}

/**
 * 2.3-D — the resto WORKFLOW state machine (PRD 20 §5 + the issue body). The CLOSED
 * set of legal edges: every transition NOT listed here is rejected by
 * `assertLegalTransition`. Not invented — each edge is documented:
 *  - `en attente de paiement → nouvelle`  : payment confirmed — for DELIVERY this is
 *                                           gated on the Uber course being created
 *                                           (#108 strict coupling), for PICKUP it is
 *                                           immediate at payment (2.5-B / 2.3-C).
 *  - `en attente de paiement → refusée`   : [[Cmd avortée]] — the delivery course
 *                                           failed post-payment, so the order is
 *                                           aborted while STILL invisible (it was
 *                                           never transmitted to KB Orders, never
 *                                           `nouvelle`), then auto-refunded (#108/#49,
 *                                           payment + delivery CONTEXTs "Cmd avortée").
 *  - `nouvelle → en préparation`          : acknowledge (PRD 20 §5 "Accepter").
 *  - `nouvelle → refusée`                 : refuse (PRD 20 §6, slice E — listed legal
 *                                           so the refusal mutation reuses this guard).
 *  - `nouvelle → auto_expired`            : auto-expired timeout 5 min (#404, PRD 20
 *                                           §6b + ADR 0016, system-side via the
 *                                           Convex scheduler; the seam-side helper
 *                                           `autoExpireTenantOrder` no-ops if the
 *                                           order is no longer `nouvelle`).
 *  - `en préparation → prête`             : markPrepared (PRD 20 §5 "Prête").
 *  - `en préparation → refusée`           : refuse mid-prep (#413, PRD 20 §6a 3-step
 *                                           anti-fat-finger — kitchen had started but
 *                                           must abort: rupture découverte au milieu
 *                                           de la cuisson, incident hygiène). The
 *                                           backend reuses the exact same refund + notif
 *                                           pipeline as `nouvelle → refusée`; the
 *                                           anti-fat-finger discipline (warning step +
 *                                           typed "REFUSER") lives in the UI dialog.
 *  - `prête → remise`                     : markHandedOff (PRD 20 §5 "Remise").
 *  - `prête → refusée`                    : refuse before handoff (#413, PRD 20 §6a
 *                                           3-step variant — cooked but cannot be
 *                                           handed off, e.g. incident découvert
 *                                           juste avant remise au coursier). Same
 *                                           reasoning as `en préparation → refusée`.
 *  - `remise → livrée`                    : delivery, driven by Uber Direct events (2.6).
 *  - `remise → collectée`                 : click & collect, immediate at handoff.
 *
 * Terminal states (`livrée` / `collectée` / `refusée` / `auto_expired`) have NO
 * outgoing edge — they are non-re-transitionable. Post-handoff (`remise`) is also
 * non-refusable: the order has left the door (delivery is on Uber Direct from
 * there, a collected order is gone).
 */
const LEGAL_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  {
    "en attente de paiement": ["nouvelle", "refusée"],
    nouvelle: ["en préparation", "refusée", "auto_expired"],
    // #413 — `en préparation → refusée` and `prête → refusée` are legal so
    // the cuisinier can abort mid-flight for genuine incidents (rupture
    // découverte, hygiène, panne frigo). The cost-of-error discipline is
    // the UI 3-step dialog (#413), NOT a backend block.
    "en préparation": ["prête", "refusée"],
    prête: ["remise", "refusée"],
    remise: ["livrée", "collectée"],
    livrée: [],
    collectée: [],
    refusée: [],
    auto_expired: [],
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
  opts: {
    reason?: string;
    customReason?: string;
    actorUserId?: Id<"users">;
  } = {},
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
  "auto_expired",
];

/**
 * The KB Orders LIVE queue: a tenant's orders the kitchen is actively working,
 * newest first. EXCLUDES `en attente de paiement` (invisible until paid, PRD 10
 * §10/§11) AND the terminal states (archived into the history). Built on the
 * tenant-scoped `listTenantOrders` then filtered — small per-tenant cardinality.
 *
 * V1 quirk (#401, KBO-CMD1 spot 2026-06-05) : `remise` is filtered out of the
 * home queue too. Per PRD §5 `remise` waits for an Uber Direct webhook (delivery)
 * or an immediate archive (click & collect) to reach a true terminal state, but
 * the Uber webhook is V2 scope (no V1 wiring), so without this filter a delivery
 * order tapped `Remise au coursier` would stick to the home queue forever. The
 * `remise` row stays as-is in the DB (and is NOT included in the history list
 * either — see `listTenantTerminalOrders`) until V2 lands the webhook.
 */
export async function listTenantLiveOrders(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"orders">[]> {
  const all = await listTenantOrders(ctx, tenantId);
  return all.filter(
    (o) =>
      o.status !== "en attente de paiement" &&
      o.status !== "remise" &&
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

  // #404 — Arm the 5-min "timeout d'acceptation" failsafe (PRD 20 §6b + ADR
  // 0016). The order has just become `nouvelle`, the kitchen has 5 minutes to
  // acknowledge it. At the tick, `expireIfNotAcknowledged` re-reads the current
  // status and no-ops if the cuisinier already accepted / refused — THAT
  // idempotence is the entire point of the single-tick design (the scheduler
  // may fire after a human ack, double-refund must never happen). Symmetric
  // for both fulfilment paths: PICKUP confirms here directly from 2.5-B; the
  // gated DELIVERY confirms here too once the Uber course is created (2.6-C).
  // Scheduling inside the same Convex mutation commits or rolls back with the
  // transition — no orphan tick on a rolled-back confirmation.
  await ctx.scheduler.runAfter(
    AUTO_EXPIRED_TIMEOUT_MS,
    internal.lib.orders.workflow.expireIfNotAcknowledged,
    { tenantId, orderId },
  );
}

/**
 * B-REFUND-PUBLIC-ACTION (#221) — MANAGER-DRIVEN refund a posteriori: transition
 * a paid order to TERMINAL `refusée` from ANY non-`refusée` state (including the
 * other terminals `livrée` / `collectée`). Distinct from both kitchen seams:
 *  - `transitionTenantOrder("refusée")` — state-machine guarded, only `nouvelle
 *    → refusée` (`refuse` mutation, kitchen Refusal from `nouvelle`).
 *  - `abortTenantOrder` — system-side [[Cmd avortée]] (auto-refund), refuses any
 *    non-terminal state but a no-op on ALL terminals (incl. `livrée`/`collectée`)
 *    AND compensates the MOAT stats it had previously incremented.
 *
 * THIS seam is the MANAGER-driven refund: the order may already be `livrée` or
 * `collectée` (a litigation post-delivery), so we cannot bail on terminals — only
 * `refusée` itself is the no-go (refunding an already-refunded order is the
 * caller's contract, not this seam's). NO MOAT compensation here, consistent
 * with the kitchen `refuse` semantics (PRD 20 §6 + payment CONTEXT "Refund"):
 * the order historically happened from the customer's perspective; the MOAT
 * activity is preserved.
 *
 * Re-checks tenant ownership (NOT_FOUND for a foreign id). Stamps `refusedAt`
 * and appends a `refusée` `orderEvents` row carrying the actor + free-text
 * reason. Caller is responsible for refusing the call if `status === "refusée"`
 * (the public action does so BEFORE the Stripe refund, so a re-trigger never
 * even reaches the Stripe `POST /refunds`).
 */
export async function manuallyRefundTenantOrder(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
  opts: { reason?: string; actorUserId?: Id<"users"> } = {},
): Promise<void> {
  await requireTenantOrder(ctx, tenantId, orderId);
  const now = Date.now();
  await ctx.db.patch(orderId, { status: "refusée", refusedAt: now });
  await ctx.db.insert("orderEvents", {
    tenantId,
    orderId,
    status: "refusée",
    actorUserId: opts.actorUserId,
    reason: opts.reason,
    at: now,
  });
}

/**
 * 2.3-fix (#108) — the SYSTEM-SIDE [[Cmd avortée]] abort: pull one of `tenantId`'s
 * orders OUT of KB Orders to the TERMINAL `refusée` from ANY non-terminal state,
 * COMPENSATING the MOAT stats if (and only if) the order had already been counted.
 * Distinct from the kitchen `transitionTenantOrder`: this is not a kitchen action
 * (it is the auto-refund's order side, #49), so it does NOT go through the kitchen
 * state-machine edge guard — instead it accepts the two real aborted-order shapes
 * the strict coupling produces:
 *  - the gated DELIVERY order still `en attente de paiement` (course failed before
 *    it was ever transmitted) — never `nouvelle`, never counted ⇒ no compensation;
 *  - an already-confirmed order (`nouvelle`+ worked, e.g. incident-after-pickup Cas C)
 *    ⇒ its previously-posted `customerOrdersPerTenant` increment is reverted.
 * IDEMPOTENT: an order already `refusée` (a re-trigger) is left as-is — no second
 * event, no double compensation. Returns whether it aborted this call. The "already
 * counted" signal is `paidAt` being set — it is stamped EXACTLY when the order is
 * confirmed and its stats are recorded (`confirmTenantOrderPayment`), so the two are
 * always in lockstep. Re-checks tenant ownership (NOT_FOUND for a foreign id).
 */
export async function abortTenantOrder(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
  opts: { reason?: string } = {},
): Promise<{ aborted: boolean }> {
  const order = await requireTenantOrder(ctx, tenantId, orderId);
  // Already terminal (re-trigger) ⇒ nothing to abort, no second compensation.
  if (TERMINAL_ORDER_STATUSES.includes(order.status)) {
    return { aborted: false };
  }

  // Compensate the MOAT stats ONLY if they were posted (order had been confirmed —
  // `paidAt` is set in lockstep with the stats increment). The gated delivery order
  // (`en attente de paiement`, never confirmed) has no `paidAt` ⇒ nothing to revert.
  if (order.paidAt !== undefined && order.pricingSnapshot !== undefined) {
    await revertCustomerOrderForTenant(ctx, tenantId, order.customerId, {
      totalCents: order.pricingSnapshot.total,
    });
  }

  // Patch + append the terminal `refusée` event directly off the already-loaded
  // `order` (not via `recordTenantOrderStatus`, which would re-`requireTenantOrder`
  // — one fewer DB round-trip in this scheduled path).
  const now = Date.now();
  await ctx.db.patch(orderId, { status: "refusée", refusedAt: now });
  await ctx.db.insert("orderEvents", {
    tenantId,
    orderId,
    status: "refusée",
    reason: opts.reason,
    at: now,
  });
  return { aborted: true };
}

/**
 * #404 — Auto-expired timeout 5 min (PRD 20 §6b + ADR 0016 + kb-orders CONTEXT
 * "Cmd manquée"). The SYSTEM-SIDE tick of the Convex scheduler armed at
 * `confirmTenantOrderPayment` (when the order becomes `nouvelle`):
 *  - if the order is still `nouvelle` ⇒ transition `nouvelle → auto_expired`
 *    (TERMINAL — distinct from `refusée`, ADR 0016 signaux orthogonaux): patch
 *    the status + `autoExpiredAt`, append the timestamped `auto_expired`
 *    `orderEvents` row (no `actorUserId` — the trigger is the scheduler, not a
 *    cuisinier). Returns `{ expired: true }`.
 *  - if the order has ALREADY transitioned (acceptée, refusée humain, ou même
 *    déjà `auto_expired` sur un re-tick) ⇒ CLEAN NO-OP. No transition, no
 *    event, no Stripe refund: the caller (`expireIfNotAcknowledged`) gates its
 *    refund + notif on `{ expired: true }`. This idempotence IS the whole
 *    reason ADR 0016 chose a single scheduled tick checking current state at
 *    fire time — the scheduler may fire after the cuisinier already accepted
 *    or refused the order, and a double refund would be a regression.
 *  - if `orderId` belongs to ANOTHER tenant ⇒ NOT_FOUND from
 *    `requireTenantOrder` ⇒ caught here as a no-op (a system-scheduled tick
 *    armed on a tenant must never write to another tenant, ADR 0010).
 * Returns `{ expired: boolean }` — the caller branches on it to queue the
 * client `refund_issued` notification + schedule the Stripe refund (#403's
 * `refundOnRefusal` action, REUSED — no new Stripe path invented).
 */
export async function autoExpireTenantOrder(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
): Promise<{ expired: boolean }> {
  // Tenant-ownership re-check via the same seam every order helper uses. A
  // foreign or missing id resolves to `null` ⇒ no-op (a system-scheduled tick
  // never writes cross-tenant; the order is simply unreachable from here).
  const order = await getTenantOrder(ctx, tenantId, orderId);
  if (order === null) return { expired: false };
  // THE idempotence guard: only `nouvelle` ⇒ `auto_expired` (every other state,
  // including already-`auto_expired` on a re-tick, is a clean no-op).
  if (order.status !== "nouvelle") return { expired: false };

  const now = Date.now();
  await ctx.db.patch(orderId, {
    status: "auto_expired",
    autoExpiredAt: now,
  });
  // System-side write: no `actorUserId` (the trigger is the scheduler, not a
  // human) — same shape as the `auto_expired` orderEvents the historique reads
  // for the « Manquées » tab (PRD 20 §8 + #415).
  await ctx.db.insert("orderEvents", {
    tenantId,
    orderId,
    status: "auto_expired",
    at: now,
  });
  return { expired: true };
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

// ---------------------------------------------------------------------------
// tenants — exceptionalClosure (#397 — durable 1+ jour, PRD 20 §7b / ADR 0018)
// ---------------------------------------------------------------------------

/**
 * Read the calling tenant's exceptional closure (or `null`). Same access
 * discipline as `getTenantOperationalPause`: the `tenants` row is reached via
 * raw `ctx.db` here, but the CALLER (a tenant wrapper handler) has already
 * gated access to `tenantId`. Closure is a DURABLE absence (vacances, panne
 * frigo, intempéries) with a `from`/`until` window — distinct from the
 * transient `operationalPause` (15-60 min) and from the lifecycle `status`.
 */
export async function getTenantExceptionalClosure(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<{ from: number; until: number } | null> {
  const tenant = await ctx.db.get(tenantId);
  return tenant?.exceptionalClosure ?? null;
}

/**
 * Set the tenant's exceptional closure (PRD 20 §7b). `from`/`until` are epoch
 * ms; the validator that lives in `lib/orders/orders.ts` already enforces
 * `from < until` before reaching this seam (so the persisted row is always
 * meaningful — no zero-length or inverted window stored).
 */
export async function setTenantExceptionalClosure(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  from: number,
  until: number,
): Promise<void> {
  await ctx.db.patch(tenantId, { exceptionalClosure: { from, until } });
}

/** Clear the tenant's exceptional closure (auto-reprise / manual reopen). */
export async function clearTenantExceptionalClosure(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
): Promise<void> {
  await ctx.db.patch(tenantId, { exceptionalClosure: undefined });
}
