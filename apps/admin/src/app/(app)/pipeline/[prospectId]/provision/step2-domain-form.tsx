"use client";

/**
 * F-WIZARD [4/10] (#268) — `Step2DomainForm`, the real Step 2 form that
 * replaces the placeholder shipped by slice [1/10] (#265).
 *
 * Step 2 of the provisioning wizard = « domaine personnalisé optionnel »
 * (modèle Owner.com). The resto choisit soit un domaine custom, soit reste
 * sur le sous-domaine bootstrap `<slug>.kitchen-boost.fr`.
 *
 * Surface (issue #268) :
 *   - Input `customDomain` (string optionnel, ex: `commander.le-petit-bistrot.fr`).
 *   - Affichage du sous-domaine bootstrap par défaut (`<slug>.kitchen-boost.fr`)
 *     en read-only à côté pour rappel.
 *   - Bouton « Enregistrer et continuer » → appelle `tenant.updateSettings({
 *     patch: { customDomain }})` côté wrapper.
 *   - Bouton « Skip » → navigue vers step 3 sans mutation (et marque le step
 *     comme complete localement via `onSkip`).
 *   - Validation client-side identique au backend : regex
 *     `^[a-z0-9.-]+\.[a-z]{2,}$` — bouton submit désactivé si rempli mais
 *     invalide.
 *   - Re-visite : pré-remplit la valeur actuellement persistée, re-submit =
 *     update simple.
 *   - Erreur backend (ex. INVALID_CUSTOM_DOMAIN) : message inline sous le
 *     form, pas de navigation.
 *
 * Validation single-source : la regex est ré-exportée depuis le backend via
 * `isValidCustomDomain` (lib/admin/tenantSettingsValidation.ts). Le front
 * importe directement la helper — un drift FE/BE devient impossible
 * structurellement (le backend re-valide quoi qu'il arrive ; le front
 * partage simplement la même fonction pure).
 *
 * Pas de hooks Convex ici : la mutation `tenant.updateSettings` + le read
 * tenant (`loadTenantForStripe`) vivent dans le wrapper `Step2Form` de
 * `step-forms.tsx`. Cela permet de pinner toute la matrice de tests sous le
 * lean `node` vitest env, mirror des autres formulaires steps.
 */
import { useMemo, useState } from "react";

import { isValidCustomDomain } from "@packages/backend/convex/lib/admin/tenantSettingsValidation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { StepFormProps } from "./step-forms";

/**
 * Payload fired to the parent on submit (mirror of the backend mutation
 * signature, scoped to step 2's slice of the settings patch). The parent
 * (`Step2Form` wrapper) maps it to `tenant.updateSettings({ tenantId, patch:
 * { customDomain }})`.
 */
export type Step2DomainPayload = {
  customDomain: string;
};

export type Step2DomainFormProps = StepFormProps & {
  /**
   * Currently-persisted custom domain on the tenant doc (when re-visiting
   * the step after a save). `undefined` when the field was never set
   * (fresh wizard or operator explicitly skipped).
   */
  initialCustomDomain: string | undefined;
  /**
   * The bootstrap sub-domain rendered read-only for info next to the input.
   * Computed by the parent as `<tenant.slug>.kitchen-boost.fr`.
   */
  bootstrapHost: string;
  /**
   * Submit handler. The parent wires `api.lib.admin.tenantSettings
   * .updateSettings` and either resolves (navigates to step 3 via the
   * StepFormProps `onNext` chain) or surfaces an error via `submitError`.
   */
  onSave: (payload: Step2DomainPayload) => Promise<void> | void;
  /**
   * Skip handler. Marks step 2 as locally-complete via the wizard hook's
   * `markStep2Skipped` setter and navigates to step 3. NO mutation fires.
   */
  onSkip: () => void;
  /**
   * Re-disables the submit button while the round-trip is in flight.
   */
  isSubmitting: boolean;
  /**
   * Backend error message (e.g. « INVALID_CUSTOM_DOMAIN ») surfaced inline.
   * The parent flips it back to `null` on the next call.
   */
  submitError: string | null;
};

export function Step2DomainForm(
  props: Step2DomainFormProps,
): React.JSX.Element {
  const {
    initialCustomDomain,
    bootstrapHost,
    onSave,
    onSkip,
    isSubmitting,
    submitError,
  } = props;

  // -- Local form state ----------------------------------------------------
  // Controlled input seeded from the persisted value. Empty string fallback
  // so the controlled input never renders `undefined` (React would coerce
  // it to the literal string « undefined » in the DOM).
  const [customDomain, setCustomDomain] = useState<string>(
    initialCustomDomain ?? "",
  );

  // -- Derived: client-side validity ---------------------------------------
  // The trimmed value is what we'd send to the backend (the mutation
  // re-trims defensively). Empty input is treated as VALID for the
  // disabled-gate so the operator can resubmit an empty value to clear a
  // previously-saved domain — the parent decides whether to fire the
  // mutation or skip the round-trip. The regex check fires ONLY on filled
  // input.
  const trimmed = customDomain.trim();
  const isFilled = trimmed.length > 0;
  const isShapeValid = useMemo(
    () => !isFilled || isValidCustomDomain(trimmed),
    [isFilled, trimmed],
  );

  const canSubmit = isShapeValid && !isSubmitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSave({ customDomain: trimmed });
  };

  return (
    <div
      className="flex flex-col gap-4 px-4 py-2 lg:px-6"
      data-slot="wizard-step2-form"
    >
      {/* Bootstrap sub-domain — read-only info */}
      <div
        className="rounded-lg border bg-muted/40 p-3 text-sm"
        data-slot="wizard-step2-bootstrap-info"
      >
        <p className="font-medium">Sous-domaine par défaut</p>
        <p className="text-muted-foreground mt-1 font-mono">{bootstrapHost}</p>
        <p className="text-muted-foreground mt-2 text-xs">
          Sans domaine personnalisé, la PWA cliente est servie à cette adresse.
        </p>
      </div>

      {/* customDomain input (optionnel) */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wizard-step2-custom-domain">
          Domaine personnalisé (optionnel)
        </Label>
        <Input
          id="wizard-step2-custom-domain"
          data-slot="wizard-step2-custom-domain-input"
          name="customDomain"
          value={customDomain}
          onChange={(e) => setCustomDomain(e.target.value)}
          placeholder="commander.le-petit-bistrot.fr"
          aria-invalid={isFilled && !isShapeValid ? true : undefined}
        />
        {isFilled && !isShapeValid ? (
          <p
            data-slot="wizard-step2-validation-hint"
            className="text-destructive text-xs"
          >
            Format de domaine invalide. Attendu : un FQDN comme «
            commander.le-petit-bistrot.fr » (minuscules, chiffres, tirets et
            points uniquement).
          </p>
        ) : null}
      </div>

      {/* Backend error surfaced inline */}
      {submitError !== null ? (
        <div
          data-slot="wizard-step2-submit-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {submitError}
        </div>
      ) : null}

      {/* Action row */}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          data-slot="wizard-step2-skip"
          onClick={onSkip}
        >
          Skip (rester sur le sous-domaine bootstrap)
        </Button>
        <Button
          type="button"
          data-slot="wizard-step2-submit"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {isSubmitting ? "Enregistrement…" : "Enregistrer et continuer"}
        </Button>
      </div>
    </div>
  );
}
