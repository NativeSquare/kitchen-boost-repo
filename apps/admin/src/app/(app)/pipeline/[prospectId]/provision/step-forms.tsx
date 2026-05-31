"use client";

/**
 * F-WIZARD [1/10] (#265) + [3/10] (#267) + [5/10] (#269) — Step{N}Form
 * dispatch map.
 *
 * Steps still using a placeholder (« TODO Step N — <title> » + Prev/Next nav
 * buttons): 2, 4, 5, 6, 7, 8. Each follow-up wizard slice swaps its own
 * placeholder for a real form WITHOUT touching the wizard shell. The shell
 * hands `onPrev` / `onNext` to whatever form lives at the slot.
 *
 * Step 1 (« Compte resto ») is the SLICE CHARNIÈRE: #267 replaces its
 * placeholder with the real provisioning form (`Step1ProvisioningForm`) and a
 * thin Convex-wiring wrapper (`Step1Form` below) that owns:
 *   - the prospect read (`useQuery(api.lib.onboarding.crm.getProspect)`),
 *   - the `provisionTenant` mutation (`useMutation(api.lib.onboarding
 *     .provisioning.provisionTenant)`),
 *   - the backend-error state surfaced inline,
 *   - the navigation-to-step-2 on success.
 *
 * Step 3 (« Stripe KYC ») is the second slice charnière: #269 replaces its
 * placeholder with the real `Step3StripeKycForm` and a thin wiring wrapper
 * (`Step3Form` below) that owns:
 *   - the prospect read (for the `prefill` arg — SIRET, email, firstName,
 *     lastName) + the tenantId back-link,
 *   - the `createStripeAccountLink` action call,
 *   - the URL state + the « step non-bloquant » warning toast on Continue
 *     without generation,
 *   - the copy-to-clipboard side-effect (navigator.clipboard.writeText +
 *     `toast.success("Lien copié")`).
 *
 * Why the wiring lives in `Step{N}Form` (not in `page.tsx`):
 * ---------------------------------------------------------
 * The wizard-view dispatches `STEP_FORMS[currentStep]({ onPrev, onNext })`
 * uniformly. Threading prospect + mutation through the WizardView prop set
 * would force its signature to evolve every time a step needs a new piece of
 * context — strictly worse layering than letting Step{N}Form own its own
 * data hooks. The lean `node` vitest env doesn't execute these hooks (the
 * serializer's try/catch swallows the « invalid hook call » when invoking
 * the function outside a React render); the wrapper's behaviour is pinned
 * indirectly through the pure form tests (`step1-provisioning-form.test.tsx`,
 * `step3-stripe-kyc-form.test.tsx`) and directly through CI runtime + E2E.
 *
 * Step 1 has no « Précédent » target (it's the entry point); step 8 has no
 * « Suivant » target (it's the activation — the real form lands in its own
 * slice with a 2-step confirmation UX). All other steps render both buttons.
 *
 * The placeholders are EXPLICITLY un-styled flair-wise: they MUST look
 * obviously-placeholder so an operator never confuses them for a usable
 * form. The follow-up slice will replace the file's content entirely.
 */
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import {
  Step1ProvisioningForm,
  type Step1ProvisioningPayload,
} from "./step1-provisioning-form";
import { Step3StripeKycForm } from "./step3-stripe-kyc-form";
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

function makeStepForm(step: Exclude<WizardStepNumber, 1 | 3>) {
  function StepForm({ onPrev, onNext }: StepFormProps) {
    return (
      <div className="flex flex-col gap-4 px-4 py-2 lg:px-6">
        {placeholderBody(step)}
        {/* Step 1 / Step 3 are real forms (#267 / #269) and own their own nav
            UX; placeholder steps always render Précédent (step 1 is the entry
            point, so step 2's Précédent navigates back to step 1's real form),
            and hide Suivant on step 8 (activation — its own slice ships a
            2-step confirmation UX). */}
        <NavButtons onPrev={onPrev} onNext={onNext} hideNext={step === 8} />
      </div>
    );
  }
  StepForm.displayName = `Step${step}Form`;
  return StepForm;
}

/**
 * F-WIZARD [3/10] (#267) — Step1Form: thin Convex-wiring wrapper around the
 * pure `Step1ProvisioningForm`.
 *
 * Reads the prospect via `useQuery(api.lib.onboarding.crm.getProspect)` so the
 * form pre-fills its 6 fields. Owns the in-flight + error state for the
 * `provisionTenant` mutation; on success calls `onNext()` so the wizard
 * advances to step 2 (the page's `goToStep` cursor). On a `ConvexError` —
 * `SLUG_TAKEN`, `INVALID_SIRET`, etc. — the message is surfaced inline under
 * the form and the form keeps its values intact (the operator can correct +
 * retry without re-typing).
 *
 * The `prospectId` is read from the URL segment (`useParams<{ prospectId }>`)
 * — same pattern as `page.tsx`. We deliberately do NOT thread `prospect`
 * through the wizard-view prop set (kept lean, see the file header).
 *
 * Loading / not-found are defensive: the wizard-view's outer
 * `decideWizardShell` already short-circuits these branches BEFORE
 * `STEP_FORMS[1]` is dispatched (loading-prospect / not-found / wrong-phase),
 * so in practice the prospect IS hydrated by the time this component
 * renders. The defensive spinner protects against a stale render between
 * the parent's query resolving and this child's query resolving.
 */
function Step1Form({ onPrev, onNext }: StepFormProps): React.JSX.Element {
  const params = useParams<{ prospectId: string }>();
  const prospectId = params?.prospectId as unknown as
    | Id<"prospects">
    | undefined;

  const prospect = useQuery(
    api.lib.onboarding.crm.getProspect,
    prospectId !== undefined ? { prospectId } : "skip",
  );
  const provisionTenant = useMutation(
    api.lib.onboarding.provisioning.provisionTenant,
  );

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Defensive loading / not-found — the outer `decideWizardShell` normally
  // gates these, but a race between the page-level prospect query and this
  // component's query resolving is possible.
  if (prospect === undefined) {
    return (
      <div
        className="flex items-center justify-center px-4 py-12 lg:px-6"
        data-slot="wizard-step1-loading"
      >
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (prospect === null) {
    return (
      <div
        className="px-4 py-6 text-sm text-destructive lg:px-6"
        data-slot="wizard-step1-not-found"
      >
        Prospect introuvable. Impossible de provisionner ce restaurant.
      </div>
    );
  }

  const handleProvision = async (payload: Step1ProvisioningPayload) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // Map the form's spec-aligned payload to the backend mutation
      // signature. `provisionTenant` accepts:
      //   { prospectId, name, siret, slug, customDomain?, manager: { email, name? } }
      // The form's `address` is captured for future use (KYC pré-rempli,
      // Stripe billing address) but is not yet persisted by the V1 mutation
      // — kept in the payload so the wiring is future-proof when the backend
      // grows the field. Same for `contactName` (carried into `manager.name`).
      await provisionTenant({
        prospectId: payload.prospectId,
        name: payload.name,
        siret: payload.siret,
        slug: payload.slug,
        manager: {
          email: payload.emailManager,
          name:
            payload.contactName.trim().length > 0
              ? payload.contactName
              : undefined,
        },
      });
      // Success → advance the wizard cursor. The parent's `useWizardState`
      // will reactively re-derive `currentStep` once Convex's reactivity
      // re-fires `getProspect` (now carrying `tenantId`), but the explicit
      // `onNext` keeps the UX deterministic (no flicker between « in-flight
      // / step 1 » → « completed / step 2 »).
      onNext();
    } catch (error) {
      setSubmitError(getConvexErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Step1ProvisioningForm
      prospect={prospect}
      onProvision={handleProvision}
      isSubmitting={isSubmitting}
      submitError={submitError}
      onPrev={onPrev}
      onNext={onNext}
    />
  );
}

/**
 * F-WIZARD [5/10] (#269) — Step3Form: thin wiring wrapper around the pure
 * `Step3StripeKycForm`. Owns:
 *   - the prospect read (`useQuery(api.lib.onboarding.crm.getProspect)`) so
 *     we have the `prefill` Stripe needs (siret, email, firstName, lastName);
 *   - the `createStripeAccountLink` action — Convex `useAction` directly
 *     (NOT `useTenantAction`: this wizard lives under `/pipeline`, OUTSIDE
 *     the `/t/[tenantId]` shell that backs the auto-injection, and the
 *     action is `kb_admin`-root rather than `tenantAction`).
 *   - the URL state + the in-flight + error state surfaced to the form.
 *   - the copy-to-clipboard side-effect (`navigator.clipboard.writeText`) +
 *     `toast.success` on copy, `toast.warning` on Continue-without-link.
 *
 * Prefill name split: the prospect carries a single `contactName` (« nom du
 * gérant ou raison sociale »); Stripe requires `firstName` + `lastName`. We
 * split on the FIRST space — naïve but matches the rest of the FR onboarding
 * UX (the operator can fix it directly in Stripe Express if needed).
 *
 * Refresh / return URLs: both point back to this same wizard route. Stripe
 * sends the gérant to `return_url` on completion and to `refresh_url` if the
 * link has expired — landing back on step 3 lets the operator simply
 * « Régénérer » a fresh one.
 */
function Step3Form({ onPrev, onNext }: StepFormProps): React.JSX.Element {
  const params = useParams<{ prospectId: string }>();
  const prospectId = params?.prospectId as unknown as
    | Id<"prospects">
    | undefined;

  const prospect = useQuery(
    api.lib.onboarding.crm.getProspect,
    prospectId !== undefined ? { prospectId } : "skip",
  );
  const createStripeAccountLink = useAction(
    api.lib.stripe.account.createStripeAccountLink,
  );

  const [accountLinkUrl, setAccountLinkUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  // Defensive loading / not-found — the outer `decideWizardShell` normally
  // gates these, but a race between the page-level prospect query and this
  // component's query resolving is possible (same as Step1Form).
  if (prospect === undefined) {
    return (
      <div
        className="flex items-center justify-center px-4 py-12 lg:px-6"
        data-slot="wizard-step3-loading"
      >
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (prospect === null) {
    return (
      <div
        className="px-4 py-6 text-sm text-destructive lg:px-6"
        data-slot="wizard-step3-not-found"
      >
        Prospect introuvable. Impossible de générer le lien Stripe KYC.
      </div>
    );
  }
  if (prospect.tenantId === undefined) {
    // Hard gate: Step 1 (provisioning) must be done first — without a tenant
    // there's no Stripe account to back. The wizard's cursor heuristic
    // (`computeWizardState`) already prevents this in normal flow; this is
    // the defensive backstop.
    return (
      <div
        className="px-4 py-6 text-sm text-destructive lg:px-6"
        data-slot="wizard-step3-no-tenant"
      >
        Le tenant doit être créé (Step 1) avant de générer un lien Stripe KYC.
      </div>
    );
  }

  const tenantId = prospect.tenantId;

  const handleGenerate = async () => {
    if (isGenerating) return;
    setIsGenerating(true);
    setGenError(null);
    try {
      // Naïve split of `contactName` into first/last (Stripe Express requires
      // both). Empty fallbacks keep the call well-formed even if the prospect
      // doc is bare-bones — Stripe Express will surface the missing fields
      // during onboarding for the gérant to fill in.
      const contact = (prospect.contactName ?? "").trim();
      const [firstName, ...rest] = contact.split(/\s+/);
      const lastName = rest.join(" ");
      const refreshUrl =
        typeof window !== "undefined" ? window.location.href : "";
      const returnUrl = refreshUrl;
      const result = await createStripeAccountLink({
        tenantId,
        refreshUrl,
        returnUrl,
        prefill: {
          siret: prospect.siret ?? "",
          email: prospect.email ?? "",
          firstName: firstName ?? "",
          lastName,
        },
      });
      setAccountLinkUrl(result.url);
    } catch (error) {
      setGenError(getConvexErrorMessage(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async (url: string) => {
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard !== undefined
      ) {
        await navigator.clipboard.writeText(url);
        toast.success("Lien copié");
      }
    } catch {
      toast.error("Impossible de copier le lien");
    }
  };

  const handleContinue = () => {
    if (accountLinkUrl === null) {
      // Step non-bloquant: warn the operator they can come back to Paramètres
      // tenant later to launch the KYC.
      toast.warning(
        "Le lien Stripe n'a pas été généré. Le KYC pourra être lancé plus tard depuis Paramètres tenant.",
      );
    }
    onNext();
  };

  return (
    <Step3StripeKycForm
      onGenerate={handleGenerate}
      accountLinkUrl={accountLinkUrl}
      isGenerating={isGenerating}
      genError={genError}
      onCopy={handleCopy}
      onPrev={onPrev}
      onNext={handleContinue}
    />
  );
}

export const Step2Form = makeStepForm(2);
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
