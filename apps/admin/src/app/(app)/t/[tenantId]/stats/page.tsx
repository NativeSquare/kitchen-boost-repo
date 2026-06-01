"use client";

/**
 * F-STATS-DASHBOARD [3/8] (#253) — resto stats route
 * `/t/[tenantId]/stats/page.tsx`.
 *
 * Thin wiring layer between :
 *   - `useState<RangeDays>` for the current window (default `DEFAULT_RANGE_DAYS`
 *     = 30 — issue body) ;
 *   - `useTenantQuery(api.lib.stats.rangeAggregates.rangeAggregates,
 *     { rangeDays })` for the « chiffres bruts » bloc ; the tenantId is
 *     auto-injected by `useTenantQuery` from `<TenantProvider/>` (ADR 0014 §4
 *     / F-SHELL-05 #183) ;
 *   - the pure `StatsView` (presentational shell with loading / populated /
 *     error branches).
 *
 * Access guard (cross-tenant) : inherited transitively from the parent
 * `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04 #175). The backend wrapper
 * (`tenantQuery({ allow: ["kb_manager", "staff"] })` on `rangeAggregates`) is
 * the hard isolation barrier (ADR 0010 — refuses Forbidden even if the
 * layout regresses ; cross-tenant fuzz shipped by
 * `packages/backend/convex/lib/stats/rangeAggregates.test.ts`).
 *
 * Error branch wiring : `useTenantQuery` itself does NOT expose a query error
 * — Convex surfaces query errors by re-throwing during render (the layout's
 * ErrorBoundary catches them then). We therefore do NOT pass `null` for an
 * error here ; we only pass the tri-state Convex sentinel (`undefined`
 * loading / object resolved). The `StatsView`'s `null` (error) branch is a
 * defensive surface kept available for a future hook upgrade.
 */
import { useState } from "react";

import { api } from "@packages/backend/convex/_generated/api";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantQuery } from "@/hooks";
import { DEFAULT_RANGE_DAYS, type RangeDays } from "@/lib/stats-range";

import { StatsView } from "./stats-view";

export default function StatsPage() {
  const tenantId = useCurrentTenantId();
  const [range, setRange] = useState<RangeDays>(DEFAULT_RANGE_DAYS);

  // `useTenantQuery` reads `tenantId` from `<TenantProvider/>` (mounted by
  // the chrome-less `/t/[tenantId]/layout.tsx`) and injects it into args.
  // Convex sentinel : `undefined` = loading, resolved = `{ panierMoyen,
  // totalCommandes }`.
  const rangeAggregates = useTenantQuery(
    api.lib.stats.rangeAggregates.rangeAggregates,
    { rangeDays: range },
  );

  // F-STATS-DASHBOARD [4/8] (#257) — series for the LineChart Recharts block.
  // Tri-state Convex sentinel : `undefined` = loading, resolved = array of
  // `{ date, revenue }` entries (one per day in the window, gaps filled at 0).
  const revenuePerDay = useTenantQuery(
    api.lib.stats.revenuePerDay.revenuePerDay,
    { rangeDays: range },
  );

  return (
    <StatsView
      tenantId={tenantId}
      range={range}
      onRangeChange={setRange}
      rangeAggregates={rangeAggregates}
      revenuePerDay={revenuePerDay}
    />
  );
}
