/**
 * F-COMMANDES-PAGE-SHELL (#222) + F-COMMANDES-LIVE-TABLE (#227) +
 * F-COMMANDES-FILTERS (#238) + F-COMMANDES-CSV-EXPORT (#244) —
 * `CommandesView`, presentational shell of the tenant Commandes page.
 *
 * Slice 1 (#222) shipped only the header + a placeholder card. Slice 2 (#227)
 * replaced the placeholder with a live `OrdersTable` branched on the result
 * of `useTenantQuery(api.lib.orders.orders.listOrders)`. Slice 3 (#238) mounts
 * the `OrdersFilters` controlled component ABOVE the table — the filter
 * `value` is owned by the page (`useState`, EPIC #141 decision), the view
 * stays a pure function of its props, and `filterOrders` is applied at the
 * page level so the `orders` prop here is already filtered. Slice 5 (#244,
 * THIS file's current contract) mounts the `ExportCsvButton` in the page
 * header. The page owns the export trigger (it knows the filtered orders +
 * the tenant slug); the view just forwards the click + disables the button
 * when there's nothing to export.
 *
 * The view keeps the same chrome-doesn't-flash discipline as `MenuView` /
 * `MesClientsView`: the header (« Commandes »), the « Exporter CSV » button,
 * AND the filters render on every branch (loading / empty / populated), so
 * the gérant can set a filter or queue an export click while the initial
 * fetch is in flight without controls appearing AFTER the data lands.
 *
 * The « Exporter CSV » button is DISABLED when:
 *   - `orders === undefined` → query in flight, no data to serialise yet;
 *   - `orders.length === 0`  → empty list (either fresh tenant or filter
 *     excluded everything). Clicking would produce a header-only CSV that's
 *     confusing for the comptable; we hide that affordance.
 *
 * Scope discipline (#244 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { ExportCsvButton } from "./export-csv-button";
import { OrdersFilters } from "./orders-filters";
import { OrdersTable } from "./orders-table";
import type {
  DateRangeKey,
  OrderStatus,
  OrdersFilter,
} from "./orders-filtering";

export type CommandesViewProps = {
  /**
   * Orders payload from `useTenantQuery(api.lib.orders.orders.listOrders)`,
   * ALREADY filtered by the page via `filterOrders(...)` (the view never
   * re-filters — keeps the filter logic in one tested seam).
   *   - `undefined` → query in flight (Convex's loading sentinel; the
   *     table renders its skeleton).
   *   - `[]`        → tenant has no orders yet OR the filter excluded all
   *                   results (the table's empty branch).
   *   - else        → list to render (backend guarantees DESC by createdAt
   *     through `listTenantOrders` reading `by_tenant` in reverse).
   */
  orders: Doc<"orders">[] | undefined;
  /** F-COMMANDES-FILTERS (#238) — controlled filter value, page-owned. */
  filter: OrdersFilter;
  /** F-COMMANDES-FILTERS (#238) — fired when the gérant picks a date preset. */
  onDateRangeChange: (next: DateRangeKey) => void;
  /** F-COMMANDES-FILTERS (#238) — fired when a status toggles in the multi-select. */
  onStatusesChange: (next: OrderStatus[]) => void;
  /**
   * F-COMMANDES-DETAIL-MODAL (#239) — fired when the gérant clicks a row.
   * The view forwards it as-is to `OrdersTable.onRowClick`; the page uses
   * it to open the detail modal (sets the selected orderId, which triggers
   * the `getOrder` subscription via `useTenantQuery`).
   */
  onOrderClick: (orderId: Id<"orders">) => void;
  /**
   * F-COMMANDES-CSV-EXPORT (#244) — fired when the gérant clicks the
   * « Exporter CSV » button. The page owns the handler — it serialises the
   * filtered orders via `ordersToCsv`, builds the filename via
   * `buildCsvFilename(slug, now)`, and triggers `downloadCsv(...)`. The
   * view never reads the orders for serialisation — only the button's
   * disabled state is derived from `orders`.
   */
  onExportCsv: () => void;
};

export function CommandesView({
  orders,
  filter,
  onDateRangeChange,
  onStatusesChange,
  onOrderClick,
  onExportCsv,
}: CommandesViewProps) {
  // The « Exporter CSV » button is disabled when there's nothing to export:
  //   - `orders === undefined`  → query in flight, payload not ready.
  //   - `orders.length === 0`   → empty list (fresh tenant OR filter excluded
  //     everything — clicking would produce a header-only CSV).
  const canExport = orders !== undefined && orders.length > 0;
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <CommandesHeader onExportCsv={onExportCsv} canExport={canExport} />
      <div className="flex flex-col gap-4 px-4 md:gap-6 lg:px-6">
        <OrdersFilters
          value={filter}
          onDateRangeChange={onDateRangeChange}
          onStatusesChange={onStatusesChange}
        />
        <OrdersTable orders={orders} onRowClick={onOrderClick} />
      </div>
    </div>
  );
}

function CommandesHeader({
  onExportCsv,
  canExport,
}: {
  onExportCsv: () => void;
  canExport: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Commandes</h1>
      </div>
      <div className="flex items-center gap-2">
        <ExportCsvButton onClick={onExportCsv} disabled={!canExport} />
      </div>
    </div>
  );
}
