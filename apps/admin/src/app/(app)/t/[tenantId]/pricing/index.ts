/**
 * F-PRICING-1 (#241) + F-PRICING-2 (#245) + F-PRICING-3 (#248) +
 * F-PRICING-4 (#249) — public module API of the admin pricing surface (front
 * equivalent of a `convex/lib/<feature>/index.ts` barrel).
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
 * Slice 2 (F-PRICING-2 / #245) adds:
 *   - `RuleBuilderModal`                  — the create modal (closed-list
 *                                            6 conditions + 3 actions,
 *                                            CONTRADICTORY_CONDITIONS surface).
 *   - `RuleBuilderSubmitPayload`          — the typed payload the page
 *                                            forwards to
 *                                            `api.lib.pricing.rules.create`.
 *
 * Slice 3 (F-PRICING-3 / #248) does NOT add new exports — it extends the
 * existing surfaces:
 *   - `PricingViewProps` gains an optional `onEditRule(rule)` callback used
 *     by the row « Éditer » button.
 *   - `RuleBuilderModalProps` gains an optional `existingRule` prop that
 *     pre-fills the form and flips the modal to edit mode (same component,
 *     no duplicate).
 * The page owns the create-vs-update branching at submit time
 * (`api.lib.pricing.rules.update` vs `.create`).
 *
 * Slice 4 (F-PRICING-4 / #249) also adds no new exports — it extends the
 * existing `PricingViewProps` with an optional `onToggleActive(ruleId, active)`
 * callback that bridges the per-row Switch toggle to
 * `api.lib.pricing.rules.setActive`. The toggle is the ONLY user affordance
 * here — flipping `active` never mutates `conditions` / `action` (« pas un
 * delete déguisé », issue body), pinned at the page-source level in
 * `page.test.ts`.
 *
 * Page default export (`./page`) is consumed by Next.js routing directly and
 * does not need to be re-exported here.
 */

export { PricingView, AUTO_PRIORITY_BANNER_TEXT } from "./pricing-view";
export type { PricingViewProps } from "./pricing-view";
export { formatConditionsSummary, formatActionSummary } from "./format-rule";
export { ACTION_KIND_LABELS, CONDITION_KIND_LABELS } from "./labels";
export type { ActionKind, ConditionKind } from "./labels";
export { RuleBuilderModal } from "./rule-builder-modal";
export type {
  RuleBuilderModalProps,
  RuleBuilderSubmitPayload,
} from "./rule-builder-modal";
