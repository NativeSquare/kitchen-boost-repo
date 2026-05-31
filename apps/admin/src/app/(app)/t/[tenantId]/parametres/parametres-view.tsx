/**
 * F-PARAMETRES-01 (#193) — `ParametresView`, pure presentational shell of the
 * tenant Paramètres page (skeleton + 4 empty sections + Uber Direct read-only
 * block, first tracer-bullet of EPIC F-PARAMETRES #148).
 *
 * Slice 1 (this issue) ships ONLY the read + the layout (issue body « no
 * mutation à ce stade — seulement la lecture + le layout »). The per-section
 * editors (logo upload, color picker, address/phone form, accepted-modes
 * toggles, service-hours grid) land in F-PARAMETRES-02..05; this view stays
 * deliberately dumb and renders « À implémenter » in every section body so the
 * navigation surface is in place from day one without misleading the gérant
 * into believing the editors are wired.
 *
 * Sections, in the canonical order from EPIC #148 « Implementation Decisions »:
 *   1. Identité visuelle  — logo + couleur primaire (F-PARAMETRES-02).
 *   2. Coordonnées        — adresse + téléphone        (F-PARAMETRES-03).
 *   3. Modes acceptés     — delivery / click & collect (F-PARAMETRES-04).
 *   4. Horaires de service — grille hebdo 7j × N créneaux (F-PARAMETRES-05).
 *
 * Plus the « Zone livraison Uber Direct » READ-ONLY informational block (user
 * story 12 from EPIC #148, ADR — V1 = lecture seule; édition V2). The block
 * carries a stable `data-slot="parametres-uber-direct-readonly"` marker so
 * future surfaces (and tests) can target it without scraping copy.
 *
 * Split out of `page.tsx` (which owns `useTenantQuery`) so vitest can pin
 * every branch under `environment: "node"` — same React-tree-serializer
 * pattern as `menu-view.tsx` / `mes-clients-view.tsx`. The page hands
 * `serviceHours` in as a prop (Convex's loading sentinel = `undefined`); the
 * view is a pure function of its props.
 *
 * Scope discipline (#193 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/parametres/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import type { ServiceHours } from "@packages/backend/convex/lib/menu/serviceHours";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

import {
  BrandingEditor,
  type BrandingPatch,
  type BrandingValue,
} from "./branding-editor";

export type ParametresViewProps = {
  /**
   * Service hours from `useTenantQuery(api.lib.menu.serviceHours.get)`.
   *   - `undefined` → query in flight (Convex's loading sentinel).
   *   - else        → the tenant's persisted windows (possibly empty `[]`).
   *
   * Slice 1 reads but does NOT render the windows — the editor is the
   * deliverable of F-PARAMETRES-05. The prop is wired today so a future
   * agent doesn't have to revisit the page contract once the editor lands.
   */
  serviceHours: ServiceHours | undefined;
  /**
   * F-PARAMETRES-02 (#229) — Identité visuelle section.
   *
   * `branding`: the current persisted branding (logo URL + primary color).
   *   - `undefined` is treated as « no branding set yet » (empty object).
   *     Today this is the only branch a KB Manager sees, because no
   *     manager-accessible read query for `branding` exists yet (a
   *     follow-up slice will expose one). The editor handles it gracefully.
   *   - For a KB Admin the page resolves this from the existing root
   *     `loadTenantForStripe` (a `kbAdminQuery` already reused by
   *     `qr/page.tsx` for branding).
   * `onSaveBranding`: page-wired handler for the « Enregistrer » button.
   *   Page wires it to `useTenantMutation(api.lib.admin.tenantSettings.updateSettings)`.
   * `onUploadLogo`: page-wired handler for the file picker upload step.
   *   Page wires it to a two-step Convex upload
   *   (`useTenantMutation(api.lib.menu.photos.generateUploadUrl)` →
   *   POST → resolve the public URL via `api.storage.getImageUrl`).
   */
  branding: BrandingValue | undefined;
  onSaveBranding: (patch: BrandingPatch) => Promise<void>;
  onUploadLogo: (file: File) => Promise<string>;
};

export function ParametresView({
  branding,
  onSaveBranding,
  onUploadLogo,
}: ParametresViewProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <ParametresHeader />
      <div className="flex flex-col gap-4 px-4 md:gap-6 lg:px-6">
        <SectionIdentiteVisuelle
          value={branding ?? {}}
          onSave={onSaveBranding}
          onUploadLogo={onUploadLogo}
        />
        <SectionCoordonnees />
        <SectionModesAcceptes />
        <SectionHorairesService />
        <Separator className="my-2" />
        <UberDirectReadOnlyBlock />
      </div>
    </div>
  );
}

function ParametresHeader() {
  return (
    <div className="flex flex-col gap-2 px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Paramètres</h1>
      </div>
    </div>
  );
}

/**
 * Internal section primitive — keeps the 4 section cards visually consistent
 * AND makes the "this is a slice-1 placeholder" intent obvious. The
 * `data-slot` marker is the stable handle for tests and downstream surfaces;
 * the copy stays free to polish in subsequent slices.
 */
function SectionPlaceholder({
  slot,
  title,
  description,
}: {
  slot: string;
  title: string;
  description: string;
}) {
  return (
    <Card data-slot={slot}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-muted-foreground text-sm">À implémenter</p>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * F-PARAMETRES-02 (#229) — wired Identité visuelle section. Wraps the
 * extracted, reusable `BrandingEditor` (signature `{ value, onSave,
 * onUploadLogo }`) inside the canonical Section card so the visual
 * rhythm with the still-unwired sections (Coordonnées / Modes / Horaires)
 * stays consistent. The card's `data-slot` is preserved from slice 1
 * (#193) so consumers and tests that target the section by slot don't
 * need to know whether it's a placeholder or a live editor.
 */
function SectionIdentiteVisuelle({
  value,
  onSave,
  onUploadLogo,
}: {
  value: BrandingValue;
  onSave: (patch: BrandingPatch) => Promise<void>;
  onUploadLogo: (file: File) => Promise<string>;
}) {
  return (
    <Card data-slot="parametres-section-identite">
      <CardHeader>
        <CardTitle>Identité visuelle</CardTitle>
        <CardDescription>
          Logo et couleur primaire de votre marque.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <BrandingEditor
          value={value}
          onSave={onSave}
          onUploadLogo={onUploadLogo}
        />
      </CardContent>
    </Card>
  );
}

function SectionCoordonnees() {
  return (
    <SectionPlaceholder
      slot="parametres-section-coordonnees"
      title="Coordonnées"
      description="Adresse et téléphone du restaurant."
    />
  );
}

function SectionModesAcceptes() {
  return (
    <SectionPlaceholder
      slot="parametres-section-modes"
      title="Modes acceptés"
      description="Activez la livraison et / ou le click & collect."
    />
  );
}

function SectionHorairesService() {
  return (
    <SectionPlaceholder
      slot="parametres-section-horaires"
      title="Horaires de service"
      description="Grille hebdomadaire des créneaux d'ouverture."
    />
  );
}

/**
 * Read-only « Zone livraison Uber Direct » block (user story 12, EPIC #148).
 * V1 = informative; the rayon is managed by Uber Direct itself and cannot be
 * edited from the admin. The block makes the read-only intent explicit so the
 * gérant knows where to go (Uber) for changes.
 */
function UberDirectReadOnlyBlock() {
  return (
    <Card data-slot="parametres-uber-direct-readonly">
      <CardHeader>
        <CardTitle>Zone livraison Uber Direct</CardTitle>
        <CardDescription>
          Le rayon de livraison est géré directement par Uber Direct.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground text-sm">
          Géré par Uber Direct — non modifiable depuis cette page (V1).
        </p>
      </CardContent>
    </Card>
  );
}
