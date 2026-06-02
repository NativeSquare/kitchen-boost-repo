"use client";

/**
 * F-WIZARD [8/10] (#272) — `Step6QrForm`, the real Step 6 form.
 *
 * Step 6 — QR code SVG imprimable. 100 % front-only (PRD 70 §4.7 + parent
 * epic F-QR #142). Aucune dépendance backend : on consomme la PWA URL + le
 * slug déjà résolus par le wrapper `Step6Form` (step-forms.tsx) et on monte
 * le composant partagé `QrDownloadCard` qui orchestre la génération SVG +
 * la preview + le bouton de téléchargement.
 *
 * Historique (2026-06-02) :
 * -------------------------
 * Le composant historique `QrGeneratorView` (pipeline PDF avec 3 formats :
 * sticker rond 50 mm / carte A6 / affiche A4) a été retiré. La direction
 * artistique appartient au resto (Canva / Figma / Illustrator) — on ne livre
 * plus que le QR lui-même, au format SVG noir-sur-blanc. Cette simplification
 * était déjà en place sur la page standalone `/t/[tenantId]/qr` depuis le
 * 2026-06-01 ; elle est étendue ici (même UX, même composant partagé
 * `QrDownloadCard`).
 *
 * Pourquoi un wrapper « pur » + un wrapper Convex (Step6Form) :
 * -----------------------------------------------------------
 * Même discipline que `Step4BrandingForm` / `Step5MenuForm` : la wiring
 * Convex (lecture du prospect + du tenant doc pour récupérer slug /
 * customDomain) vit dans `step-forms.tsx`. Ce module-ci reçoit tout déjà
 * résolu via ses props — facilement testable sous le lean `node` vitest env
 * (le composant partagé `QrDownloadCard` n'est pas exécuté ; le sérialiseur
 * du test pin la prop-threading sans descendre dedans).
 *
 * Step non-bloquant (issue body verbatim) :
 * ----------------------------------------
 * « Bouton "Continuer" toujours actif (le téléchargement est facultatif au
 * wizard — peut être refait plus tard depuis la vue resto). » Pas de gate ;
 * pas de tooltip explicatif. Le wizard avance même si l'opérateur n'a pas
 * cliqué « Télécharger SVG ».
 *
 * Scope (#272 hard constraint) : `apps/admin/src/app/(app)/pipeline/
 * [prospectId]/provision/` UNIQUEMENT pour la wiring locale. On importe depuis
 * `apps/admin/src/components/qr/QrDownloadCard` (composant partagé) — même
 * pattern de réutilisation in-app que les Steps précédents avec les éditeurs
 * de Paramètres / Menu.
 */

import { QrDownloadCard } from "@/components/qr/QrDownloadCard";
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
  /**
   * Tenant slug — threaded to `QrDownloadCard` to build the stable download
   * filename `qr-<slug>.svg`. Kept explicit (rather than derived from
   * `pwaUrl`) so a custom-domain tenant still gets a slug-keyed filename.
   */
  slug: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Step6QrForm({
  pwaUrl,
  slug,
  onPrev,
  onNext,
}: Step6QrFormProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 px-4 py-2 lg:px-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">QR code</h2>
        <p className="text-muted-foreground text-sm">
          Importez ce SVG dans Canva, Figma ou Illustrator pour l&apos;intégrer
          dans votre support visuel (sticker, affiche, packaging&hellip;).
        </p>
      </div>

      {/*
       * Shared `QrDownloadCard` (#198 + #272 simplification 2026-06-02) —
       * SAME component as the standalone `/t/[tenantId]/qr` page. Owns the
       * async SVG build, the preview, the URL display, and the download
       * anchor. ZERO duplication of the QR logic.
       */}
      <QrDownloadCard pwaUrl={pwaUrl} slug={slug} />

      <Separator />

      {/*
       * Wizard nav strip. « Continuer » is ALWAYS active — step 6 is
       * non-bloquant by issue spec (« le téléchargement est facultatif au
       * wizard — peut être refait plus tard depuis la vue resto »). The
       * operator can advance to step 7 (Tablette) without ever clicking
       * « Télécharger SVG ».
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
