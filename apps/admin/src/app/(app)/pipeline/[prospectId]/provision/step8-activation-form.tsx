"use client";

/**
 * F-WIZARD [10/10] (#274) — `Step8ActivationForm`, the real Step 8 form that
 * replaces the placeholder shipped by slice [1/10] (#265).
 *
 * Step 8 — mise en production du tenant (`pending → active`, B-TENANT-LIFECYCLE
 * D6, `api.lib.admin.tenantSettings.activate`). Action CRITIQUE / destructive
 * — l'opérateur doit confirmer en TAPANT le slug du tenant (pattern
 * destructive-action standard, cf. PRD 70 §Edge cases).
 *
 * Surface (issue body verbatim) :
 *   - Écran récapitulatif avec 6 blocs :
 *       1. Compte resto : nom, slug, adresse, téléphone, email gérant.
 *       2. Domaine : custom domain ou sous-domaine bootstrap.
 *       3. Stripe : lien KYC généré (oui/non) + statut courant si dispo.
 *       4. Branding : preview logo + couleur.
 *       5. Menu : nombre de catégories + items + timestamp dernière publication.
 *       6. Invitation gérant : envoyée le... / non envoyée (warning).
 *   - Bouton « Mettre en production » (gros, vert, en bas) qui OUVRE le
 *     dialog de confirmation (pas l'activation directe — 2-step UX).
 *   - Dialog « Confirmer la mise en production » :
 *       - récap des infos clés (nom + slug + URL PWA finale).
 *       - input texte demandant de TAPER le slug pour confirmer.
 *       - bouton « Activer définitivement » DISABLED tant que typed !== slug.
 *       - clic → appel `onActivate()` (wired to `tenant.activate` côté
 *         wrapper).
 *   - Warning bloquant si `menuPublished === false` : message clair +
 *     « Mettre en production » désactivé + CTA « Retour step 5 » vers le menu.
 *
 * Pourquoi un wrapper « pur » + un wrapper Convex (Step8Form) :
 * -----------------------------------------------------------
 * Mirror of `Step{1,3,4,5,6,7}Form` : la wiring Convex (lecture prospect +
 * tenant + publishedMenu + managerInvite pour le récap + mutation
 * `tenant.activate` + toast + navigation post-succès) vit dans `step-forms.tsx`.
 * Ce module-ci reçoit tout déjà résolu via ses props — facilement testable
 * sous le lean `node` vitest env (même React-tree serializer que les sibling
 * forms).
 *
 * Scope (#274 hard constraint) : `apps/admin/src/app/(app)/pipeline/
 * [prospectId]/provision/` UNIQUEMENT.
 */

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import type { StepFormProps } from "./step-forms";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Step8Recap = {
  compteResto: {
    name: string;
    slug: string;
    address: string | undefined;
    phone: string | undefined;
    emailManager: string | undefined;
  };
  domaine: {
    /** When set, the customer-facing domain (Owner.com model). */
    customDomain: string | undefined;
    /** The bootstrap sub-domain `<slug>.kitchen-boost.com` (always present). */
    bootstrapHost: string;
  };
  stripe: {
    /**
     * `true` once `createStripeAccountLink` has been called at least once.
     * Surfaced as « Lien KYC généré : oui/non ». The wrapper derives this
     * heuristically from the tenant's `stripeAccountId`.
     */
    accountLinkGenerated: boolean;
    /**
     * The tenant's Stripe Connect Express status when known. `undefined` =
     * never reported by Stripe yet. Mirror of `tenants.stripeStatus`.
     */
    status: "pending" | "ready" | "disabled" | undefined;
  };
  branding: {
    logoUrl: string | undefined;
    primaryColor: string | undefined;
  };
  menu: {
    categoriesCount: number;
    itemsCount: number;
    /**
     * The last publication timestamp (ms). `null` when the menu has never
     * been published — the wrapper also flips `menuPublished` to `false` in
     * that case, which disables the activation CTA.
     */
    lastPublishedAt: number | null;
  };
  invitation: {
    /** When the manager invite was last sent (`_creationTime`). */
    sentAt: number | null;
    /** The email the invite was sent to (or would be sent to). */
    email: string | undefined;
  };
};

export type Step8ActivationFormProps = Omit<StepFormProps, "onNext"> & {
  /**
   * The tenant slug — the operator must type it inside the confirmation
   * dialog to enable the « Activer définitivement » button.
   */
  slug: string;
  /**
   * The final PWA URL the customer will hit (`https://<customDomain>` or
   * `https://<slug>.kitchen-boost.com`). Surfaced in the confirmation dialog
   * as the canonical « URL PWA finale » cue.
   */
  pwaUrl: string;
  /** The 6 récap blocks data (resolved by the wrapper). */
  recap: Step8Recap;
  /**
   * Hard gate: when `false`, the « Mettre en production » CTA is disabled
   * and a warning is rendered with a « Retour step 5 » CTA. Derived from
   * `recap.menu.lastPublishedAt !== null` by the wrapper.
   */
  menuPublished: boolean;
  /**
   * Call `tenant.activate({ tenantId })`. Owned by the wrapper. Throws on
   * backend error; the wrapper catches + surfaces via `activateError` +
   * toast.
   */
  onActivate: () => Promise<void>;
  /** True while `tenant.activate` is in flight (disables the confirm CTA). */
  isActivating: boolean;
  /**
   * Backend error message (e.g. `INVALID_STATE` for an already-active tenant),
   * surfaced inline below the « Mettre en production » CTA. The wrapper also
   * fires a toast.
   */
  activateError: string | null;
  /**
   * Navigation back to step 5 (menu) — used by the « Retour step 5 » CTA
   * when `menuPublished === false`.
   */
  onBackToMenuStep: () => void;
  /**
   * TEST-ONLY override: lets the test suite drive the slug-typing gate via
   * a public prop (the form's internal `useState` is unobservable under the
   * lean React hooks shim). When `undefined` (production), the form uses
   * its internal state. When set, it overrides the local input value AND
   * the gating predicate.
   */
  confirmTypedSlug?: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a ms-epoch as `DD/MM/YYYY à HH:MM` in fr-FR locale (mirror of the
 * sibling Step7 form's `formatSentAt`).
 */
function formatTimestamp(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts);
  const date = d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} à ${time}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Step8ActivationForm({
  slug,
  pwaUrl,
  recap,
  menuPublished,
  onActivate,
  isActivating,
  activateError,
  onPrev,
  onBackToMenuStep,
  confirmTypedSlug,
}: Step8ActivationFormProps): React.JSX.Element {
  // Dialog open state — local to the form. Clicking « Mettre en production »
  // opens it; the dialog's « Annuler » or confirm path close it.
  const [dialogOpen, setDialogOpen] = useState<boolean>(false);
  // Slug-typing local state — empty by default; the operator types to match
  // `slug` to unlock the « Activer définitivement » CTA. The TEST-ONLY
  // `confirmTypedSlug` prop overrides this so the suite can pin the gate.
  const [typedSlug, setTypedSlug] = useState<string>("");
  const effectiveTyped = confirmTypedSlug ?? typedSlug;
  const slugMatches = effectiveTyped === slug && slug.length > 0;

  const handleOpenDialog = () => {
    if (!menuPublished) return;
    setDialogOpen(true);
  };

  const handleConfirmActivate = async () => {
    if (isActivating || !slugMatches) return;
    await onActivate();
    // The wrapper handles success-side navigation; we keep the dialog open
    // on error so the operator sees the inline error message AND the toast
    // (closing on success is harmless — the wrapper navigates away anyway).
  };

  return (
    <div
      className="flex flex-col gap-4 px-4 py-2 lg:px-6"
      data-slot="wizard-step8-form"
    >
      <p className="text-muted-foreground text-sm">
        Vérifiez les informations avant la mise en production. L&apos;activation
        rend le restaurant visible côté client.
      </p>

      {/* --- Récap blocks ------------------------------------------------- */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* 1. Compte resto */}
        <Card data-slot="wizard-step8-recap-resto">
          <CardHeader>
            <CardTitle>Compte resto</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>
              <span className="text-muted-foreground">Nom :</span>{" "}
              {recap.compteResto.name}
            </p>
            <p>
              <span className="text-muted-foreground">Slug :</span>{" "}
              <code className="text-xs">{recap.compteResto.slug}</code>
            </p>
            <p>
              <span className="text-muted-foreground">Adresse :</span>{" "}
              {recap.compteResto.address ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Téléphone :</span>{" "}
              {recap.compteResto.phone ?? "—"}
            </p>
            <p>
              <span className="text-muted-foreground">Email gérant :</span>{" "}
              {recap.compteResto.emailManager ?? "—"}
            </p>
          </CardContent>
        </Card>

        {/* 2. Domaine */}
        <Card data-slot="wizard-step8-recap-domaine">
          <CardHeader>
            <CardTitle>Domaine</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {recap.domaine.customDomain !== undefined ? (
              <p>
                <span className="text-muted-foreground">Custom :</span>{" "}
                <code className="text-xs">{recap.domaine.customDomain}</code>
              </p>
            ) : null}
            <p>
              <span className="text-muted-foreground">Bootstrap :</span>{" "}
              <code className="text-xs">{recap.domaine.bootstrapHost}</code>
            </p>
          </CardContent>
        </Card>

        {/* 3. Stripe */}
        <Card data-slot="wizard-step8-recap-stripe">
          <CardHeader>
            <CardTitle>Stripe KYC</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>
              <span className="text-muted-foreground">Lien KYC généré :</span>{" "}
              {recap.stripe.accountLinkGenerated ? "Oui" : "Non"}
            </p>
            <p>
              <span className="text-muted-foreground">Statut :</span>{" "}
              {recap.stripe.status ?? "non renseigné"}
            </p>
          </CardContent>
        </Card>

        {/* 4. Branding */}
        <Card data-slot="wizard-step8-recap-branding">
          <CardHeader>
            <CardTitle>Branding</CardTitle>
          </CardHeader>
          <CardContent className="flex items-start gap-3 text-sm">
            {recap.branding.logoUrl !== undefined ? (
              // The preview is presentational only; we use a plain <img/>
              // (the wizard route is admin-only / chrome-less, no need for
              // next/image's optimisation here).
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={recap.branding.logoUrl}
                alt="Logo restaurant"
                className="h-12 w-12 rounded border object-contain"
                data-slot="wizard-step8-recap-branding-logo"
              />
            ) : (
              <div className="text-muted-foreground text-xs">
                Pas de logo téléversé.
              </div>
            )}
            <div className="flex flex-col gap-1">
              <p>
                <span className="text-muted-foreground">Couleur :</span>{" "}
                {recap.branding.primaryColor !== undefined ? (
                  <span className="inline-flex items-center gap-1">
                    <span
                      className="inline-block h-3 w-3 rounded-sm border align-middle"
                      style={{ backgroundColor: recap.branding.primaryColor }}
                      aria-hidden
                    />
                    <code className="text-xs">
                      {recap.branding.primaryColor}
                    </code>
                  </span>
                ) : (
                  "—"
                )}
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 5. Menu */}
        <Card data-slot="wizard-step8-recap-menu">
          <CardHeader>
            <CardTitle>Menu</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            <p>{recap.menu.categoriesCount} catégories</p>
            <p>{recap.menu.itemsCount} items</p>
            <p>
              <span className="text-muted-foreground">
                Dernière publication :
              </span>{" "}
              {recap.menu.lastPublishedAt !== null
                ? formatTimestamp(recap.menu.lastPublishedAt)
                : "jamais publié"}
            </p>
          </CardContent>
        </Card>

        {/* 6. Invitation gérant */}
        <Card data-slot="wizard-step8-recap-invitation">
          <CardHeader>
            <CardTitle>Invitation gérant</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1 text-sm">
            {recap.invitation.sentAt !== null ? (
              <p>
                <span className="text-muted-foreground">Envoyée le :</span>{" "}
                {formatTimestamp(recap.invitation.sentAt)}
              </p>
            ) : (
              <p
                className="text-amber-700 dark:text-amber-300"
                data-slot="wizard-step8-invitation-warning"
                role="note"
              >
                Aucune invitation gérant n&apos;a été envoyée — non envoyée.
              </p>
            )}
            <p>
              <span className="text-muted-foreground">Email :</span>{" "}
              {recap.invitation.email ?? "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* --- Menu-non-publié warning + activation CTA --------------------- */}
      {!menuPublished ? (
        <div
          className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
          data-slot="wizard-step8-menu-not-published-warning"
          role="alert"
        >
          <p className="font-medium">Menu non publié.</p>
          <p className="mt-1">
            Vous ne pouvez pas mettre le restaurant en production sans publier
            au moins une fois le menu. Retournez au step 5 pour publier le menu,
            puis revenez ici.
          </p>
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={onBackToMenuStep}
              data-slot="wizard-step8-back-to-menu-button"
            >
              Retour step 5 — publier le menu
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-col items-center gap-2 py-2">
        <Button
          type="button"
          onClick={handleOpenDialog}
          disabled={!menuPublished}
          className="min-w-64 bg-emerald-700 text-white hover:bg-emerald-800"
          size="lg"
          data-slot="wizard-step8-mep-button"
        >
          Mettre en production
        </Button>
        {activateError !== null ? (
          <p
            className="text-sm text-destructive"
            data-slot="wizard-step8-activate-error"
            role="alert"
          >
            {activateError}
          </p>
        ) : null}
      </div>

      <Separator />

      {/* Wizard nav strip — Step 8 has NO « Suivant » (it's the terminal step;
          the activation IS the « Suivant »). */}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onPrev}>
          Précédent
        </Button>
        <span />
      </div>

      {/* --- Confirmation dialog ----------------------------------------- */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent data-slot="wizard-step8-confirm-dialog">
          <DialogHeader>
            <DialogTitle>Confirmer la mise en production</DialogTitle>
            <DialogDescription>
              Cette action active définitivement le tenant et le rend visible
              côté client.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-sm">
            <p>
              <span className="text-muted-foreground">Restaurant :</span>{" "}
              <strong>{recap.compteResto.name}</strong>
            </p>
            <p>
              <span className="text-muted-foreground">Slug :</span>{" "}
              <code className="text-xs">{slug}</code>
            </p>
            <p>
              <span className="text-muted-foreground">URL PWA finale :</span>{" "}
              <code className="text-xs">{pwaUrl}</code>
            </p>

            <Badge variant="secondary" className="self-start">
              Action irréversible en V1.
            </Badge>

            <div className="flex flex-col gap-2 pt-2">
              <Label htmlFor="wizard-step8-confirm-slug-input">
                Pour confirmer, tapez le slug du tenant :{" "}
                <code className="text-xs">{slug}</code>
              </Label>
              <Input
                id="wizard-step8-confirm-slug-input"
                name="confirmSlug"
                type="text"
                value={effectiveTyped}
                onChange={(e) => setTypedSlug(e.target.value)}
                placeholder={slug}
                autoComplete="off"
                data-slot="wizard-step8-confirm-slug-input"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isActivating}
            >
              Annuler
            </Button>
            <Button
              type="button"
              onClick={handleConfirmActivate}
              disabled={!slugMatches || isActivating}
              data-slot="wizard-step8-confirm-activate-button"
              className="bg-emerald-700 text-white hover:bg-emerald-800"
            >
              {isActivating ? "Activation en cours…" : "Activer définitivement"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
