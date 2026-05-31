/**
 * F-WIZARD [1/10] (#265) — module API.
 *
 * Public surface of the provisioning wizard slice. Anything not re-exported
 * here is internal to the route group and may change without notice. The
 * KitchenBoost convention is one `index.ts` per `convex/lib/<feature>/` and
 * per front-side feature folder (mirrors session / tenant-context).
 *
 * Consumers (the prospect-fiche Launcher button in F-PIPELINE-CRM,
 * specifically) import:
 *   - `WIZARD_STEPS` — to label the « Lancer / Reprendre » CTA with the
 *     current step's title when re-entering the wizard.
 *   - `useWizardState` — to know if a prospect already has a tenantId and
 *     thus to display « Reprendre » vs « Lancer » (the issue's user story
 *     #11 + parent epic #143).
 *
 * The wizard view, page, layout, stepper, decision and step-forms are NOT
 * re-exported — they are route-internal and Next.js consumes them via the
 * file-system router.
 */
export { useWizardState, type UseWizardStateResult } from "./use-wizard-state";
export {
  WIZARD_STEPS,
  type WizardStep,
  type WizardStepNumber,
} from "./wizard-stepper";
export {
  computeWizardState,
  decideWizardShell,
  isStepNavigable,
  type WizardShellDecision,
  type WizardState,
} from "./wizard.decision";
