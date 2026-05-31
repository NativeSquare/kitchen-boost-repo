"use client";

/**
 * F-WIZARD [1/10] (#265) — Step{N}Form placeholders.
 *
 * Each step renders « TODO Step N — <title> » + Prev/Next nav buttons. The
 * placeholders own the navigation contract so every follow-up wizard slice
 * (2/10 through 10/10) can swap its placeholder for a real form WITHOUT
 * touching the wizard shell — the shell hands `onPrev` / `onNext` to whatever
 * form lives at the slot.
 *
 * Step 1 has no « Précédent » target (it's the entry point); step 8 has no
 * « Suivant » target (it's the activation — the real form lands in its own
 * slice with a 2-step confirmation UX). All other steps render both buttons.
 *
 * The placeholders are EXPLICITLY un-styled flair-wise: they MUST look
 * obviously-placeholder so an operator never confuses them for a usable
 * form. The follow-up slice will replace the file's content entirely.
 */
import { Button } from "@/components/ui/button";

import { WIZARD_STEPS, type WizardStepNumber } from "./wizard-stepper";

export type StepFormProps = {
  onPrev: () => void;
  onNext: () => void;
};

function placeholderBody(step: WizardStepNumber) {
  const meta = WIZARD_STEPS.find((s) => s.number === step);
  const title = meta?.title ?? "?";
  return (
    <div
      className="rounded-lg border border-dashed p-8 text-center"
      data-slot="wizard-step-placeholder"
      data-step={step}
    >
      <p className="text-muted-foreground text-sm">
        TODO Step {step} — {title} (placeholder, livré par la slice F-WIZARD [
        {step + 1}/10]).
      </p>
    </div>
  );
}

function NavButtons({
  onPrev,
  onNext,
  hidePrev,
  hideNext,
}: StepFormProps & { hidePrev?: boolean; hideNext?: boolean }) {
  return (
    <div className="mt-4 flex items-center justify-between gap-2 px-4 lg:px-6">
      {hidePrev ? (
        <span />
      ) : (
        <Button variant="outline" onClick={onPrev}>
          Précédent
        </Button>
      )}
      {hideNext ? <span /> : <Button onClick={onNext}>Suivant</Button>}
    </div>
  );
}

function makeStepForm(step: WizardStepNumber) {
  function StepForm({ onPrev, onNext }: StepFormProps) {
    return (
      <div className="flex flex-col gap-4 px-4 py-2 lg:px-6">
        {placeholderBody(step)}
        <NavButtons
          onPrev={onPrev}
          onNext={onNext}
          hidePrev={step === 1}
          hideNext={step === 8}
        />
      </div>
    );
  }
  StepForm.displayName = `Step${step}Form`;
  return StepForm;
}

export const Step1Form = makeStepForm(1);
export const Step2Form = makeStepForm(2);
export const Step3Form = makeStepForm(3);
export const Step4Form = makeStepForm(4);
export const Step5Form = makeStepForm(5);
export const Step6Form = makeStepForm(6);
export const Step7Form = makeStepForm(7);
export const Step8Form = makeStepForm(8);

/**
 * Step → component lookup used by `WizardView` to dispatch the current
 * step's form. Keys are the step number stringified so the lookup matches
 * `Object.keys(STEP_FORMS)` ordering pinned by the tests.
 */
export const STEP_FORMS: Record<
  1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
  (p: StepFormProps) => React.JSX.Element
> = {
  1: Step1Form,
  2: Step2Form,
  3: Step3Form,
  4: Step4Form,
  5: Step5Form,
  6: Step6Form,
  7: Step7Form,
  8: Step8Form,
};
