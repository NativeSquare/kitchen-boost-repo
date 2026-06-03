/**
 * Public API of the `connection-lost` native module (#405 KB Orders, PRD 20
 * §13 + `docs/contexts/kb-orders/CONTEXT.md` Mode déconnecté).
 *
 * Two exports cover the contract of the « Mode déconnecté » gate:
 *
 *  - `ConnectionLostGate` — the React component the root `_layout.tsx`
 *    mounts INSIDE `ConvexAuthProvider` (it depends on
 *    `useConvexConnectionState`, which needs a `ConvexProvider` ancestor)
 *    and OUTSIDE every auth-dependent screen so the full-screen red overlay
 *    surfaces ABOVE the whole tree the moment the WebSocket goes down for
 *    ≥ `CONNECTION_LOST_THRESHOLD_MS`. The overlay disappears the moment
 *    the WS reconnects — no CTA, no logout, no navigation (distinct from
 *    #400 « Session révoquée » and #394 « Mise à jour requise »).
 *
 *  - `decideConnectionLost` — the PURE decision function (no React, no
 *    Convex, no Expo). Pinned by the vitest suite next door. Same split
 *    convention as `decideForceUpdate` (#394), `decideSessionRevoked`
 *    (#400), `decideOnboardingStep` (#398), `decideTenantSwitcher` (#399).
 *
 *  - `CONNECTION_LOST_THRESHOLD_MS` — exported so the threshold is
 *    discoverable / re-usable (e.g. analytics, telemetry) and pinned by a
 *    dedicated test against a sneaky bump.
 *
 * No backend change — purely UI + a hook on the existing Convex client
 * `connectionState()` API. No schema change either.
 */
export { ConnectionLostGate } from "./connection-lost-gate";
export {
  CONNECTION_LOST_THRESHOLD_MS,
  decideConnectionLost,
  type ConnectionLostDecision,
  type ConnectionLostInputs,
} from "./decide-connection-lost";
