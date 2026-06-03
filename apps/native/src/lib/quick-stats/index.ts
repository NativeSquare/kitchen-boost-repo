/**
 * Public API of the `quick-stats` native module (#410 KB Orders, PRD 20 §9
 * « Stats rapides V1 »).
 *
 * Two concerns share the same « stats rapides » spec:
 *
 *  - `QuickStats` — React surface mounted on the home screen above the order
 *    queue. Renders 4 minimal KPI cards (CA jour, nb cmds jour, CA semaine,
 *    comparatif S-1). PRD 20 §9 freezes the V1 surface to big numbers + delta
 *    badge — pas de graphes (les graphes Recharts sont KB Admin only via
 *    F-STATS-DASHBOARD #252/#253/#257). Subscription Convex temps réel,
 *    pas de refresh manuel.
 *
 *  - `decideQuickStats` + helpers — pure decision functions over the raw
 *    backend output. The delta % and direction are derived CLIENT-side so
 *    the backend contract stays trivial (4 cents-or-integer fields) and the
 *    comparison logic is pinned by a fast vitest suite (node env, no
 *    convex-test, no jsdom). Same split convention as `decidePauseControl`
 *    (#406), `decideClosureControl` (#407), `decideForceUpdate` (#394).
 *
 * The backend query (`api.lib.stats.quickStats.quickStats`) lives in
 * `packages/backend/convex/lib/stats/quickStats.ts` and ships with its
 * cross-tenant fuzz suite (ADR 0010) — `kb_manager` + `staff` allow-list,
 * mêmes politiques que `dailyKpis` / `rangeAggregates`.
 */
export { QuickStats } from "./quick-stats";
export {
  type Comparison,
  type ComparisonDirection,
  type QuickStatsDecision,
  type QuickStatsRaw,
  decideQuickStats,
  formatCentsEur,
  formatSignedPercent,
} from "./decide-quick-stats";
