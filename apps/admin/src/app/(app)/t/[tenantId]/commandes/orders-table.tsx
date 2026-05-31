/**
 * F-COMMANDES-LIVE-TABLE (#227) — `OrdersTable`, the live, Convex-reactive
 * table that replaces the slice-1 placeholder under
 * `/t/[tenantId]/commandes/`.
 *
 * Pure presentational component owning the THREE branches the table can be
 * in (issue body « Loading state visible pendant le fetch initial »,
 * « Empty state visible si zero commandes », « V1 colonnes: createdAt /
 * status / mode / total »):
 *   - `orders === undefined` → loading skeleton rows (no blank flash, no
 *     shell-swap when the data lands — same discipline as `MenuView` /
 *     `MesClientsView`).
 *   - `orders.length === 0`  → empty state (« Aucune commande pour le
 *     moment »).
 *   - else                   → a 4-column table (Date FR / Statut badge /
 *     Mode customer-facing copy / Total EUR from `pricingSnapshot.total`
 *     centimes).
 *
 * Sort by `createdAt` DESC is GUARANTEED BY THE BACKEND (`listTenantOrders`
 * reads the `by_tenant` index in reverse `_creationTime` order; cf.
 * `packages/backend/convex/lib/tenancy/ordersStore.ts`). The view does NOT
 * resort defensively: a regression of that backend invariant would surface
 * in the backend's own test suite, and resorting here would mask the bug.
 *
 * Reactivity: the page subscribes through `useTenantQuery(api.lib.orders
 * .orders.listOrders)`. Convex's WebSocket transport pushes a fresh result
 * whenever any backend mutation touches the tenant's orders (Stripe webhook
 * `confirmPayment` flipping `en attente de paiement → nouvelle`, kitchen
 * workflow `recordStatus`, refund), so the table updates without manual
 * refresh — EPIC #141 decision actée 2026-05-29, no SSE plumbing required.
 *
 * Out of scope this slice (later slices of EPIC #141): filtres date/statut,
 * détail modal, refund total, export CSV. No selection of row, no click
 * handler (issue body « Pas de sélection de ligne / modal encore — juste
 * l'affichage »).
 *
 * Split out of `commandes-view.tsx` (which composes the view chrome) so
 * vitest can pin every branch under `environment: "node"` — same
 * React-tree-serializer pattern as `MenuView` / `MesClientsView`.
 *
 * Scope discipline (#227 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { formatPriceCentimes } from "../menu/format-price";
import { formatOrderDate } from "./format-order-date";

export type OrdersTableProps = {
  /**
   * Orders payload from `useTenantQuery(api.lib.orders.orders.listOrders)`.
   *   - `undefined` → query in flight (Convex's loading sentinel)
   *   - `[]`        → tenant has no orders yet (fresh provisioning)
   *   - else        → list to render (backend guarantees DESC by createdAt)
   */
  orders: Doc<"orders">[] | undefined;
};

/**
 * Customer-facing copy for the `orderMode` enum. The gérant doesn't speak
 * schema — they read the same vocabulary the client sees on the PWA. Mapping
 * lives here (single source of truth for the admin) so a future surface
 * (CSV export, order detail) reuses it.
 */
const MODE_LABEL: Record<Doc<"orders">["mode"], string> = {
  delivery: "Livraison",
  pickup: "À emporter",
};

/** Em-dash sentinel for an unavailable total (e.g. « en attente de paiement »). */
const TOTAL_PLACEHOLDER = "—";

export function OrdersTable({ orders }: OrdersTableProps) {
  if (orders === undefined) {
    return <OrdersTableSkeleton />;
  }
  if (orders.length === 0) {
    return <OrdersTableEmptyState />;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Statut</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead className="text-right">Total</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <OrderRow key={order._id as unknown as string} order={order} />
        ))}
      </TableBody>
    </Table>
  );
}

function OrderRow({ order }: { order: Doc<"orders"> }) {
  const total =
    order.pricingSnapshot === undefined
      ? TOTAL_PLACEHOLDER
      : formatPriceCentimes(order.pricingSnapshot.total);
  return (
    <TableRow
      data-slot="orders-table-row"
      data-order-id={order._id as unknown as string}
    >
      <TableCell className="tabular-nums">
        {formatOrderDate(order.createdAt)}
      </TableCell>
      <TableCell>
        <Badge variant="secondary">{order.status}</Badge>
      </TableCell>
      <TableCell>{MODE_LABEL[order.mode]}</TableCell>
      <TableCell className="text-right tabular-nums">{total}</TableCell>
    </TableRow>
  );
}

function OrdersTableEmptyState() {
  return (
    <div
      className="rounded-lg border border-dashed p-8 text-center"
      data-slot="orders-table-empty"
    >
      <p className="text-muted-foreground text-sm">
        Aucune commande pour le moment.
      </p>
    </div>
  );
}

/**
 * Skeleton placeholder: a 4-column shell + 5 skeleton rows so the layout
 * doesn't shift when the data lands. Same shape pattern as
 * `CategoryListSkeleton` in menu/menu-view.tsx — `animate-pulse` (from the
 * shadcn Skeleton primitive) is the user-visible "loading" affordance.
 */
function OrdersTableSkeleton() {
  return (
    <div data-slot="orders-table-skeleton">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Statut</TableHead>
            <TableHead>Mode</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 5 }).map((_, index) => (
            <TableRow key={index} data-slot="orders-table-skeleton-row">
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-20 rounded-full" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-20" />
              </TableCell>
              <TableCell className="text-right">
                <Skeleton className="ml-auto h-4 w-16" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
