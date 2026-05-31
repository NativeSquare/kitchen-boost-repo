/**
 * F-COMMANDES-PAGE-SHELL (#222) + F-COMMANDES-LIVE-TABLE (#227) —
 * `CommandesView`, presentational shell of the tenant Commandes page.
 *
 * Slice 1 (#222) shipped only the header + a placeholder card. Slice 2 (#227)
 * replaces the placeholder with a live `OrdersTable` branched on the result
 * of `useTenantQuery(api.lib.orders.orders.listOrders)` (which the page
 * owns). The view stays a pure function of its props: it takes
 * `orders: Doc<"orders">[] | undefined` and forwards it to the table — the
 * three branches (loading / empty / populated) live in `OrdersTable` and
 * are pinned by `orders-table.test.tsx`.
 *
 * The header (« Commandes ») is ALWAYS rendered, regardless of the data
 * branch — same chrome-doesn't-flash discipline as `MenuView` /
 * `MesClientsView` (the page title is the operator's anchor across the
 * loading → populated transition).
 *
 * Future slices of EPIC F-COMMANDES #141 will layer (in their own files,
 * here only forwarded as additional props as they land):
 *   - filtres date / statut (slice 3),
 *   - modal détail commande (`api.lib.orders.orders.getOrder`),
 *   - action « Rembourser intégralement » (option A: a `tenantAction`
 *     public `refundOrder`),
 *   - export CSV front-side (no backend).
 *
 * Scope discipline (#227 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { OrdersTable } from "./orders-table";

export type CommandesViewProps = {
  /**
   * Orders payload from `useTenantQuery(api.lib.orders.orders.listOrders)`.
   *   - `undefined` → query in flight (Convex's loading sentinel; the
   *     table renders its skeleton).
   *   - `[]`        → tenant has no orders yet (empty state).
   *   - else        → list to render (backend guarantees DESC by createdAt
   *     through `listTenantOrders` reading `by_tenant` in reverse).
   */
  orders: Doc<"orders">[] | undefined;
};

export function CommandesView({ orders }: CommandesViewProps) {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <CommandesHeader />
      <div className="flex flex-col gap-4 px-4 md:gap-6 lg:px-6">
        <OrdersTable orders={orders} />
      </div>
    </div>
  );
}

function CommandesHeader() {
  return (
    <div className="flex flex-col gap-2 px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Commandes</h1>
      </div>
    </div>
  );
}
