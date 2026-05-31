/**
 * F-COMMANDES-FILTERS (#238) — `OrdersFilters`, the controlled component that
 * mounts the date-range buttons + the status multi-select above the orders
 * table.
 *
 * Fully controlled (no internal state, no `useState`, no `useEffect`):
 *  - The `value` prop is the single source of truth (the page owns the state,
 *    per EPIC #141 « état local `useState` sur la page »).
 *  - `onDateRangeChange(key)` fires when the gérant clicks a date button.
 *  - `onStatusesChange(nextSet)` fires when a status item toggles; the new
 *    array is built here (add if absent, remove if present) so the page just
 *    stores it.
 *
 * Why fully controlled (not "uncontrolled with onChange callback"):
 *  - A live Convex push that lands while a filter is active re-runs
 *    `filterOrders(orders, value)` against the page-held `value` — no
 *    setState round-trip, no race against a stale local snapshot.
 *  - Keeps the component testable in isolation under `environment: "node"`
 *    — no hooks shim needed (cf. sibling `orders-table.tsx` discipline).
 *
 * Layout: a horizontal row of 4 date buttons on top, an inline-wrapping row
 * of 8 status pills below. The full-width row stays scannable on a 1280px
 * laptop without horizontal scroll (mirrors `commandes-view.tsx` chrome
 * discipline).
 *
 * Scope discipline (#238): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/` — zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

import {
  ALL_ORDER_STATUSES,
  type DateRangeKey,
  type OrderStatus,
  type OrdersFilter,
} from "./orders-filtering";

export type OrdersFiltersProps = {
  /** The current filter selection (page-owned `useState`). */
  value: OrdersFilter;
  /** Called with the key of the clicked date button. */
  onDateRangeChange: (next: DateRangeKey) => void;
  /** Called with the NEW status array (toggle ON adds, toggle OFF removes). */
  onStatusesChange: (next: OrderStatus[]) => void;
};

/** Customer-facing copy for the 4 date range presets. */
const DATE_RANGE_LABEL: Record<DateRangeKey, string> = {
  today: "Aujourd'hui",
  "7d": "7 jours",
  "30d": "30 jours",
  tout: "Tout",
};

/** Stable iteration order — matches the « left-to-right » lifecycle layout. */
const DATE_RANGE_ORDER: readonly DateRangeKey[] = [
  "today",
  "7d",
  "30d",
  "tout",
] as const;

export function OrdersFilters({
  value,
  onDateRangeChange,
  onStatusesChange,
}: OrdersFiltersProps) {
  const selectedSet = new Set<string>(value.statuses);

  return (
    <div className="flex flex-col gap-3" data-slot="orders-filters">
      {/* Date range buttons row */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-slot="orders-filters-date-row"
      >
        {DATE_RANGE_ORDER.map((key) => {
          const isActive = value.dateRange === key;
          return (
            <Button
              key={key}
              type="button"
              variant={isActive ? "default" : "outline"}
              size="sm"
              data-slot={`orders-filters-date-${key}`}
              data-active={isActive ? "true" : "false"}
              onClick={() => onDateRangeChange(key)}
            >
              {DATE_RANGE_LABEL[key]}
            </Button>
          );
        })}
      </div>

      {/* Status multi-select row */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-slot="orders-filters-status-row"
      >
        {ALL_ORDER_STATUSES.map((status) => {
          const isActive = selectedSet.has(status);
          return (
            <Badge
              key={status}
              asChild
              variant={isActive ? "default" : "outline"}
            >
              <button
                type="button"
                data-slot="orders-filters-status-item"
                data-status={status}
                data-active={isActive ? "true" : "false"}
                onClick={() =>
                  onStatusesChange(toggleStatus(value.statuses, status))
                }
                className="cursor-pointer"
              >
                {status}
              </button>
            </Badge>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Toggle helper — pure, exported only via the component (the predicate is
 * small enough to inline). If the status is in the set we remove it (preserves
 * the other selections); if not, we append it (preserves the existing
 * selection order). Always returns a NEW array so React sees a reference
 * change.
 */
function toggleStatus(
  current: OrderStatus[],
  status: OrderStatus,
): OrderStatus[] {
  return current.includes(status)
    ? current.filter((s) => s !== status)
    : [...current, status];
}
