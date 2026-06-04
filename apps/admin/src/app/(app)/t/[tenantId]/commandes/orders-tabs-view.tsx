/**
 * #415 — `OrdersTabsView`, the controlled component that mounts the 4
 * history tabs (« Toutes | Livrées-Collectées | Refusées | Manquées »)
 * + the order id search input above the existing date/status filter bar
 * on the KB Admin Commandes page.
 *
 * Fully CONTROLLED (no internal state, no `useState`, no `useEffect`):
 *  - `tab` / `onTabChange` — the active tab key (page-owned).
 *  - `search` / `onSearchChange` — the orderId search query (page-owned,
 *    re-runs on every keystroke; the search predicate is pure cheap).
 *
 * Why fully controlled (vs. uncontrolled with onChange callback):
 *  - Same discipline as `OrdersFilters` (#238) — a live Convex push
 *    re-runs the tab/search predicate against the page-held state, no
 *    setState round-trip, no race against a stale local snapshot.
 *  - Lets vitest pin every active state under `environment: "node"` (no
 *    jsdom, no RTL) — same React-tree-serializer pattern as sibling
 *    components.
 *
 * Layout: a horizontal row of 4 tab pills + a right-aligned search input.
 * Both rows render on every data branch (loading / empty / populated)
 * so the gérant + kb_admin ops can switch tab / type a query while the
 * initial fetch is in flight (no controls appearing AFTER the data
 * lands — same chrome-doesn't-flash discipline as `CommandesView`).
 *
 * Scope discipline (#415): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/` — zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { ORDER_TABS, type OrderTabKey } from "./orders-tabs";

export type OrdersTabsViewProps = {
  /** Active tab key (page-owned `useState`). */
  tab: OrderTabKey;
  /** Called when the user clicks a tab pill. */
  onTabChange: (next: OrderTabKey) => void;
  /** Current orderId search query (page-owned `useState`). */
  search: string;
  /** Called on every keystroke in the search input. */
  onSearchChange: (next: string) => void;
};

export function OrdersTabsView({
  tab,
  onTabChange,
  search,
  onSearchChange,
}: OrdersTabsViewProps) {
  return (
    <div
      className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      data-slot="orders-tabs-bar"
    >
      <div
        className="flex flex-wrap items-center gap-2"
        data-slot="orders-tabs-row"
      >
        {ORDER_TABS.map((t) => {
          const isActive = tab === t.key;
          return (
            <Button
              key={t.key}
              type="button"
              variant={isActive ? "default" : "outline"}
              size="sm"
              data-slot={`orders-tab-${t.key}`}
              data-active={isActive ? "true" : "false"}
              onClick={() => onTabChange(t.key)}
            >
              {t.label}
            </Button>
          );
        })}
      </div>
      <div className="sm:w-72">
        <Input
          type="search"
          inputMode="text"
          placeholder="Rechercher par ID commande…"
          aria-label="Rechercher par ID commande"
          data-slot="orders-search-input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
        />
      </div>
    </div>
  );
}
