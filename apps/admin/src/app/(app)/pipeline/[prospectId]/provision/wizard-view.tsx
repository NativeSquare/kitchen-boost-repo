"use client";

/**
 * F-WIZARD [1/10] (#265) — `WizardView`.
 *
 * Pure presentational shell of the `/pipeline/[prospectId]/provision` route.
 * Splitting it out of `page.tsx` (which owns `useSession`, `useQuery`,
 * `useParams`, `useRouter` + `useWizardState`) lets vitest pin every branch
 * — forbidden / loading / not-found / wrong-phase / show — under the lean
 * `node` env (no jsdom, no Convex test harness, no Next.js router), same
 * React-tree-serializer pattern used by `prospect-fiche-view.test.tsx`.
 *
 * Branches (matches `decideWizardShell`):
 *
 *   - session not ready                  → spinner.
 *   - `session.isAdmin === false`        → shared `UnauthorizedCard`.
 *   - prospect `undefined` (in-flight)   → loading skeleton.
 *   - prospect `null` (no doc)           → « introuvable » state with CTA.
 *   - prospect wrong-phase               → « phase incompatible » CTA back
 *                                          to the fiche prospect.
 *   - prospect hydrated + admit          → header + stepper + current form.
 *
 * Branding scope (issue #265): NO mutation is wired here — the form is the
 * placeholder `Step{N}Form`. Each follow-up wizard slice (2/10..10/10)
 * replaces its placeholder with the real form; the wizard shell, the
 * stepper, the access gates and the navigation contract stay stable.
 */
import Link from "next/link";
import { IconArrowLeft } from "@tabler/icons-react";

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { Spinner } from "@/components/ui/spinner";
import { UnauthorizedCard } from "@/components/app/unauthorized-card";
import type { SessionState } from "@/lib/session";

import { decideWizardShell } from "./wizard.decision";
import { STEP_FORMS } from "./step-forms";
import {
  WIZARD_STEPS,
  WizardStepper,
  type WizardStepNumber,
} from "./wizard-stepper";

export type WizardViewProps = {
  session: SessionState;
  prospect: Doc<"prospects"> | null | undefined;
  /** The tenant doc when `prospect.tenantId` is set (Convex tri-state). */
  tenant: Doc<"tenants"> | null | undefined;
  /** The published menu snapshot (Convex tri-state). */
  publishedMenu: Doc<"publishedMenus"> | null | undefined;
  /**
   * The manager invite (Convex tri-state). Currently lives in the shared
   * `adminInvites` table (legacy + manager invites cohabit per
   * `convex/table/adminInvites.ts`).
   */
  managerInvite: Doc<"adminInvites"> | null | undefined;
  /** The cursor — derived by the parent's `useWizardState`. */
  currentStep: WizardStepNumber;
  /**
   * Step navigation handler. The parent (page) owns the cursor and uses this
   * to mutate it; the wizard view simply renders the dispatched form.
   */
  onStepChange: (n: WizardStepNumber) => void;
  /**
   * Optional completion check from the parent's `useWizardState`. When
   * omitted, the view falls back to a naive `n < currentStep` heuristic so
   * the stepper still renders sensibly under the lean test env (no need to
   * pass the full hook output for branch tests). The real `(app)` page wires
   * the canonical `isStepComplete` from `computeWizardState`.
   */
  isStepComplete?: (n: number) => boolean;
  /**
   * F-WIZARD [4/10] (#268) — flip the local « step 2 skipped » flag.
   * Threaded down to Step2Form's « Skip » button. Optional so test
   * fixtures don't have to wire it (the wizard will simply not tick
   * step 2 green when the operator clicks Skip — non-breaking).
   */
  markStep2Skipped?: () => void;
};

function ProspectHeader({
  prospect,
  step,
}: {
  prospect: Doc<"prospects">;
  step: WizardStepNumber;
}) {
  const meta = WIZARD_STEPS.find((s) => s.number === step);
  return (
    <div className="flex flex-col gap-1 px-4 pt-4 lg:px-6">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">
        Provisioning · {prospect.name}
      </p>
      <h1 className="text-2xl font-bold">
        Étape {step} — {meta?.title}
      </h1>
    </div>
  );
}

export function WizardView({
  session,
  prospect,
  tenant: _tenant,
  publishedMenu: _publishedMenu,
  managerInvite: _managerInvite,
  currentStep,
  onStepChange,
  isStepComplete,
  markStep2Skipped,
}: WizardViewProps) {
  const decision = decideWizardShell({ session, prospect });

  if (decision.kind === "wait") {
    return (
      <div className="flex h-[60vh] w-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (decision.kind === "forbidden") {
    return (
      <UnauthorizedCard
        description={
          <>
            Le wizard de provisioning est réservé à l&apos;équipe KitchenBoost.
            Si vous pensez que c&apos;est une erreur, contactez le support.
          </>
        }
        primaryAction={{ label: "Retour au dashboard", href: "/" }}
      />
    );
  }

  if (decision.kind === "loading-prospect") {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <div className="text-muted-foreground text-sm">
            Chargement du prospect…
          </div>
        </div>
      </div>
    );
  }

  if (decision.kind === "not-found") {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <h1 className="text-2xl font-bold">Prospect introuvable</h1>
          <p className="text-muted-foreground text-sm">
            Aucun prospect ne correspond à cet identifiant. Impossible de lancer
            le wizard de provisioning.
          </p>
          <Link
            href="/pipeline"
            className="text-primary mt-2 inline-flex items-center gap-1 text-sm underline"
          >
            <IconArrowLeft size={14} />
            Retour à la liste des prospects
          </Link>
        </div>
      </div>
    );
  }

  if (decision.kind === "wrong-phase") {
    const ficheHref = `/pipeline/${decision.prospect._id as unknown as string}`;
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <h1 className="text-2xl font-bold">Phase incompatible</h1>
          <p className="text-muted-foreground text-sm">
            Ce prospect n&apos;est pas encore prêt à être provisionné (phase «{" "}
            {decision.prospect.phase} »). Le wizard de provisioning n&apos;est
            disponible qu&apos;à partir de la phase « préparation ».
          </p>
          <Link
            href={ficheHref}
            className="text-primary mt-2 inline-flex items-center gap-1 text-sm underline"
          >
            <IconArrowLeft size={14} />
            Retour à la fiche prospect
          </Link>
        </div>
      </div>
    );
  }

  // decision.kind === "show"
  const StepForm = STEP_FORMS[currentStep];
  const handlePrev = () => {
    if (currentStep > 1) onStepChange((currentStep - 1) as WizardStepNumber);
  };
  const handleNext = () => {
    if (currentStep < 8) onStepChange((currentStep + 1) as WizardStepNumber);
  };

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <ProspectHeader prospect={decision.prospect} step={currentStep} />
      <WizardStepper
        currentStep={currentStep}
        isStepComplete={isStepComplete ?? ((n) => n < currentStep)}
        onStepChange={onStepChange}
      />
      <StepForm
        onPrev={handlePrev}
        onNext={handleNext}
        onStepChange={onStepChange}
        markStep2Skipped={markStep2Skipped}
      />
    </div>
  );
}
