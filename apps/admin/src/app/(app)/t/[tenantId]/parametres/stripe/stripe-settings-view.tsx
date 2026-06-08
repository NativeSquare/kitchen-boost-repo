"use client";

/**
 * `StripeSettingsView` — pure presentational view for the « Stripe Connect
 * a posteriori » page at `/t/[tenantId]/parametres/stripe`. Surface the
 * tenant's current Stripe Connect Express state + a CTA to (re)generate a
 * fresh KYC `account_link`.
 *
 * Why this exists
 * ---------------
 * Today the Stripe onboarding action (`api.lib.stripe.account
 * .createStripeAccountLink`) is exposed ONLY in the new-tenant provisioning
 * wizard at `(app)/pipeline/[prospectId]/provision/step3-stripe-kyc-form.tsx`.
 * There is NO way to launch / re-launch the Stripe onboarding for a tenant
 * that was created outside the wizard (seeded test tenants, legacy tenants,
 * or tenants whose KYC needs to be redone).
 *
 * This view fills that gap from the tenant-scoped Paramètres area. It
 * mirrors `Step3StripeKycForm`'s discipline — purely presentational, every
 * side-effect threaded via props (`onGenerate`, `onCopy`) — but ADDS the
 * status card branches (no account / pending / ready / disabled) that the
 * wizard does not surface (the wizard happens BEFORE the account exists, so
 * it never renders « ready »).
 *
 * Status mapping (PRD 30 §2 — `stripeAccountStatus`):
 *   - `stripeAccountId === undefined`   → « Non configuré »
 *   - `stripeStatus === "pending"`      → « En attente de KYC »
 *   - `stripeStatus === "ready"`        → « Prêt à recevoir les paiements »
 *                                          (green badge — Stripe
 *                                          `charges_enabled && payouts_enabled`)
 *   - `stripeStatus === "disabled"`     → « Refusé / Désactivé » (KYC
 *                                          `rejected` / blocking requirement)
 *
 * Testability — pure component (zero hooks Convex, zero `navigator
 * .clipboard`, zero `toast`). Pinned by `stripe-settings-view.test.tsx`
 * under the lean `node` vitest env using the same React-tree serializer
 * pattern as the wizard view + `step3-stripe-kyc-form`.
 *
 * Scope discipline (apps/admin ONLY for this story): zero coupling to the
 * backend api / Convex hooks / tenant context — the page is responsible
 * for wiring those (read of the tenant's Stripe state via the new
 * `api.lib.admin.tenantSettings.getStripeState` query + action call via
 * `useAction(api.lib.stripe.account.createStripeAccountLink)`).
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Mirror of the backend `stripeAccountStatus` validator (`packages/backend
 * /convex/table/tenants.ts`). Re-declared as a TS union here so the view
 * stays decoupled from the backend codegen (it's a pure presentation
 * component — `apps/admin` may render this in isolation under test).
 */
export type StripeStatus = "pending" | "ready" | "disabled";

export type StripeSettingsViewProps = {
  /** Tenant name for the page header. */
  tenantName: string;
  /**
   * The Stripe Connect Express account id (`acct_xxx`) stamped on the
   * tenant once the action has been fired at least once. `undefined`
   * means no account has been created yet — the view renders the
   * « Non configuré » status and the « Générer » CTA.
   */
  stripeAccountId: string | undefined;
  /**
   * Stripe onboarding/KYC status (PRD 30 §2). `undefined` when the
   * tenant has no Stripe account yet. The status flips to `ready`
   * automatically via the `account.updated` webhook — the page should
   * subscribe to the underlying query so the status card updates live.
   */
  stripeStatus: StripeStatus | undefined;
  /**
   * The freshly-generated `account_link` URL returned by
   * `createStripeAccountLink`. `null` until the operator clicks
   * « Générer » (or « Régénérer ») and the action resolves. The view
   * renders it read-only with a Copy button so the operator can send
   * the URL to the resto manager OR open it themselves.
   */
  accountLink: string | null;
  /**
   * Disables the « Générer » / « Régénérer » button while the action
   * is in flight (avoids double-firing the Stripe call).
   */
  isGenerating: boolean;
  /**
   * Backend error message (e.g. « Stripe API error: account disabled »
   * — or « FORBIDDEN » if the caller is a kb_manager: the existing
   * action is root-only, so a manager hitting Générer will see the
   * raw Convex error inline; admin support can step in via tenant
   * switcher). Surfaced inline; cleared by the parent on the next
   * `onGenerate` attempt.
   */
  genError: string | null;
  /**
   * Handler fired when the operator clicks « Générer » or « Régénérer ».
   * The parent wires `useAction(api.lib.stripe.account
   * .createStripeAccountLink)` + sets `accountLink` on success or
   * `genError` on failure.
   */
  onGenerate: () => void;
  /**
   * Copy-to-clipboard handler. The parent calls
   * `navigator.clipboard.writeText(url)` + `toast.success("Lien copié")`.
   * Threaded as a prop so the view stays purely presentational.
   */
  onCopy: (url: string) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StatusCopy = {
  label: string;
  description: string;
  variant: "default" | "secondary" | "destructive" | "outline";
  /** Whether to render the green « ready » badge slot (`badge-ready`). */
  isReady: boolean;
};

function statusCopy(
  stripeAccountId: string | undefined,
  stripeStatus: StripeStatus | undefined,
): StatusCopy {
  if (stripeAccountId === undefined) {
    return {
      label: "Stripe Connect : Non configuré",
      description:
        "Aucun compte Stripe Connect n'a été créé pour ce restaurant. Génère un lien KYC pour démarrer l'onboarding.",
      variant: "outline",
      isReady: false,
    };
  }
  switch (stripeStatus) {
    case "ready":
      return {
        label: "Stripe Connect : Prêt à recevoir les paiements",
        description:
          "Le KYC est validé. Le restaurant peut encaisser via Stripe Connect (charges + payouts activés).",
        variant: "default",
        isReady: true,
      };
    case "disabled":
      return {
        label: "Stripe Connect : Refusé / Désactivé",
        description:
          "Le compte Stripe est désactivé (KYC refusé ou exigence bloquante). Régénère un lien KYC pour relancer la procédure.",
        variant: "destructive",
        isReady: false,
      };
    case "pending":
    default:
      return {
        label: "Stripe Connect : En attente de KYC",
        description:
          "Le compte Stripe est créé mais le KYC n'est pas terminé. Transmets le lien au gérant ou ouvre-le toi-même pour compléter l'onboarding.",
        variant: "secondary",
        isReady: false,
      };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function StripeSettingsView(
  props: StripeSettingsViewProps,
): React.JSX.Element {
  const {
    tenantName,
    stripeAccountId,
    stripeStatus,
    accountLink,
    isGenerating,
    genError,
    onGenerate,
    onCopy,
  } = props;

  const status = statusCopy(stripeAccountId, stripeStatus);
  const hasAccount = stripeAccountId !== undefined;
  const hasUrl = accountLink !== null;

  return (
    <div
      className="flex flex-col gap-4 px-4 py-4 lg:px-6"
      data-slot="stripe-settings-view"
    >
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Stripe Connect — {tenantName}
        </h1>
        <p className="text-sm text-muted-foreground">
          Génère ou régénère le lien KYC Stripe Connect Express pour ce
          restaurant. Transmets-le au gérant ou ouvre-le pour compléter
          l&apos;onboarding (les paiements sont possibles une fois le KYC
          validé).
        </p>
      </div>

      {/* Status card */}
      <Card data-slot="stripe-settings-status">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>{status.label}</span>
            {status.isReady ? (
              <Badge
                variant="default"
                data-slot="stripe-settings-badge-ready"
                className="bg-emerald-600 text-white"
              >
                KYC validé
              </Badge>
            ) : null}
          </CardTitle>
          <CardDescription>{status.description}</CardDescription>
        </CardHeader>
        {hasAccount ? (
          <CardContent className="flex flex-col gap-1.5">
            <Label
              htmlFor="stripe-settings-account-id"
              className="text-xs uppercase tracking-wide text-muted-foreground"
            >
              Compte Stripe
            </Label>
            <Input
              id="stripe-settings-account-id"
              data-slot="stripe-settings-account-id"
              value={stripeAccountId}
              readOnly
              className="font-mono"
            />
          </CardContent>
        ) : null}
      </Card>

      {/* Generate / Regenerate CTA */}
      {hasAccount ? (
        <div className="flex items-center justify-start">
          <Button
            type="button"
            variant="outline"
            data-slot="stripe-settings-regenerate"
            onClick={onGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? "Génération…" : "Régénérer un lien Stripe Connect"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center justify-start">
          <Button
            type="button"
            data-slot="stripe-settings-generate"
            onClick={onGenerate}
            disabled={isGenerating}
          >
            {isGenerating ? "Génération…" : "Générer un lien Stripe Connect"}
          </Button>
        </div>
      )}

      {/* URL display + copy button (only once we have a URL) */}
      {hasUrl ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="stripe-settings-url">Lien KYC Stripe</Label>
          <div className="flex items-stretch gap-2">
            <Input
              id="stripe-settings-url"
              data-slot="stripe-settings-url-input"
              name="stripeAccountLink"
              value={accountLink}
              readOnly
              className="flex-1"
            />
            <Button
              type="button"
              variant="secondary"
              data-slot="stripe-settings-copy"
              onClick={() => onCopy(accountLink)}
            >
              Copier
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Transmets ce lien au gérant — il doit compléter son KYC Stripe pour
            pouvoir recevoir les paiements. Tu peux aussi l&apos;ouvrir toi-même
            en mode test (Stripe Connect Express).
          </p>
        </div>
      ) : null}

      {/* Inline backend error */}
      {genError !== null ? (
        <div
          data-slot="stripe-settings-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {genError}
        </div>
      ) : null}
    </div>
  );
}
