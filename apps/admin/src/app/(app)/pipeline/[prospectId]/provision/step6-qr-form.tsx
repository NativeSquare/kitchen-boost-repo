"use client";

/**
 * F-WIZARD [8/10] (#272) — `Step6QrForm`, the real Step 6 form that replaces
 * the placeholder shipped by slice [1/10] (#265).
 *
 * Step 6 — QR sticker PDF imprimable. 100 % front-only (PRD 70 §4.7 + parent
 * epic F-QR #142). Aucune dépendance backend : on consomme la PWA URL +
 * branding déjà résolus par le wrapper `Step6Form` (step-forms.tsx) et on
 * monte le composant partagé `QrGeneratorView` (#182) qui orchestre tout :
 * preview iframe via `URL.createObjectURL`, sélecteur de format (sticker
 * 50 mm / A6 carte / A4 affiche), bouton « Télécharger PDF », bouton
 * « Régénérer ». ZÉRO duplication de la logique PDF.
 *
 * Pourquoi un wrapper « pur » + un wrapper Convex (Step6Form) :
 * -----------------------------------------------------------
 * Même discipline que `Step4BrandingForm` / `Step5MenuForm` : la wiring
 * Convex (lecture du prospect + du tenant doc pour récupérer slug /
 * customDomain / branding) vit dans `step-forms.tsx`. Ce module-ci reçoit
 * tout déjà résolu via ses props — facilement testable sous le lean `node`
 * vitest env (pas d'execution réelle de `QrGeneratorView` qui touche
 * `URL.createObjectURL` ; le sérialiseur du test pin la prop-threading sans
 * descendre dans le composant).
 *
 * Step non-bloquant (issue body verbatim) :
 * ----------------------------------------
 * « Bouton "Continuer" toujours actif (le téléchargement est facultatif au
 * wizard — peut être refait plus tard depuis la vue resto). » Pas de gate ;
 * pas de tooltip explicatif. Le wizard avance même si l'opérateur n'a pas
 * cliqué « Télécharger PDF ».
 *
 * Scope (#272 hard constraint) : `apps/admin/src/app/(app)/pipeline/
 * [prospectId]/provision/` UNIQUEMENT. On importe depuis
 * `apps/admin/src/components/qr/QrGeneratorView` (le composant partagé livré
 * par F-QR.3 #182), même pattern de réutilisation in-app que les Steps
 * précédents avec les éditeurs de Paramètres / Menu.
 */

import { QrGeneratorView } from "@/components/qr/QrGeneratorView";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

import type { StepFormProps } from "./step-forms";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Step6QrFormProps = StepFormProps & {
  /**
   * PWA URL the QR encodes. Recomposed front-side by the wrapper via
   * `tenantPwaUrl({ slug, customDomain })` — same helper the standalone
   * `/t/[tenantId]/qr` page uses, mirror of the backend `provisionTenant`'s
   * `qr.pwaUrl` build (F-QR.1 #167). Always present here — the wrapper
   * defends against the missing-tenant case before mounting this form.
   */
  pwaUrl: string;
  /** Restaurant display name, surfaced in the PDF accroche. */
  restoName: string;
  /**
   * Optional brand logo URL (resolved storage URL). Threaded straight to
   * `QrGeneratorView` — rendered on A6 / A4 layouts, ignored on sticker.
   */
  logoUrl: string | undefined;
  /**
   * Optional brand primary colour (hex `#RRGGBB`). Threaded straight to
   * `QrGeneratorView` — used as accent on A6 / A4 layouts.
   */
  primaryColor: string | undefined;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Step6QrForm({
  pwaUrl,
  restoName,
  logoUrl,
  primaryColor,
  onPrev,
  onNext,
}: Step6QrFormProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 px-4 py-2 lg:px-6">
      {/*
       * F-QR `QrGeneratorView` (#182) — shared between this wizard step and
       * the standalone `/t/[tenantId]/qr/` page (#198). Owns ALL the PDF
       * pipeline:
       *   - QR PNG data URL via `generateQrDataUrl` (#167),
       *   - PDF Blob via `buildQrPdfBlob` (#173 post-jspdf migration),
       *   - preview iframe + download anchor via `URL.createObjectURL`,
       *   - format selector (sticker-50mm / a6-card / a4-poster),
       *   - « Régénérer » + « Télécharger PDF » buttons.
       *
       * The acceptance criteria « Selector de format si F-QR l'expose » is
       * satisfied transitively: the shared component already exposes the
       * three V1 formats; we just mount it.
       */}
      <QrGeneratorView
        pwaUrl={pwaUrl}
        restoName={restoName}
        logoUrl={logoUrl}
        primaryColor={primaryColor}
      />

      <Separator />

      {/*
       * Wizard nav strip. « Continuer » is ALWAYS active — step 6 is
       * non-bloquant by issue spec (« le téléchargement est facultatif au
       * wizard — peut être refait plus tard depuis la vue resto »). The
       * operator can advance to step 7 (Tablette) without ever clicking
       * « Télécharger PDF ».
       */}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onPrev}>
          Précédent
        </Button>
        <Button
          type="button"
          data-slot="wizard-step6-continue-button"
          onClick={onNext}
        >
          Continuer
        </Button>
      </div>
    </div>
  );
}
