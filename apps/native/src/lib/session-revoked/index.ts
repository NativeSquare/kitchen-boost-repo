/**
 * Public API of the `session-revoked` native module (#400 KB Orders, PRD 20
 * §13 « Révocation session distante » + AC8).
 *
 * Three exports cover the contract of the « Session révoquée » gate:
 *
 *  - `SessionRevokedGate` — the React component the root `_layout.tsx`
 *    mounts INSIDE `ConvexAuthProvider` (it needs `useConvexAuth` +
 *    `useAuthActions`) and OUTSIDE every auth-dependent screen so the
 *    full-screen overlay surfaces ABOVE the auth stack the moment a remote
 *    revocation lands.
 *
 *  - `markIntentionalSignOut` — imperative API the Settings « Logout »
 *    button (#418) and the banned-user alert in `_layout.tsx` call BEFORE
 *    `signOut()`. Without it, every local logout would mistakenly trigger
 *    the revoked overlay.
 *
 *  - `decideSessionRevoked` — the PURE decision function (no React, no
 *    Convex). Pinned by the vitest suite next door. Same split convention
 *    as `decideForceUpdate` (#394), `decidePushPermissionBanner` (#395),
 *    `decideOnboardingStep` (#398), `decideTenantSwitcher` (#399).
 *
 * The backend revocation mutation (`api.lib.auth.sessions.revokeSession`)
 * lives in `packages/backend/convex/lib/auth/sessions.ts` and was shipped
 * via #396 (PR #423) — no schema change is needed here. The native side
 * just observes the Convex Auth `isAuthenticated` flag flipping to `false`
 * after the next refresh fails.
 */
export {
  SessionRevokedGate,
  markIntentionalSignOut,
} from "./session-revoked-gate";
export {
  decideSessionRevoked,
  type SessionRevokedDecision,
  type SessionRevokedInputs,
} from "./decide-session-revoked";
