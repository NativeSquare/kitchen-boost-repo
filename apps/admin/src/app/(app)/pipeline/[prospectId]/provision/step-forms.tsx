"use client";

/**
 * F-WIZARD [1/10] (#265) + [3/10] (#267) + [5/10] (#269) + [6/10] (#270) +
 * [7/10] (#271) — Step{N}Form dispatch map.
 *
 * Steps still using a placeholder (« TODO Step N — <title> » + Prev/Next nav
 * buttons): 2, 6, 7, 8. Each follow-up wizard slice swaps its own
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
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import { useParams } from "next/navigation";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import type { BrandingPatch } from "@/app/(app)/t/[tenantId]/parametres/branding-editor";
import type { CoordonneesPatch } from "@/app/(app)/t/[tenantId]/parametres/coordonnees-editor";
import type { AcceptedModesPatch } from "@/app/(app)/t/[tenantId]/parametres/modes-editor";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import { bucketItemsByCategory } from "@/app/(app)/t/[tenantId]/menu/item-list";

import {
  Step1ProvisioningForm,
  type Step1ProvisioningPayload,
} from "./step1-provisioning-form";
import { Step3StripeKycForm } from "./step3-stripe-kyc-form";
import { Step4BrandingForm } from "./step4-branding-form";
import { Step5MenuForm } from "./step5-menu-form";
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

function makeStepForm(step: Exclude<WizardStepNumber, 1 | 3 | 4 | 5>) {
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

/**
 * F-WIZARD [6/10] (#270) — Step4Form: thin Convex-wiring wrapper around the
 * pure `Step4BrandingForm`. Owns:
 *   - the prospect read (`useQuery(api.lib.onboarding.crm.getProspect)`) so
 *     we have the tenantId back-link (required by the three section saves);
 *   - the tenant read (`useQuery(api.lib.stripe.account.loadTenantForStripe,
 *     { tenantId })`) — root-only KB Admin query that returns the full
 *     `Doc<"tenants">` (cf. qr/page.tsx + parametres/page.tsx, same pattern).
 *     The wizard runs as KB Admin (chrome-less layout under /pipeline/...),
 *     so this root query is the authorised seed source for the editors;
 *   - the three save mutations + the upload mutation, all called directly via
 *     `useMutation(...)` with an explicit `tenantId` arg — NOT through
 *     `useTenantMutation`, because the wizard route lives OUTSIDE the
 *     `/t/[tenantId]/...` shell (no `<TenantProvider/>`, no auto-injection).
 *     The KB Admin root override on `tenantMutation` (cf. `withTenant.ts`
 *     « Root: unlimited access to every tenant, bypasses `allow` ») lets a
 *     KB Admin call the `kb_manager`-allow-listed mutations directly;
 *   - the two-step upload flow (`generateUploadUrl` → POST → resolve URL
 *     via `api.storage.getImageUrl` through `useConvex().query(...)`) — same
 *     shape as Paramètres' `handleUploadLogo`;
 *   - the success / error toasts at the wrapper level + re-throws so the
 *     three editors surface inline form errors too (same discipline as
 *     Paramètres' `handleSaveBranding` / `handleSaveCoordonnees` / etc.).
 *
 * Why this wiring lives in `step-forms.tsx` (not in a sibling file): mirror
 * of `Step1Form` / `Step3Form`. Each Step{N}Form wrapper owns its own data
 * hooks so the wizard-view's prop set doesn't have to evolve with every
 * step's needs. The lean `node` vitest env doesn't execute these hooks (the
 * serializer's try/catch swallows the « invalid hook call » when invoking
 * the function outside a React render); the wrapper's behaviour is pinned
 * indirectly through the pure form tests (`step4-branding-form.test.tsx`)
 * and directly through CI runtime + E2E.
 */
function Step4Form({ onPrev, onNext }: StepFormProps): React.JSX.Element {
  const params = useParams<{ prospectId: string }>();
  const prospectId = params?.prospectId as unknown as
    | Id<"prospects">
    | undefined;

  const prospect = useQuery(
    api.lib.onboarding.crm.getProspect,
    prospectId !== undefined ? { prospectId } : "skip",
  );

  // Tenant seed — only fires once the prospect has been provisioned (i.e.
  // `prospect.tenantId` is set). Until then we render a defensive « tenant
  // requis » message; the wizard's cursor heuristic (`computeWizardState`)
  // already prevents step 4 access without a tenant, this is the backstop.
  const tenantId = prospect?.tenantId;
  const tenantDoc = useQuery(
    api.lib.stripe.account.loadTenantForStripe,
    tenantId !== undefined ? { tenantId } : "skip",
  );

  const updateSettings = useMutation(
    api.lib.admin.tenantSettings.updateSettings,
  );
  const generateUploadUrl = useMutation(api.lib.menu.photos.generateUploadUrl);
  const convex = useConvex();

  // Defensive loading / not-found — outer `decideWizardShell` plus the
  // wizard cursor normally gate these, but races between the page-level
  // queries and this child's queries are possible (same defence as Step1
  // / Step3).
  if (prospect === undefined) {
    return (
      <div
        className="flex items-center justify-center px-4 py-12 lg:px-6"
        data-slot="wizard-step4-loading"
      >
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (prospect === null) {
    return (
      <div
        className="px-4 py-6 text-sm text-destructive lg:px-6"
        data-slot="wizard-step4-not-found"
      >
        Prospect introuvable. Impossible de configurer le branding.
      </div>
    );
  }
  if (tenantId === undefined) {
    // Hard gate: branding lives on the tenant — step 1 must run first.
    return (
      <div
        className="px-4 py-6 text-sm text-destructive lg:px-6"
        data-slot="wizard-step4-no-tenant"
      >
        Le tenant doit être créé (Step 1) avant de configurer le branding.
      </div>
    );
  }

  const handleSaveBranding = async (patch: BrandingPatch): Promise<void> => {
    try {
      await updateSettings({ tenantId, patch });
      toast.success("Identité visuelle enregistrée.");
    } catch (error) {
      toast.error("Impossible d'enregistrer l'identité visuelle", {
        description: getConvexErrorMessage(error),
      });
      throw error;
    }
  };

  const handleSaveCoordonnees = async (
    patch: CoordonneesPatch,
  ): Promise<void> => {
    try {
      await updateSettings({ tenantId, patch });
      toast.success("Coordonnées enregistrées.");
    } catch (error) {
      toast.error("Impossible d'enregistrer les coordonnées", {
        description: getConvexErrorMessage(error),
      });
      throw error;
    }
  };

  const handleSaveAcceptedModes = async (
    patch: AcceptedModesPatch,
  ): Promise<void> => {
    try {
      await updateSettings({ tenantId, patch });
      toast.success("Modes acceptés enregistrés.");
    } catch (error) {
      toast.error("Impossible d'enregistrer les modes acceptés", {
        description: getConvexErrorMessage(error),
      });
      throw error;
    }
  };

  const handleUploadLogo = async (file: File): Promise<string> => {
    const uploadUrl = await generateUploadUrl({ tenantId });
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) {
      throw new Error(`Upload failed (HTTP ${response.status})`);
    }
    const { storageId } = (await response.json()) as {
      storageId: Id<"_storage">;
    };
    const publicUrl = await convex.query(api.storage.getImageUrl, {
      storageId,
    });
    if (publicUrl === null) {
      throw new Error("Le fichier téléversé est introuvable.");
    }
    return publicUrl;
  };

  return (
    <Step4BrandingForm
      branding={tenantDoc?.branding}
      coordonnees={
        tenantDoc !== undefined && tenantDoc !== null
          ? { address: tenantDoc.address, phone: tenantDoc.phone }
          : undefined
      }
      acceptedModes={
        tenantDoc !== undefined &&
        tenantDoc !== null &&
        tenantDoc.acceptedModes !== undefined
          ? {
              delivery: tenantDoc.acceptedModes.delivery,
              clickAndCollect: tenantDoc.acceptedModes.clickAndCollect,
            }
          : undefined
      }
      onSaveBranding={handleSaveBranding}
      onUploadLogo={handleUploadLogo}
      onSaveCoordonnees={handleSaveCoordonnees}
      onSaveAcceptedModes={handleSaveAcceptedModes}
      onPrev={onPrev}
      onNext={onNext}
    />
  );
}

/**
 * F-WIZARD [7/10] (#271) — Step5Form: thin Convex-wiring wrapper around the
 * pure `Step5MenuForm`. Owns:
 *   - the prospect read (`useQuery(api.lib.onboarding.crm.getProspect)`) for
 *     the `tenantId` back-link (every menu mutation needs an explicit
 *     `tenantId` arg here — the wizard route lives OUTSIDE the
 *     `/t/[tenantId]/menu` shell that backs `<TenantProvider/>`, so
 *     `useTenantQuery` / `useTenantMutation` are NOT usable);
 *   - the three live data queries (categories, items, modifier groups) —
 *     plain `useQuery(... , { tenantId })`. The KB Admin root override on
 *     `tenantQuery` (cf. `withTenant.ts`) lets the wizard call the
 *     `kb_manager`-allow-listed queries directly while running as KB Admin;
 *   - the publication status query — `hasUnpublishedChanges.lastPublishedAt`
 *     is the canonical gate signal (ADR 0015 « édition brouillon →
 *     publication globale atomique »; B-MENU-PUBLICATION slice 5, #176);
 *   - the seven CRUD mutations (categories.create / .rename / .remove /
 *     .reorder, items.reorder, availability.setItemAvailability,
 *     modifiers.createGroup / .updateGroup / .removeGroup) plus the
 *     `publishMenu` mutation — all called with explicit `tenantId`;
 *   - the publish + CRUD error toasts + the wizard-side persistent
 *     `publishError` state surfaced to the form (the form keeps the
 *     message visible across the wizard chrome even after the toast
 *     dismisses).
 *
 * NOT WIRED HERE (deliberately): `ItemModal` (create/edit items) and
 * `ModifierGroupModal` (create/edit modifier groups). The standalone
 * `/t/[tenantId]/menu` page mounts those modals because they require a
 * `<TenantProvider/>` ancestor (the modal itself calls `useQuery`
 * internally for image-storage URL resolution + the photo upload uses
 * `useTenantMutation`). Reusing them under the wizard route would require
 * extending each modal's prop set to thread the tenantId — explicitly out
 * of scope for the V1 slice (issue spec accepts « CRUD catégories + items
 * minimum, modifiers idéalement », and the « items » CRUD here means
 * « category-level + reordering + rupture toggle » — the per-item details
 * remain editable from the standalone Menu page that the operator opens
 * post-provisioning when needed). Adding the item modal here requires its
 * own slice once the modal accepts a `tenantId` prop or once `TenantProvider`
 * can be mounted around a subtree without changing the route.
 *
 * Mirror of `Step4Form`'s discipline: the lean `node` vitest env doesn't
 * execute these hooks (the serializer's try/catch swallows the « invalid
 * hook call » when invoking the wrapper outside a React render); the
 * wrapper's behaviour is pinned indirectly through the pure form tests
 * (`step5-menu-form.test.tsx`) and directly through CI runtime + E2E.
 */
function Step5Form({ onPrev, onNext }: StepFormProps): React.JSX.Element {
  const params = useParams<{ prospectId: string }>();
  const prospectId = params?.prospectId as unknown as
    | Id<"prospects">
    | undefined;

  const prospect = useQuery(
    api.lib.onboarding.crm.getProspect,
    prospectId !== undefined ? { prospectId } : "skip",
  );

  const tenantId = prospect?.tenantId;

  // All menu queries are KB Admin root-overridden tenantQueries — we call
  // them directly with the explicit `tenantId`. `"skip"` until the prospect
  // resolves AND has a `tenantId` back-link (step 1 must have run first).
  const categories = useQuery(
    api.lib.menu.categories.list,
    tenantId !== undefined ? { tenantId } : "skip",
  );
  const items = useQuery(
    api.lib.menu.items.list,
    tenantId !== undefined ? { tenantId } : "skip",
  );
  const modifierGroups = useQuery(
    api.lib.menu.modifiers.listGroups,
    tenantId !== undefined ? { tenantId } : "skip",
  );
  const publicationStatus = useQuery(
    api.lib.menu.publication.hasUnpublishedChanges,
    tenantId !== undefined ? { tenantId } : "skip",
  );

  // CRUD mutations — all explicit `{ tenantId, ... }`. Same KB Admin root
  // override applies.
  const createCategory = useMutation(api.lib.menu.categories.create);
  const renameCategory = useMutation(api.lib.menu.categories.rename);
  const removeCategory = useMutation(api.lib.menu.categories.remove);
  const reorderCategories = useMutation(api.lib.menu.categories.reorder);
  const reorderItems = useMutation(api.lib.menu.items.reorder);
  const setItemAvailability = useMutation(
    api.lib.menu.availability.setItemAvailability,
  );
  // NOTE: `createModifierGroup` + `updateGroup` mutations are intentionally
  // NOT bound here — the wizard's modifier-group create / edit affordances
  // surface a hint toast directing the operator to the standalone Menu page
  // (the dedicated UX mounts the full `ModifierGroupModal`, which the wizard
  // would need a `<TenantProvider/>` ancestor to host — out of scope for
  // this slice, see the head comment). `removeGroup` IS bound: a future
  // slice mounting the modal here can use the delete callback as-is from
  // inside the modal's confirmation panel.
  const removeModifierGroup = useMutation(api.lib.menu.modifiers.removeGroup);
  const publishMenu = useMutation(api.lib.menu.publication.publishMenu);

  const [publishLoading, setPublishLoading] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Defensive loading / not-found — outer `decideWizardShell` + the cursor
  // heuristic normally gate these (same defence as Step3Form / Step4Form).
  if (prospect === undefined) {
    return (
      <div
        className="flex items-center justify-center px-4 py-12 lg:px-6"
        data-slot="wizard-step5-loading"
      >
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (prospect === null) {
    return (
      <div
        className="px-4 py-6 text-sm text-destructive lg:px-6"
        data-slot="wizard-step5-not-found"
      >
        Prospect introuvable. Impossible de configurer le menu.
      </div>
    );
  }
  if (tenantId === undefined) {
    // Hard gate: menu lives on the tenant — step 1 must run first.
    return (
      <div
        className="px-4 py-6 text-sm text-destructive lg:px-6"
        data-slot="wizard-step5-no-tenant"
      >
        Le tenant doit être créé (Step 1) avant de configurer le menu.
      </div>
    );
  }

  // Bucket items by their `categoryId` for the per-category sections (same
  // pattern as `/t/[tenantId]/menu/page.tsx`).
  const itemsByCategory = bucketItemsByCategory(items);

  const handleCreateCategory = async () => {
    try {
      await createCategory({ tenantId, name: "Nouvelle catégorie" });
    } catch (error) {
      toast.error("Impossible de créer la catégorie", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const handleRenameCategory = async (
    categoryId: Id<"menuCategories">,
    name: string,
  ) => {
    try {
      await renameCategory({ tenantId, categoryId, name });
    } catch (error) {
      toast.error("Impossible de renommer la catégorie", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const handleDeleteCategory = async (categoryId: Id<"menuCategories">) => {
    try {
      await removeCategory({ tenantId, categoryId });
    } catch (error) {
      toast.error("Impossible de supprimer la catégorie", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const handleReorderCategories = async (
    orderedIds: Id<"menuCategories">[],
  ) => {
    try {
      await reorderCategories({ tenantId, orderedIds });
    } catch (error) {
      toast.error("Impossible de réordonner les catégories", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const handleReorderItems = async (
    categoryId: Id<"menuCategories">,
    orderedIds: Id<"menuItems">[],
  ) => {
    try {
      await reorderItems({ tenantId, categoryId, orderedIds });
    } catch (error) {
      toast.error("Impossible de réordonner les items", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const handleToggleItemAvailability = async (
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) => {
    try {
      await setItemAvailability({ tenantId, itemId, available: nextAvailable });
    } catch (error) {
      toast.error("Impossible de mettre à jour la disponibilité", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  // The wizard's step 5 surface does NOT mount the item modal (see the
  // wrapper's head comment for the rationale). The « + Item » CTA and the
  // item-card click are wired to no-ops here — the operator creates / edits
  // items from the standalone Menu page post-provisioning. We keep the
  // callbacks present so `MenuView` renders its full surface (categories
  // + per-category items sections); they simply do nothing in this slice.
  const handleCreateItem = (_categoryId: Id<"menuCategories">) => {
    toast.info(
      "Ouvre la page Menu du tenant pour créer / éditer les items en détail.",
    );
  };
  const handleItemClick = (_itemId: Id<"menuItems">) => {
    toast.info("Ouvre la page Menu du tenant pour éditer cet item en détail.");
  };

  // Modifier-group CRUD: the « + Personnalisation » / « Éditer » row
  // affordances on `ModifierGroupsSection` open the modifier-group modal
  // on the standalone /menu page. Same scope discipline as the item
  // modal — we surface a hint toast here directing the operator to the
  // dedicated page. The « Supprimer » path (called from the modal) is
  // wired live: a future slice mounting the modal here can use it as-is.
  const handleCreateModifierGroup = () => {
    toast.info(
      "Ouvre la page Menu du tenant pour créer une personnalisation détaillée.",
    );
  };
  const handleEditModifierGroup = (_groupId: Id<"modifierGroups">) => {
    toast.info(
      "Ouvre la page Menu du tenant pour éditer cette personnalisation.",
    );
  };
  const handleDeleteModifierGroup = async (groupId: Id<"modifierGroups">) => {
    try {
      await removeModifierGroup({ tenantId, modifierGroupId: groupId });
    } catch (error) {
      toast.error("Impossible de supprimer la personnalisation", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  // F-MENU-10 mirror — track in-flight + surface backend errors BOTH as a
  // page-level toast AND as a wizard-side persistent message. The persistent
  // message lives in `publishError` so the operator sees it after the toast
  // auto-dismisses (typically 4-5s).
  const handlePublish = async () => {
    if (publishLoading) return;
    setPublishLoading(true);
    setPublishError(null);
    try {
      await publishMenu({ tenantId });
      toast.success("Menu publié");
    } catch (error) {
      const message = getConvexErrorMessage(error);
      setPublishError(message);
      toast.error("Impossible de publier le menu", { description: message });
    } finally {
      setPublishLoading(false);
    }
  };

  return (
    <Step5MenuForm
      categories={categories}
      itemsByCategory={itemsByCategory}
      modifierGroups={modifierGroups}
      lastPublishedAt={publicationStatus?.lastPublishedAt}
      publishLoading={publishLoading}
      publishError={publishError}
      onPublish={handlePublish}
      onCreateCategory={handleCreateCategory}
      onRenameCategory={handleRenameCategory}
      onDeleteCategory={handleDeleteCategory}
      onReorderCategories={handleReorderCategories}
      onToggleItemAvailability={handleToggleItemAvailability}
      onCreateItem={handleCreateItem}
      onItemClick={handleItemClick}
      onReorderItems={handleReorderItems}
      onCreateModifierGroup={handleCreateModifierGroup}
      onEditModifierGroup={handleEditModifierGroup}
      onDeleteModifierGroup={handleDeleteModifierGroup}
      onPrev={onPrev}
      onNext={onNext}
    />
  );
}

export const Step2Form = makeStepForm(2);
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
