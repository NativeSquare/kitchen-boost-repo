/**
 * #395 — pure decision function for the OS push permission banner
 * (PRD 20 §3 « Notifications push système » + §13 « Fiabilité réception ».)
 *
 * Stub — see the test next door. The `PushPermissionBanner` component in
 * `apps/native/src/app/(app)/_layout.tsx` calls `Notifications.getPermissionsAsync()`
 * at mount + on every foreground return via `AppState`, then delegates the
 * visibility verdict to this function. Same split as `decideForceUpdate` (#394).
 */

/** Mirror of `expo-modules-core` `PermissionStatus` values — kept as a string
 * union here so the test does not need to import the runtime enum (and the
 * vitest Node env never has to load Expo's native module wrapper). */
export type PushPermissionStatus = "granted" | "denied" | "undetermined";

export type PushPermissionInputs = {
  /** `undefined` while `Notifications.getPermissionsAsync()` is still pending. */
  status: PushPermissionStatus | undefined;
};

/** Two-state output: the banner is either rendered or not. Kept as a string
 * literal (not boolean) for readable verdicts in tests. */
export type PushPermissionBannerDecision = "visible" | "hidden";

export function decidePushPermissionBanner(
  _inputs: PushPermissionInputs,
): PushPermissionBannerDecision {
  // Stub — implementation lands in the `feat` commit.
  return "hidden";
}
