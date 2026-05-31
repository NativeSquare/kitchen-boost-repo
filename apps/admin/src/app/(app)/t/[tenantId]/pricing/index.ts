/**
 * F-PRICING-1 (#241) — public module API of the admin pricing surface
 * (front equivalent of a `convex/lib/<feature>/index.ts` barrel).
 *
 * Slice 1 exposes:
 *   - `PricingView`                       — the pure presentational shell.
 *   - `AUTO_PRIORITY_BANNER_TEXT`         — the verbatim FR banner copy
 *                                            (shared with tests).
 *   - `formatConditionsSummary` /
 *     `formatActionSummary`               — pure FR formatters (re-used by
 *                                            the slices 2-5 builder).
 *   - `CONDITION_KIND_LABELS` /
 *     `ACTION_KIND_LABELS`                — the single FR-label source of
 *                                            truth (6 conditions + 3 actions).
 *
 * Page default export (`./page`) is consumed by Next.js routing directly and
 * does not need to be re-exported here.
 */

export { PricingView, AUTO_PRIORITY_BANNER_TEXT } from "./pricing-view";
export type { PricingViewProps } from "./pricing-view";
export { formatConditionsSummary, formatActionSummary } from "./format-rule";
export { ACTION_KIND_LABELS, CONDITION_KIND_LABELS } from "./labels";
export type { ActionKind, ConditionKind } from "./labels";
