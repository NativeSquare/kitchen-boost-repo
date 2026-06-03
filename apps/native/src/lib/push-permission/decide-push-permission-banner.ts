/**
 * #395 — pure decision function for the OS push permission banner (PRD 20 §3
 * « Notifications push système » + §13 « Fiabilité réception, mode déconnecté »).
 *
 * The `PushPermissionBanner` component in `apps/native/src/app/(app)/_layout.tsx`
 * resolves the OS permission status at mount and on every foreground return via
 * `AppState`, then delegates the visibility verdict to this function. Same
 * split as `decideForceUpdate` (#394) / `decideRootEntry` / `decideTenantGate`
 * in `apps/admin` — keep React, `expo-notifications` and `AppState` out of the
 * function, get a fast deterministic vitest suite (no jsdom, no native mocks).
 *
 * Truth table (cf. PRD 20 §3 + §15 edge case « push refusé au niveau OS »):
 *
 *  | status        | verdict | why                                              |
 *  | ------------- | ------- | ------------------------------------------------ |
 *  | granted       | hidden  | OS-level wakeup channel healthy                  |
 *  | denied        | visible | the failure mode we are exposing — banner sticky |
 *  | undetermined  | hidden  | onboarding (#398, PRD 20 §1a step 2) asks, not us |
 *  | undefined     | hidden  | pre-resolution — never flash red on cold start    |
 */

/** Mirror of `expo-modules-core` `PermissionStatus` values — kept as a string
 * union so the test does not need to import the runtime enum (and the vitest
 * Node env never has to load Expo's native module wrapper). */
export type PushPermissionStatus = "granted" | "denied" | "undetermined";

export type PushPermissionInputs = {
  /** `undefined` while `Notifications.getPermissionsAsync()` is still pending
   * (first frame of `(app)` mount). */
  status: PushPermissionStatus | undefined;
};

/** Two-state output: the banner is either rendered or not. Kept as a string
 * literal (not boolean) for readable verdicts in tests. */
export type PushPermissionBannerDecision = "visible" | "hidden";

/**
 * Decide whether the red sticky banner should be visible this frame. Pure:
 * same input ⇒ same output, no side effects, no `Date.now()`. The component is
 * a thin adapter (`useEffect` + `AppState` listener for the status, `useState`
 * for the resolved value) that calls this function on every render and reacts
 * to the verdict.
 */
export function decidePushPermissionBanner(
  inputs: PushPermissionInputs,
): PushPermissionBannerDecision {
  // The ONLY state that surfaces the banner is `denied`. `undetermined`
  // (onboarding not done yet) and `undefined` (still loading) both fall
  // through to hidden — see truth table in the docstring.
  if (inputs.status === "denied") {
    return "visible";
  }
  return "hidden";
}
