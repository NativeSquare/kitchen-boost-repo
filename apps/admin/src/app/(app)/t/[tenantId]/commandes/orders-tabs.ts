/**
 * #415 — `orders-tabs`, the pure module backing the 4 history tabs on the
 * KB Admin Commandes page (PRD 20 §8: « Toutes | Livrées/Collectées |
 * Refusées | Manquées »).
 *
 * Two responsibilities, both pure (no React, no Convex), both tested in
 * isolation under `environment: "node"`:
 *
 *  1. `ORDER_TABS` + `STATUSES_FOR_TAB(key)` — the 4 tab definitions + their
 *     mapping to a subset of `orderStatus` values. The « Manquées » tab maps
 *     to the SINGLE terminal state `auto_expired` (PRD 20 §6b + ADR 0016 +
 *     kb-orders CONTEXT « Cmd manquée »), DISTINCT from `refusée` (« Refusées »
 *     tab) — signaux orthogonaux (refusing them in the same bucket would
 *     conflate ops signals with business signals, the bug ADR 0016 fixes).
 *
 *  2. `applyTabFilter(orders, tabKey)` + `searchOrdersById(orders, query)`
 *     — the two pure predicates the page composes on top of the existing
 *     `filterOrders` date+status pipe. Both preserve input order (the
 *     backend hands DESC by `createdAt` — no defensive re-sort).
 *
 *     `searchOrdersById` is INTENTIONALLY ID-only: MOAT / ADR 0010 / PRD 70
 *     §4.4 — customer names are NEVER queryable from KB Admin (the
 *     kb_manager view of customers is KPI-only; a name search would let
 *     the resto reconstruct a customer rolodex one query at a time).
 *     Issue body « par ID cmd, par nom client si possible avec MOAT » →
 *     MOAT forbids name, so we keep ID only.
 *
 * Scope discipline (#415): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/` — zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/lib/orders/`. The
 * backend `auto_expired` status itself was shipped by #404 (PR #431); this
 * module only sorts + slices the front-side payload.
 */
import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import type { OrderStatus } from "./orders-filtering";

/** The 4 tab keys (PRD 20 §8 left-to-right reading order). */
export type OrderTabKey = "all" | "delivered_collected" | "refused" | "missed";

/** One tab as rendered above the orders table. */
export type OrderTab = {
  key: OrderTabKey;
  /** FR customer-facing copy (mirrors the gérant's vocabulary). */
  label: string;
};

/**
 * The 4 tabs in canonical PRD 20 §8 order. Pinned by `orders-tabs.test.ts` —
 * a reorder fires there so the regression is visible. « Toutes » FIRST so
 * the page boots on the broadest view (« scan all activity, then narrow »
 * — same default discipline as `orders-filtering`'s `dateRange: "tout"`).
 */
export const ORDER_TABS: readonly OrderTab[] = [
  { key: "all", label: "Toutes" },
  { key: "delivered_collected", label: "Livrées / Collectées" },
  { key: "refused", label: "Refusées" },
  { key: "missed", label: "Manquées" },
] as const;

/**
 * The status subset a tab maps to, or `null` for the « Toutes » passthrough
 * (the page-level applier distinguishes passthrough from « empty set »
 * via `null` vs `[]` — same convention as `orders-filtering`).
 *
 * The mapping is EXACT — adding a new V2 terminal status (e.g. `refunded`)
 * surfaces here as a TS compilation error (`OrderStatus` literal mismatch)
 * AND in the unit test, so the new status can't silently land outside any
 * tab.
 */
export function STATUSES_FOR_TAB(key: OrderTabKey): OrderStatus[] | null {
  switch (key) {
    case "all":
      // Null = passthrough (no status restriction). Distinguishes the « show
      // everything » intent from « show nothing » (an empty array).
      return null;
    case "delivered_collected":
      // PRD 20 §5: the two happy-path terminals (delivery vs click & collect).
      return ["livrée", "collectée"];
    case "refused":
      // PRD 20 §6a — human refusal with motif. DISTINCT from auto_expired.
      return ["refusée"];
    case "missed":
      // PRD 20 §6b + ADR 0016 — operational terminal. The whole #415 point.
      return ["auto_expired"];
  }
}

/**
 * Restrict `orders` to the tab's status subset. Pure: same input, same
 * output. Preserves input order (the backend already sorts DESC; the tab
 * filter must not re-sort).
 *
 * Composes commutatively with `filterOrders` (the existing date + status
 * pipe) and `searchOrdersById` — the page applies them in any order
 * without changing the result set.
 */
export function applyTabFilter(
  orders: Doc<"orders">[],
  tabKey: OrderTabKey,
): Doc<"orders">[] {
  const allowed = STATUSES_FOR_TAB(tabKey);
  if (allowed === null) return orders; // passthrough on « Toutes »
  const set = new Set<string>(allowed);
  return orders.filter((o) => set.has(o.status));
}

/**
 * Case-insensitive substring search over `String(order._id)`. Empty /
 * whitespace-only query is a passthrough (preserves the existing filter
 * pipeline shape; same discipline as the date+status passthrough).
 *
 * Pure, no `Date.now()`, no I/O. Re-runs cheaply on every keystroke from
 * the page-level search input.
 *
 * MOAT discipline (ADR 0010 / PRD 70 §4.4 / customer-data CONTEXT):
 *  - The search is ID-ONLY. Customer names are NEVER searchable from KB
 *    Admin (the kb_manager view of customers is KPI-only; exposing a
 *    `customers.firstName` substring index would let a resto rebuild a
 *    customer rolodex one query at a time, breaking the moat).
 *  - The order id IS surfaced to the gérant (it lands on Stripe receipts
 *    + the order detail modal), so searching by it is the documented
 *    workflow (« Khan a un client au téléphone qui pose une question sur
 *    cmd `orders_abc123`, il cherche par ID »).
 */
export function searchOrdersById(
  orders: Doc<"orders">[],
  query: string,
): Doc<"orders">[] {
  const trimmed = query.trim();
  if (trimmed.length === 0) return orders;
  const needle = trimmed.toLowerCase();
  return orders.filter((o) => String(o._id).toLowerCase().includes(needle));
}
