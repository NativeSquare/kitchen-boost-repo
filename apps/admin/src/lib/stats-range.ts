/**
 * F-STATS-DASHBOARD [3/8] (#253) — `stats-range` util.
 *
 * The canonical V1 contract for the stats range window of the resto stats
 * page (PRD 70 §4.10) :
 *   - `RANGE_OPTIONS` : exactly 3 windows (7 / 30 / 90 days) ;
 *   - `DEFAULT_RANGE_DAYS` : default (30 days, issue body) ;
 *   - `RangeDays` : the branded literal union of the 3 options ;
 *   - `isRangeDays` : runtime validator (defends against an unexpected URL
 *     param or a future URL-sync slice) ;
 *   - `rangeLabel` : the FR human label per option (« 7 jours », ...).
 *
 * Pure TypeScript (no React, no Convex) — re-usable from both the page
 * (`useState`) and the picker, and tested standalone under
 * `environment: "node"`.
 */

/** The 3 V1 window sizes (PRD 70 §4.10 + issue body). */
export const RANGE_OPTIONS = [7, 30, 90] as const;

/** Literal union of the allowed range values. */
export type RangeDays = (typeof RANGE_OPTIONS)[number];

/** Default range when the user first lands on /stats (issue body). */
export const DEFAULT_RANGE_DAYS: RangeDays = 30;

/** Runtime validator — narrows `unknown` to `RangeDays`. */
export function isRangeDays(value: unknown): value is RangeDays {
  return (
    typeof value === "number" &&
    (RANGE_OPTIONS as readonly number[]).includes(value)
  );
}

/** FR human label for one option (« 7 jours », « 30 jours », « 90 jours »). */
export function rangeLabel(value: RangeDays): string {
  return `${value} jours`;
}
