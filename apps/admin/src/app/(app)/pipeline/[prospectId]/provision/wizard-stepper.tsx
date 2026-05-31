"use client";

/**
 * F-WIZARD [1/10] (#265) — `WizardStepper`.
 *
 * Horizontal stepper for the 8-step provisioning wizard. Each step renders
 * with one of three visual states (`current` / `complete` / `pending`) and
 * accepts clicks per `isStepNavigable` (« click sur un step antérieur ou
 * current = navigation, click sur un step futur non-déverrouillé = no-op »,
 * issue spec verbatim).
 *
 * The component is purely presentational: the parent owns the cursor
 * (`currentStep`) and the completion check (`isStepComplete`), plus the
 * handler (`onStepChange`) that does the actual navigation. This keeps the
 * stepper testable in the lean `node` env (no React router, no Convex).
 *
 * `WIZARD_STEPS` is the single source of truth for the step numbers + short
 * titles (PRD 70 §3.6, ordre réordonné 2026-05-27). Exposed publicly so the
 * `Step{N}Form` placeholders can reuse the canonical title without a parallel
 * copy.
 */
import { IconCheck } from "@tabler/icons-react";

import { cn } from "@/lib/utils";
import { isStepNavigable } from "./wizard.decision";

export type WizardStepNumber = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export type WizardStep = {
  number: WizardStepNumber;
  title: string;
};

/**
 * The 8 wizard steps, fixed by issue #265 + PRD 70 §3.6. Short titles only —
 * the long-form rationale lives in the epic body, the form copy lives inside
 * each `Step{N}Form` placeholder.
 */
export const WIZARD_STEPS: ReadonlyArray<WizardStep> = [
  { number: 1, title: "Compte resto" },
  { number: 2, title: "Domaine" },
  { number: 3, title: "Stripe KYC" },
  { number: 4, title: "Branding" },
  { number: 5, title: "Menu" },
  { number: 6, title: "QR" },
  { number: 7, title: "Invitation" },
  { number: 8, title: "Activer" },
];

export type WizardStepperProps = {
  currentStep: WizardStepNumber;
  isStepComplete: (n: number) => boolean;
  onStepChange: (n: WizardStepNumber) => void;
};

type WizardStepState = "complete" | "current" | "pending";

function deriveState(
  step: WizardStepNumber,
  currentStep: WizardStepNumber,
  isStepComplete: (n: number) => boolean,
): WizardStepState {
  if (step === currentStep) return "current";
  if (isStepComplete(step)) return "complete";
  return "pending";
}

export function WizardStepper({
  currentStep,
  isStepComplete,
  onStepChange,
}: WizardStepperProps) {
  return (
    <ol
      className="flex flex-wrap items-center gap-2 px-4 py-3 lg:gap-3 lg:px-6"
      data-slot="wizard-stepper"
    >
      {WIZARD_STEPS.map((step) => {
        const state = deriveState(step.number, currentStep, isStepComplete);
        const navigable = isStepNavigable({
          targetStep: step.number,
          currentStep,
        });
        const handleClick = navigable
          ? () => onStepChange(step.number)
          : undefined;
        return (
          <li
            key={step.number}
            data-slot="wizard-step"
            data-state={state}
            data-step={step.number}
            onClick={handleClick}
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
              navigable && "cursor-pointer hover:bg-muted",
              !navigable && "cursor-not-allowed opacity-60",
              state === "current" &&
                "border-primary bg-primary/10 font-semibold text-primary",
              state === "complete" &&
                "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
              state === "pending" &&
                "border-muted-foreground/20 text-muted-foreground",
            )}
          >
            <span
              className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold",
                state === "current" && "bg-primary text-primary-foreground",
                state === "complete" && "bg-emerald-600 text-white",
                state === "pending" && "bg-muted text-muted-foreground",
              )}
              aria-hidden
            >
              {state === "complete" ? <IconCheck size={12} /> : step.number}
            </span>
            <span>{`${step.number}. ${step.title}`}</span>
          </li>
        );
      })}
    </ol>
  );
}
