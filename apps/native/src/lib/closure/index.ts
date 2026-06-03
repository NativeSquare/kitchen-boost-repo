/**
 * Public API of the `closure` native module (#407 KB Orders, PRD 20 §7b +
 * ADR 0018 frontière disponibilité commerciale).
 *
 * Two concerns surface here, sharing the same « Fermeture exceptionnelle »
 * spec (1+ jour, vacances / panne frigo / intempéries):
 *
 *  - `ClosureControl` — React surface mounted on the home screen above the
 *    order queue, sibling of `<PauseControl />` (#406). Renders an entry
 *    pill in idle (open a bottom sheet with the 3 quick presets
 *    Aujourd'hui / J+1 / J+7 + a custom YYYY-MM-DD pair) or a rose badge
 *    « Fermé jusqu'au JJ/MM » + « Rouvrir » button when a closure is
 *    active. Quick-pick freezes the `[from, until)` window via
 *    `computeQuickClosureWindow(Date.now(), preset)` and calls
 *    `setExceptionalClosure` (already shipped in #397). The cmds en cours
 *    stay actives during the closure (PRD 20 §7b) — the backend gates only
 *    NEW checkouts via `acceptsOrderNow`.
 *
 *  - `decideClosureControl` / `computeQuickClosureWindow` /
 *    `formatClosureUntilDate` / `parseLocalDateInput` / `isClosureLive` /
 *    `CLOSURE_QUICK_PRESETS` — the PURE decision functions (no React, no
 *    Convex, no Expo). Truth table pinned in
 *    `decide-closure-control.test.ts`. Same split convention as
 *    `decidePauseControl` (#406), `decideForceUpdate` (#394),
 *    `decideTenantSwitcher` (#399), `decideRefuseFlow` (#403) — keeps the
 *    truth table in a fast vitest suite (node env, no jsdom) and the React
 *    layer minimal.
 *
 * The backend mutations (`setExceptionalClosure`,
 * `clearExceptionalClosure`, `getExceptionalClosure`) already exist on
 * `api.lib.orders.orders.*` and ship with their cross-tenant fuzz
 * (ADR 0010) since #397 (mirror KB Admin). The PWA client gate
 * (`acceptsOrderNow` + `createOrderFromCart`) also already disables
 * checkout server-side when an exceptional closure is active — PRD 20 §7b
 * « Impact PWA client : checkout désactivé » is enforced at the backend
 * gate, so this story does NOT need to re-implement it at the customer-side
 * surface (which is still a starter at the moment).
 *
 * Distinct from the `pause` sibling module on three axes (same as the
 * decision-layer docstring): window vs duration, « Rouvrir » vs
 * « Reprendre », JJ/MM vs HH:MM.
 */
export { ClosureControl } from "./closure-control";
export {
  CLOSURE_QUICK_PRESETS,
  computeQuickClosureWindow,
  decideClosureControl,
  formatClosureUntilDate,
  isClosureLive,
  parseLocalDateInput,
  type ClosureControlDecision,
  type ClosureControlInputs,
  type ClosureQuickPreset,
} from "./decide-closure-control";
