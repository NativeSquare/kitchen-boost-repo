/**
 * #398 — pure decision function for the post-login onboarding sequence
 * (PRD 20 §1a, steps 2 → 4 → 5).
 *
 * The `(onboarding)` route in `apps/native/src/app/(onboarding)/index.tsx`
 * resolves the OS push permission status via `expo-notifications`, persists
 * the per-item « J'ai fait » acknowledgements in component state, calls the
 * Convex mutation `markOnboardingCompleted` at the tail of the flow, and
 * delegates the per-frame step verdict to this function. Same split as
 * `decideForceUpdate` (#394) and `decidePushPermissionBanner` (#395) —
 * keeping React, `expo-notifications` and Convex out of the function means
 * the matrix is pinned by a fast deterministic vitest suite (Node env, no
 * jsdom, no native mocks).
 *
 *  Steps (cf. PRD 20 §1a):
 *
 *  1. **Login** (`(auth)`) — pre-condition, not handled here.
 *  2. **Push permission prompt** with custom rationale — _« KB Orders a besoin
 *     des notifs pour ne pas rater une commande — active-les »_. Asked ONCE
 *     per device per onboarding run (`pushAsked` latch); if the OS returns
 *     `undetermined` because the user dismissed the prompt, we still move on
 *     (the red banner #395 will nag them on every authenticated route).
 *  3. **Toggle kiosque/téléphone** (#393, `(device-setup)`) — happens BEFORE
 *     this route, gated by `device.mode === undefined` at the root layout.
 *     Not handled by this function.
 *  4. **Checklist réglages device** — two items the user acks manually:
 *     `volumeAck` (volume à fond) and `sleepAck` (écran toujours allumé).
 *     Non-validation programmatique — pure UX guide. Both required.
 *  5. **Completing → redirect home** (`(tabs)/index`) — flips
 *     `device.onboardingCompleted` to true via Convex so subsequent launches
 *     skip the whole sequence.
 */

/** Mirror of the `expo-modules-core` `PermissionStatus` values — same string
 * union as `decide-push-permission-banner` so the two seams share the same
 * shape (no enum import in the pure layer, the Node test env never loads
 * Expo's native module wrapper). */
export type OnboardingPushStatus = "granted" | "denied" | "undetermined";

export type OnboardingStepInputs = {
  /** `undefined` while `Notifications.getPermissionsAsync()` is still pending
   * on the first render of the onboarding route. */
  pushStatus: OnboardingPushStatus | undefined;
  /** True once the rationale screen has called
   * `Notifications.requestPermissionsAsync()` AT LEAST once for this onboarding
   * run. A soft latch so the rationale shows up exactly once even if the OS
   * prompt was dismissed without granting (still `undetermined` on iOS in some
   * edge cases). */
  pushAsked: boolean;
  /** True once the user tapped « J'ai fait » on « Volume à fond ». */
  volumeAck: boolean;
  /** True once the user tapped « J'ai fait » on « Écran toujours allumé ». */
  sleepAck: boolean;
};

/** The four mutually-exclusive verdicts the adapter renders. */
export type OnboardingStep =
  /** First frame, `Notifications.getPermissionsAsync()` not resolved yet. */
  | "loading"
  /** Render the custom rationale + « Activer » CTA that triggers
   * `requestPermissionsAsync()`. */
  | "push-prompt"
  /** Render the two-item « Volume à fond » + « Écran toujours allumé »
   * checklist with one « J'ai fait » button per item. */
  | "checklist"
  /** Both checklist items acknowledged — fire `markOnboardingCompleted` and
   * redirect to `(tabs)/index`. The adapter keeps a brief spinner up while
   * the Convex round-trip resolves. */
  | "completing";

/**
 * Decide which onboarding step the route should render this frame. Pure: same
 * inputs ⇒ same output, no side effects, no `Date.now()`. The route component
 * is a thin adapter that calls this on every render and reacts to the verdict.
 */
export function decideOnboardingStep(
  inputs: OnboardingStepInputs,
): OnboardingStep {
  // 1. Pre-resolution guard — keep the spinner up while the OS query resolves.
  //    A flash to `push-prompt` (a rationale re-shown to a user who already
  //    granted on a previous session) would be a UX bug.
  if (inputs.pushStatus === undefined) {
    return "loading";
  }

  // 2. Both checklist items acknowledged — done, fire the mutation and
  //    redirect. Checked BEFORE `push-prompt` so a re-render after the
  //    rationale (with `pushAsked = true` AND both acks coincidentally set,
  //    e.g. during a fast-finger E2E run) cannot loop back to the prompt.
  if (inputs.volumeAck && inputs.sleepAck) {
    return "completing";
  }

  // 3. Push permission rationale screen — ONLY when the OS has not been asked
  //    yet on this device AND we have not asked in this run either. Once
  //    `pushAsked` is true (even with an unchanged `undetermined` status from
  //    an iOS dismiss), we move forward to the checklist.
  if (inputs.pushStatus === "undetermined" && !inputs.pushAsked) {
    return "push-prompt";
  }

  // 4. Default: the checklist. Reached for granted, denied, or
  //    `undetermined` post-ask. The push status itself does NOT block the
  //    checklist — refusing push is fine (the persistent banner #395 surfaces
  //    that). The acceptance criteria from the issue body: « écran checklist
  //    avec 2 items, chacun avec un bouton « J'ai fait » ».
  return "checklist";
}
