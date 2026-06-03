/**
 * Public API of the `force-update` native module (#394 KB Orders, PRD 20 §13 +
 * ADR 0017). The `_layout.tsx` root mounts `ForceUpdateGate` BEFORE any auth-
 * dependent provider so the gate runs pre-auth.
 *
 *  - `ForceUpdateGate` — the React component to mount at the root. Resolves
 *    the four inputs (env, running criticalIndex, nativeBuildVersion, Convex
 *    `app.minBuildVersion()`), delegates to `decideForceUpdate`, renders the
 *    children when `allow`, the red blocking screen on `block-native-update`,
 *    or a splash spinner on `wait` / `download-and-reload`.
 *
 *  - `decideForceUpdate` — the PURE decision function (no React, no Expo,
 *    no Convex). Pinned by the vitest suite next door.
 */
export { ForceUpdateGate } from "./force-update-gate";
export {
  decideForceUpdate,
  type ForceUpdateDecision,
  type ForceUpdateEnv,
  type ForceUpdateInputs,
  type UpdateCheck,
} from "./decide-force-update";
