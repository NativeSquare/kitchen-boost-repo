/**
 * Public API of the `pause` native module (#406 KB Orders, PRD 20 §7a +
 * ADR 0018 frontière disponibilité commerciale).
 *
 * Two concerns surface here, sharing the same « pause exceptionnelle » spec:
 *
 *  - `PauseControl` — React surface mounted on the home screen above the order
 *    queue. Renders an entry-point pill in idle (open a bottom sheet with the
 *    3 fixed choices 15 / 30 / 60 min) or a live badge « En pause jusqu'à
 *    HH:MM » + « Reprendre » button when a pause is active. Tap-to-set freezes
 *    the ETA via `computePauseUntil(Date.now(), duration)` and calls
 *    `setOperationalPause` (already shipped in #397). The cmds en cours stay
 *    actives during the pause (PRD 20 §7a) — the backend gates only NEW
 *    checkouts via `acceptsOrderNow`.
 *
 *  - `decidePauseControl` / `computePauseUntil` / `formatPauseEta` /
 *    `isPauseLive` / `PAUSE_DURATIONS_MIN` — the PURE decision functions (no
 *    React, no Convex, no Expo). Truth table pinned in
 *    `decide-pause-control.test.ts`. Same split convention as
 *    `decideForceUpdate` (#394), `decideTenantSwitcher` (#399),
 *    `decideRefuseFlow` (#403) — keeps the truth table in a fast vitest suite
 *    (node env, no jsdom) and the React layer minimal.
 *
 * The backend mutations (`setOperationalPause`, `clearOperationalPause`,
 * `getOperationalPause`) already exist on `api.lib.orders.orders.*` and ship
 * with their cross-tenant fuzz (ADR 0010) since the 2.3-A slice + #397 (mirror
 * KB Admin). The PWA client gate (`acceptsOrderNow` + `createOrderFromCart`)
 * also already disables checkout server-side when a pause is active — PRD 20
 * §7a « Impact PWA client : checkout désactivé » is enforced at the backend
 * gate, so this story does NOT need to re-implement it at the customer-side
 * surface (which is still a starter at the moment).
 */
export { PauseControl } from "./pause-control";
export {
  PAUSE_DURATIONS_MIN,
  computePauseUntil,
  decidePauseControl,
  formatPauseEta,
  isPauseLive,
  type PauseControlDecision,
  type PauseControlInputs,
  type PauseDurationMin,
} from "./decide-pause-control";
