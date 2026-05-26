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
  frozenModifier,
  orderMode,
  orderSource,
  orderStatus,
  pricingSnapshot,
} from "../../table/orders";
