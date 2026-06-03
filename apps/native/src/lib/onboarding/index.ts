/**
 * Public API of the `onboarding` native module (#398 KB Orders, PRD 20 §1a).
 *
 * The `(onboarding)` route mounts `OnboardingFlow` after `(device-setup)`
 * (#393, kiosque/téléphone toggle) and BEFORE `(app)`. The component drives
 * the two remaining steps of the post-login sequence:
 *
 *  - **Push permission prompt** with custom rationale (PRD 20 §1a step 2).
 *  - **Checklist réglages device** — volume à fond + écran toujours allumé,
 *    each with a « J'ai fait » button (PRD 20 §1a step 4).
 *
 * Once both checklist items are acknowledged, the adapter fires
 * `markOnboardingCompleted` against Convex; the root `_layout.tsx` gate then
 * rebases onto `(app)` automatically.
 *
 *  - `OnboardingFlow` — the React component to mount in the onboarding route.
 *
 *  - `decideOnboardingStep` — the PURE decision function (no React, no Expo,
 *    no Convex). Pinned by the vitest suite next door.
 */
export { OnboardingFlow } from "./onboarding-flow";
export {
  decideOnboardingStep,
  type OnboardingPushStatus,
  type OnboardingStep,
  type OnboardingStepInputs,
} from "./decide-onboarding-step";
