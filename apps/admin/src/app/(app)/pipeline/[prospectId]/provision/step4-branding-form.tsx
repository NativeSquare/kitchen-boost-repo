"use client";

/**
 * F-WIZARD [6/10] (#270) — `Step4BrandingForm`, the real Step 4 form that
 * replaces the placeholder shipped by slice [1/10] (#265).
 *
 * Step 4 — Branding élargi (PRD 70 §3.6). The form covers logo + couleur
 * primaire + adresse + téléphone + modes acceptés (delivery / click & collect)
 * — exactly the same surface as the KB Manager Paramètres tenant page (§4.8).
 * Issue spec verbatim: « C'est exactement le même form que la page Paramètres
 * tenant §4.8 (F-PARAMETRES #148) — réutilise le composant si déjà créé ».
 *
 * Three reusable editors, already shipped by F-PARAMETRES, are mounted here
 * unchanged:
 *   - `BrandingEditor` (#229)    — logo upload + colour picker, live preview.
 *   - `CoordonneesEditor` (#231) — address + FR-phone, inline validation.
 *   - `ModesEditor` (#234)       — delivery / clickAndCollect toggles, with
 *                                  the « au moins un mode actif » front guard.
 *
 * Each editor owns its own form state (`useForm`), its own diff-vs-`value`
 * patch builder, and its own « Enregistrer » button. They each call
 * `tenant.updateSettings` independently with their section sub-patch — the
 * backend `lib/admin/tenantSettings.ts` deep-merges the `branding` sub-object,
 * shallow-merges the top-level fields. Three independent saves, ONE backend
 * brick. This matches the existing Paramètres surface exactly (no duplicated
 * logic, no « big bang » composite submit — the operator can save sections
 * independently and revisit later).
 *
 * The wizard's value-add over the Paramètres page is the Précédent / Suivant
 * nav strip rendered after the editors. The Suivant button advances to step 5
 * regardless of save state — step 4 is non-blocking by spec (the completion
 * gate « primaryColor + logo posés » is owned by `computeWizardState`'s
 * `isBrandingComplete`; the cursor heuristic re-derives on the next render
 * once the tenant query reflects the saved branding).
 *
 * Scope (#270 hard constraint) : `apps/admin/src/app/(app)/pipeline/[prospectId]/provision/`
 * UNIQUEMENT. We import from `apps/admin/src/app/(app)/t/[tenantId]/parametres/`
 * (the existing editor modules) — that's still under `apps/admin`, the
 * forbidden scopes are `apps/web` and `apps/native`. The editors live there
 * because F-PARAMETRES shipped them first; the issue spec allows either
 * reusing them in place OR extracting them into a shared `components/` folder.
 * In-place reuse is the minimal-churn option — both the wizard and Paramètres
 * mount the SAME modules with the SAME contract, no shadow copy can drift.
 *
 * Testabilité : composant purement présentationnel. The Convex wiring
 * (`useMutation(updateSettings)`, `useMutation(photos.generateUploadUrl)`,
 * `useConvex().query(api.storage.getImageUrl)`, `toast`) lives in the
 * `Step4Form` wrapper in `step-forms.tsx` (same pattern as `Step1Form` /
 * `Step3Form`). The wrapper threads the four handlers + the three current
 * values down to this pure component — pin shape under the lean `node`
 * vitest env via the same React-tree serializer as the sibling forms.
 */

import {
  BrandingEditor,
  type BrandingPatch,
  type BrandingValue,
} from "@/app/(app)/t/[tenantId]/parametres/branding-editor";
import {
  CoordonneesEditor,
  type CoordonneesPatch,
  type CoordonneesValue,
} from "@/app/(app)/t/[tenantId]/parametres/coordonnees-editor";
import {
  ModesEditor,
  type AcceptedModesPatch,
  type ModesValue,
} from "@/app/(app)/t/[tenantId]/parametres/modes-editor";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import type { StepFormProps } from "./step-forms";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Step4BrandingFormProps = StepFormProps & {
  /**
   * Current persisted branding (`{ logoUrl?, primaryColor? }`). `undefined`
   * during the tenant query's loading sentinel — the editor degrades to an
   * empty form (treats it as `{}`), same contract as Paramètres.
   */
  branding: BrandingValue | undefined;
  /**
   * Current persisted coordonnées (`{ address?, phone? }`). `undefined` →
   * empty seeded form.
   */
  coordonnees: CoordonneesValue | undefined;
  /**
   * Current persisted accepted modes (`{ delivery?, clickAndCollect? }`).
   * `undefined` → editor seeds both flags to `true` (safe default for a
   * fresh tenant), mirror of Paramètres behaviour.
   */
  acceptedModes: ModesValue | undefined;
  /**
   * Branding save handler. Wired by `step-forms.tsx`'s `Step4Form` wrapper
   * to `useMutation(api.lib.admin.tenantSettings.updateSettings)` — the
   * backend deep-merges the `branding` sub-object server-side (cf.
   * `lib/admin/tenantSettings.ts`).
   */
  onSaveBranding: (patch: BrandingPatch) => Promise<void>;
  /**
   * Logo upload handler. Wired by the wrapper to the two-step Convex flow
   * (`generateUploadUrl` → POST → resolve URL via `api.storage.getImageUrl`),
   * same as the Paramètres page's `handleUploadLogo`.
   */
  onUploadLogo: (file: File) => Promise<string>;
  /**
   * Coordonnées save handler — same backend mutation as branding (ONE
   * brick), different patch slot.
   */
  onSaveCoordonnees: (patch: CoordonneesPatch) => Promise<void>;
  /**
   * Modes acceptés save handler — same backend mutation, different patch
   * slot. The editor's front guard guarantees « at least one mode active »
   * before the patch ever reaches the wire.
   */
  onSaveAcceptedModes: (patch: AcceptedModesPatch) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Step4BrandingForm(
  props: Step4BrandingFormProps,
): React.JSX.Element {
  const {
    branding,
    coordonnees,
    acceptedModes,
    onSaveBranding,
    onUploadLogo,
    onSaveCoordonnees,
    onSaveAcceptedModes,
    onPrev,
    onNext,
  } = props;

  return (
    <div
      className="flex flex-col gap-6 px-4 py-2 lg:px-6"
      data-slot="wizard-step4-form"
    >
      {/* Section 1 — Identité visuelle (logo + couleur). The editor stamps
          `data-slot="parametres-branding-form"` on its root, frozen by #229. */}
      <section className="flex flex-col gap-2">
        <header className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">Identité visuelle</h2>
          <p className="text-muted-foreground text-xs">
            Logo et couleur primaire de la marque.
          </p>
        </header>
        <BrandingEditor
          value={branding ?? {}}
          onSave={onSaveBranding}
          onUploadLogo={onUploadLogo}
        />
      </section>

      <Separator />

      {/* Section 2 — Coordonnées (adresse + téléphone). The editor stamps
          `data-slot="parametres-coordonnees-form"`, frozen by #231. */}
      <section className="flex flex-col gap-2">
        <header className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">Coordonnées</h2>
          <p className="text-muted-foreground text-xs">
            Adresse et téléphone du restaurant.
          </p>
        </header>
        <CoordonneesEditor
          value={coordonnees ?? {}}
          onSave={onSaveCoordonnees}
        />
      </section>

      <Separator />

      {/* Section 3 — Modes acceptés (delivery + click & collect). The editor
          stamps `data-slot="parametres-modes-form"`, frozen by #234. */}
      <section className="flex flex-col gap-2">
        <header className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">Modes acceptés</h2>
          <p className="text-muted-foreground text-xs">
            Activez la livraison et / ou le click &amp; collect (au moins un
            mode doit rester actif).
          </p>
        </header>
        <ModesEditor value={acceptedModes ?? {}} onSave={onSaveAcceptedModes} />
      </section>

      <Separator />

      {/* Wizard nav strip. Step 4 is non-blocking (issue spec) — the operator
          can advance to step 5 even before saving every section, and revisit
          step 4 later. The completion gate « primaryColor + logo posés »
          lives in `computeWizardState`'s `isBrandingComplete`. */}
      <div
        className="flex items-center justify-between gap-2"
        data-slot="wizard-step4-nav"
      >
        <Button
          type="button"
          variant="outline"
          onClick={onPrev}
          data-slot="wizard-step4-prev"
        >
          Précédent
        </Button>
        <Button type="button" onClick={onNext} data-slot="wizard-step4-next">
          Suivant
        </Button>
      </div>
    </div>
  );
}
