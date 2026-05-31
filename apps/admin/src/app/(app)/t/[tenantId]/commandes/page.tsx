"use client";

/**
 * F-COMMANDES-PAGE-SHELL (#222) + F-COMMANDES-LIVE-TABLE (#227) +
 * F-COMMANDES-FILTERS (#238) — Route `/t/[tenantId]/commandes/`.
 *
 * Slice 1 (#222) shipped a scaffold-only page (no data wired). Slice 2 (#227)
 * wired the live orders table to the canonical Convex read. Slice 3 (#238,
 * THIS file's current contract) holds the filter state on the page (per
 * EPIC #141 « état local `useState` sur la page, pas d'URL query params V1 »)
 * and applies the pure `filterOrders(orders, filter)` to the live payload
 * before passing it to the view:
 *
 *   const orders = useTenantQuery(api.lib.orders.orders.listOrders);
 *   const [filter, setFilter] = useState<OrdersFilter>(DEFAULT_FILTER);
 *   const filtered = orders === undefined ? undefined : filterOrders(orders, filter);
 *   return (
 *     <CommandesView
 *       orders={filtered}
 *       filter={filter}
 *       onDateRangeChange={…}
 *       onStatusesChange={…}
 *     />
 *   );
 *
 * Why this shape:
 *   - `useTenantQuery` (ADR 0014 paragraph 4 / #183) reads `tenantId` from
 *     `<TenantProvider/>` (mounted by the chrome-less `/t/[tenantId]` layout)
 *     and injects it into the args. The page does NOT thread `tenantId` by
 *     hand and does NOT call raw `useQuery` (which would either fail
 *     Forbidden or — worse — silently leak the wrong tenant's data, ADR
 *     0010).
 *   - The query is already `tenantQuery({allow: ["kb_manager", "staff"]})`
 *     server-side, indexed `by_tenant_status`, sort DESC on `createdAt`
 *     (cf. `packages/backend/convex/lib/orders/orders.ts`). The kitchen
 *     workflow + staff visibility are honoured by the wrapper; the page
 *     mounts under the `(app)/t/[tenantId]` layout that gates access.
 *   - One single subscription per page mount (no N+1): we ONLY call
 *     `useTenantQuery` once, on `listOrders`. The filter is a CLIENT-SIDE
 *     concern — no extra backend round-trip when the gérant picks a date
 *     preset or toggles a status pill (AC: « re-render local, pas de
 *     nouveau fetch backend »).
 *   - `filterOrders` is pure and re-runs on every render — a live Convex
 *     push that lands while a filter is active produces a fresh `orders`
 *     payload, the filter re-applies, and the table includes/hides the new
 *     line according to the current selection (AC8 « le filtre s'applique
 *     au résultat live, pas a un snapshot »). No `useEffect`, no derived
 *     state, no race against a snapshot.
 *
 * Reactivity (EPIC #141 decision, 2026-05-29): Convex's WebSocket transport
 * pushes a fresh result whenever any backend mutation touches the tenant's
 * orders (Stripe webhook `confirmPayment` flipping `en attente de paiement →
 * nouvelle`, kitchen workflow `recordStatus`, refund). The table updates
 * without manual refresh — no SSE/WebSocket plumbing required.
 *
 * Access guard: inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04, #175) — a KB Manager who
 * tries to reach a tenant they don't own is rejected by `decideTenantGate`
 * before this page ever renders; a KB Admin reaching a non-existent
 * `tenantId` gets a clean 404. Cross-tenant fuzz at the backend layer is
 * owned by the `tenantQuery` wrapper of `listOrders` itself (ADR 0010) —
 * the wrapper refuses Forbidden even if a future regression bypassed the
 * layout. We do NOT duplicate those pins here.
 *
 * Sidebar entry: the « Commandes » entry was added to the operational
 * sidebar by F-SHELL-06 (#196); its contract is re-pinned from
 * `sidebar-entry.test.ts`.
 *
 * Out of scope this slice (later slices of EPIC #141): modal détail, action
 * remboursement, export CSV. The page therefore does NOT call
 * `useTenantMutation` / `useTenantAction` / a refund entrypoint, and does
 * NOT reference `getOrder` — see `page.test.ts` for the negative pins.
 *
 * Scope discipline (#238 hard constraint, mirrors menu/page.tsx,
 * mes-clients/page.tsx, parametres/page.tsx, qr/page.tsx): this file (and
 * its siblings under `apps/admin/src/app/(app)/t/[tenantId]/commandes/`) is
 * the ONLY surface touched by this story. Zero touch to `apps/web`,
 * `apps/native`, `packages/backend/convex/`, or the shared admin sidebar.
 */

import { useMemo, useState } from "react";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { useTenantQuery } from "@/hooks";

import { CommandesView } from "./commandes-view";
import { OrderDetailModal } from "./order-detail-modal";
import {
  filterOrders,
  type DateRangeKey,
  type OrderStatus,
  type OrdersFilter,
} from "./orders-filtering";

/**
 * Initial filter state on first mount: « tout » date range + no status
 * filter (the gérant sees everything, then narrows down). EPIC #141 actes
 * this as the default — they want to scan all recent activity by default,
 * not be greeted with an empty table because of an implicit filter.
 */
const DEFAULT_FILTER: OrdersFilter = {
  dateRange: "tout",
  statuses: [],
};

export default function CommandesPage() {
  const orders = useTenantQuery(api.lib.orders.orders.listOrders, {});
  const [filter, setFilter] = useState<OrdersFilter>(DEFAULT_FILTER);

  // F-COMMANDES-DETAIL-MODAL (#239) — page-owned modal state. `null` =
  // closed, no `getOrder` subscription open. Otherwise the id of the order
  // whose detail is showing. We use a single piece of state (not separate
  // `open` + `selectedId`) so a stale id can never linger after close.
  const [selectedOrderId, setSelectedOrderId] = useState<Id<"orders"> | null>(
    null,
  );

  // Bind `getOrder` via useTenantQuery, but pass "skip" until a row is
  // selected — otherwise Convex would open a subscription on every page
  // mount even before the gérant clicks a row (« Pas de N+1 » remains the
  // invariant from F-COMMANDES-LIVE-TABLE; the detail subscription only
  // opens on demand). Once selected, the query refires on every backend
  // mutation that touches THIS order — the modal stays live without manual
  // refresh, mirroring the table's reactivity discipline.
  const detail = useTenantQuery(
    api.lib.orders.orders.getOrder,
    selectedOrderId === null ? "skip" : { orderId: selectedOrderId },
  );

  const handleDateRangeChange = (next: DateRangeKey) => {
    setFilter((prev) => ({ ...prev, dateRange: next }));
  };
  const handleStatusesChange = (next: OrderStatus[]) => {
    setFilter((prev) => ({ ...prev, statuses: next }));
  };
  const handleOrderClick = (orderId: Id<"orders">) => {
    setSelectedOrderId(orderId);
  };
  const handleOpenChange = (open: boolean) => {
    if (!open) setSelectedOrderId(null);
  };

  // Apply the pure predicate to the live payload — re-runs on every Convex
  // push because the `orders` reference changes when the wrapper re-fires
  // (AC8 « le filtre s'applique au resultat live »). Memoised on
  // (orders, filter) to avoid re-filtering on unrelated re-renders.
  const filtered = useMemo(
    () => (orders === undefined ? undefined : filterOrders(orders, filter)),
    [orders, filter],
  );

  return (
    <>
      <CommandesView
        orders={filtered}
        filter={filter}
        onDateRangeChange={handleDateRangeChange}
        onStatusesChange={handleStatusesChange}
        onOrderClick={handleOrderClick}
      />
      <OrderDetailModal
        open={selectedOrderId !== null}
        onOpenChange={handleOpenChange}
        detail={detail}
      />
    </>
  );
}
