/**
 * Public API of the `orders` backend module (chantier 2.3 — Orders + Cart, PRD
 * 10 Client Ordering + PRD 20 KB Orders).
 *
 * 2.3-A — the data foundation: the tenant-scoped `orders` table, its FROZEN
 * `orderItems` snapshot (a denormalised copy of name/price/modifiers/allergens at
 * order time, NOT FKs into the menu — PRD 10 §7, so an order is self-contained
 * and does NOT structurally depend on the menu tables), the append-only
 * `orderEvents` audit, and the tenant `operationalPause` ("Pause exceptionnelle",
 * PRD 20 §7).
 *
 * Isolation (ADR 0010): every function goes through a tenancy wrapper and reaches
 * the tables only through the sanctioned `lib/tenancy/ordersStore` seam — no raw
 * `ctx.db` in this module. Ships a cross-tenant fuzz suite.
 *
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.orders.orders.*`; re-exporting here does not change that address — it
 * states the module's contract in one place. The guarded query/mutation functions
 * are therefore NOT re-exported (a barrel re-export would not change their
 * callable path); only the shared TYPES + validators are surfaced here.
 *
 *  - orders: `placeOrder` (checkout write, audited), `recordStatus` (kitchen
 *    workflow, kb_manager + staff, audited), `listOrders`, `getOrder`.
 *  - operationalPause: `setOperationalPause`, `clearOperationalPause`,
 *    `getOperationalPause`.
 *  - workflow (2.3-C): `confirmPayment` (api.lib.orders.workflow.confirmPayment)
 *    — the ORDER-SIDE handler of a confirmed payment. In one transaction it
 *    transitions `en attente de paiement → nouvelle`, stamps `paidAt`, freezes the
 *    `pricingSnapshot`, appends the `nouvelle` event, and increments
 *    `customerOrdersPerTenant`. Consumed idempotently via the foundation
 *    `withIdempotence` (1.x-F) so a replayed event neither re-transitions nor
 *    double-counts. NO Stripe call here — that frontier is 2.5.
 *  - workflow (2.3-D): the kitchen state machine `acknowledge` / `markPrepared` /
 *    `markHandedOff` + the reads `tenantOrders` / `tenantOrderHistory` / `myOrders`
 *    / `myOrder` (api.lib.orders.workflow.*).
 *  - workflow (2.3-E): `refuse` (api.lib.orders.workflow.refuse) — the resto
 *    refuses a `nouvelle` order in ONE atomic transaction: transition
 *    `nouvelle → refusée` (terminal, state-machine guarded) + EMIT the refund order
 *    toward 2.5 (the `refusée` orderEvent carrying the closed-set `reason` IS that
 *    order — no Stripe call, no `payments` table touched here; the refund EXECUTION
 *    is 2.5/#49) + EMIT the client `refund_issued` notification (queued; the send is
 *    2.7). `reason` ∈ {rupture, fermeture, surcharge, autre} (`refusalReason`).
 *  - status (2.3-F): `acceptsOrderNow` (api.lib.orders.status.acceptsOrderNow) — the
 *    PUBLIC gate the PWA checkout obeys: `true` iff the resto is WITHIN a service
 *    window (2.2-E `isWithinServiceHours`, REUSED) AND not currently paused (2.3-A
 *    `operationalPause`). Closed OR paused ⇒ refused (no pre-order V1, PRD 10 edge);
 *    the pause auto-expires from `until` (no cron). The same rule is wired INTO the
 *    checkout: `createOrderFromCart` (slice B) calls `tenantAcceptsOrderNow` and
 *    rejects when it is `false`. The pause TOGGLE (`setOperationalPause` /
 *    `clearOperationalPause`, audited `tenantMutation`s) lives in the `orders`
 *    module (2.3-A); this slice adds only the COMBINED read + the checkout gate.
 *    The pure combiners (`isPauseActive`, `acceptsOrders`) + the shared resolver
 *    (`tenantAcceptsOrderNow`) are surfaced here; the registered query is reached by
 *    its module path, so it is NOT re-exported.
 *
 * The row shapes (status workflow, mode, source, frozen modifier, pricing
 * snapshot) live in the table validators, surfaced here as the module's typed
 * contract.
 */
export {
  type FrozenModifier,
  type OrderMode,
  type OrderSource,
  type OrderStatus,
  type PricingSnapshot,
  type RefusalReason,
  frozenModifier,
  orderMode,
  orderSource,
  orderStatus,
  pricingSnapshot,
  refusalReason,
} from "../../table/orders";
export {
  type ExceptionalClosure,
  type OperationalPause,
  acceptsOrders,
  isClosureActive,
  isPauseActive,
  tenantAcceptsOrderNow,
} from "./status";
