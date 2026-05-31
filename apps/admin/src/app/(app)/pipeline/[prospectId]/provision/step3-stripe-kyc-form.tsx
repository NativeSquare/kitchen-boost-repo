"use client";

/**
 * F-WIZARD [5/10] (#269) — `Step3StripeKycForm`, the real Step 3 form that
 * replaces the placeholder shipped by slice [1/10] (#265).
 *
 * Step 3 — Stripe Connect KYC link generation. The form lets the operator
 * generate a one-shot Stripe `account_link` URL for the resto's KYC
 * onboarding (issued by `lib.stripe.account.createStripeAccountLink`,
 * chantier 2.5), display it read-only with a copy-to-clipboard affordance,
 * and re-generate it on demand (if the URL has expired or the operator
 * wants a fresh one).
 *
 * Surface (issue #269) :
 *   - Avant 1ʳᵉ génération : bouton « Générer le lien Stripe KYC ».
 *   - Sur click → appelle `onGenerate()`. Le parent wrappe
 *     `api.lib.stripe.account.createStripeAccountLink(tenantId, prefill,
 *     refresh_url, return_url)` et surface l'URL via `accountLinkUrl`.
 *   - Une fois l'URL en main : affichage read-only de l'URL + bouton
 *     « Copier » (qui appelle `onCopy(url)`, le parent gère
 *     `navigator.clipboard.writeText` + toast.success).
 *   - Bouton « Régénérer » : remplace « Générer » dès qu'une URL existe,
 *     ré-appelle `onGenerate()` (le backend reuse l'`accountId` existant et
 *     ré-émet juste un fresh `account_link`).
 *   - Erreur backend (`genError !== null`) : message inline. Le bouton
 *     « Continuer » reste actif (step non-bloquant).
 *   - Bouton « Continuer » toujours accessible : appelle `onNext`. C'est
 *     la transition « step non-bloquant » de l'issue spec — l'opérateur
 *     peut continuer le wizard sans avoir cliqué « Générer ». Le parent
 *     peut toaster un avertissement « Le lien Stripe n'a pas été généré »
 *     dans ce cas.
 *   - Message d'aide statique : « Transmets ce lien au gérant — il doit
 *     compléter son KYC Stripe pour pouvoir recevoir les paiements. Tu
 *     peux continuer le wizard sans attendre. ».
 *   - Bouton « Précédent » : navigation step 2 via `onPrev`.
 *
 * Scope (#269 hard constraint) : `apps/admin/src/app/(app)/pipeline/[prospectId]/provision/`
 * UNIQUEMENT. Aucune touche à `apps/web`, `apps/native`, ni
 * `packages/backend/convex/`. L'action `createStripeAccountLink` existe
 * déjà côté backend (chantier 2.5-A), on ne fait QUE la consommer.
 *
 * Testabilité : composant purement présentationnel (zero hooks Convex,
 * zero `navigator.clipboard`, zero `toast`). Les side-effects sont
 * threadés via props (`onGenerate`, `onCopy`, `onNext`, `onPrev`) — le
 * `Step3Form` wrapper dans `step-forms.tsx` les wire avec `useAction` +
 * `navigator.clipboard.writeText` + `sonner`. Cela permet de pinner toute
 * la matrice de tests sous le lean `node` vitest env via le même
 * React-tree serializer que les autres vues.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { StepFormProps } from "./step-forms";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Step3StripeKycFormProps = StepFormProps & {
  /**
   * Handler fired when the operator clicks « Générer » or « Régénérer ».
   * The parent wires the Convex action `api.lib.stripe.account
   * .createStripeAccountLink` and either resolves (parent stores the URL
   * in `accountLinkUrl`) or surfaces the error via `genError`.
   */
  onGenerate: () => void;
  /**
   * The freshly-generated Stripe `account_link` URL. `null` before the
   * first successful generation; a string once the action resolved. The
   * form renders it read-only with a copy-to-clipboard button.
   */
  accountLinkUrl: string | null;
  /**
   * Disables the « Générer » / « Régénérer » button while the action is
   * in flight (avoids double-firing the Stripe call).
   */
  isGenerating: boolean;
  /**
   * Backend error message (e.g. « Stripe API error: account disabled »)
   * surfaced inline. The form NEVER clears it itself — the parent flips
   * it back to `null` when it re-fires `onGenerate`.
   */
  genError: string | null;
  /**
   * Copy-to-clipboard handler. The parent calls `navigator.clipboard
   * .writeText(url)` + `toast.success("Lien copié")`. Threaded as a prop
   * so the form stays purely presentational (testable under the lean
   * `node` env).
   */
  onCopy: (url: string) => void;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Step3StripeKycForm(
  props: Step3StripeKycFormProps,
): React.JSX.Element {
  const {
    onGenerate,
    accountLinkUrl,
    isGenerating,
    genError,
    onCopy,
    onPrev,
    onNext,
  } = props;

  const hasUrl = accountLinkUrl !== null;

  return (
    <div
      className="flex flex-col gap-4 px-4 py-2 lg:px-6"
      data-slot="wizard-step3-form"
    >
      {/* Operator help message (issue spec verbatim) */}
      <div
        className="rounded-lg border bg-muted/40 p-4 text-sm"
        data-slot="wizard-step3-help"
      >
        <p>
          Transmets ce lien au gérant — il doit compléter son KYC Stripe pour
          pouvoir recevoir les paiements. Tu peux continuer le wizard sans
          attendre, le KYC pourra s&apos;achever après l&apos;activation.
        </p>
      </div>

      {/* Generate / Regenerate CTA — slot key changes so the test can
          distinguish the two states without coupling to the button label. */}
      {hasUrl ? (
        <div className="flex items-center justify-start">
          <Button
            type="button"
            variant="outline"
            data-slot="wizard-step3-regenerate"
            onClick={onGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? "Génération…" : "Régénérer le lien"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-start">
          <Button
            type="button"
            data-slot="wizard-step3-generate"
            onClick={onGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? "Génération…" : "Générer le lien Stripe KYC"}
          </Button>
        </div>
      )}

      {/* URL display + copy button (only once we have a URL) */}
      {hasUrl ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="wizard-step3-url">Lien KYC Stripe</Label>
          <div className="flex items-stretch gap-2">
            <Input
              id="wizard-step3-url"
              data-slot="wizard-step3-url-input"
              name="stripeAccountLink"
              value={accountLinkUrl}
              readOnly
              className="flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              data-slot="wizard-step3-copy"
              onClick={() => onCopy(accountLinkUrl)}
            >
              Copier
            </Button>
          </div>
        </div>
      ) : null}

      {/* Inline backend error */}
      {genError !== null ? (
        <div
          data-slot="wizard-step3-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {genError}
        </div>
      ) : null}

      {/* Navigation — « Continuer » always active (step non-bloquant) */}
      <div className="mt-2 flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          data-slot="wizard-step3-prev"
          onClick={onPrev}
        >
          Précédent
        </Button>
        <Button type="button" data-slot="wizard-step3-next" onClick={onNext}>
          Continuer
        </Button>
      </div>
    </div>
  );
}
