import { OnboardingFlow } from "@/lib/onboarding";

/**
 * #398 — `(onboarding)` route, post-login sequence (PRD 20 §1a).
 *
 * Mounted by the root `_layout.tsx` gate when the caller is authenticated, has
 * already chosen `device.mode` in `(device-setup)` (#393), but has NOT yet
 * flipped `device.onboardingCompleted` to true. The whole flow (push permission
 * rationale + checklist réglages device) is implemented inside `OnboardingFlow`
 * — see `apps/native/src/lib/onboarding/`.
 *
 * On completion the Convex mutation `markOnboardingCompleted` flips the flag,
 * `getMyDevice` refreshes, and the root layout rebases onto `(app)` — no
 * `router.replace` needed here.
 */
export default function OnboardingScreen() {
  return <OnboardingFlow />;
}
