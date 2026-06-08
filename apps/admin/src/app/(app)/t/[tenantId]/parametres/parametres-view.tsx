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

import Link from "next/link";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { ServiceHours } from "@packages/backend/convex/lib/menu/serviceHours";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

import {
  BrandingEditor,
  type BrandingPatch,
  type BrandingValue,
} from "./branding-editor";
import {
  CoordonneesEditor,
  type CoordonneesPatch,
  type CoordonneesValue,
} from "./coordonnees-editor";
import {
  ModesEditor,
  type AcceptedModesPatch,
  type ModesValue,
} from "./modes-editor";
import { PrinterEditor, type PrinterConfigValue } from "./printer-editor";
import { ServiceHoursEditor, type ServiceWindow } from "./service-hours-editor";

export type ParametresViewProps = {
  /**
   * The current tenant id — used to build the deep-link to the Stripe Connect
   * a posteriori sub-page (`/t/<tenantId>/parametres/stripe`, PR #477). Passed
   * in so the view stays a pure function of its props (no `useCurrentTenantId`
   * call inside).
   */
  tenantId: Id<"tenants">;
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
  /**
   * F-PARAMETRES-03 (#231) — Coordonnées section.
   *
   * `coordonnees`: the current persisted `{ address?, phone? }`.
   *   - `undefined` is treated as « no coordonnées set yet » (empty
   *     object). Today the KB Manager branch starts at this sentinel
   *     because no manager-accessible read query exists for tenant-row
   *     fields (same degradation as `branding`, see file header). A
   *     KB Admin gets the real value from `loadTenantForStripe` (already
   *     loaded for `branding`).
   *   - The editor handles `{}` gracefully (seeds empty inputs).
   * `onSaveCoordonnees`: page-wired handler for the section's
   *   « Enregistrer » button — wired to the same `useTenantMutation`
   *   binding as branding (one canonical D5 élargi mutation,
   *   `tenant.updateSettings`, ONE backend brick for all sections).
   */
  coordonnees: CoordonneesValue | undefined;
  onSaveCoordonnees: (patch: CoordonneesPatch) => Promise<void>;
  /**
   * F-PARAMETRES-04 (#234) — Modes acceptés section.
   *
   * `acceptedModes`: the current persisted `{ delivery?, clickAndCollect? }`.
   *   - `undefined` is treated as « no acceptedModes set yet » (fresh
   *     tenant). The editor seeds both flags to `true` in that case
   *     (safe default — see the editor's file header).
   *   - Today the KB Manager branch starts at this sentinel because no
   *     manager-accessible read query exists for tenant-row fields
   *     (same degradation as `branding` / `coordonnees`, see file
   *     header). A KB Admin gets the real value from
   *     `loadTenantForStripe` (already loaded in the page).
   * `onSaveAcceptedModes`: page-wired handler for the section's
   *   « Enregistrer » button — wired to the SAME `useTenantMutation`
   *   binding as branding / coordonnées (ONE backend brick for all
   *   sections, D5 élargi).
   */
  acceptedModes: ModesValue | undefined;
  onSaveAcceptedModes: (patch: AcceptedModesPatch) => Promise<void>;
  /**
   * F-PARAMETRES-05 (#236) — Horaires de service section.
   *
   * `onSaveServiceHours`: page-wired handler for the section's
   *   « Enregistrer » button. Receives the ENTIRE current windows array
   *   (the backend `serviceHours.set({ windows })` mutation is an UPSERT
   *   atomic replace — one row per tenant carries the full list, cf.
   *   `convex/lib/menu/serviceHours.ts`). Page wires it to
   *   `useTenantMutation(api.lib.menu.serviceHours.set)`.
   *
   * The current windows are read from the existing `serviceHours` prop
   * above (slice 1 already wired the read query) — the editor seeds its
   * local state from `serviceHours?.windows ?? []` (an empty list is a
   * legitimate state — « fermé toute la semaine » or a fresh tenant).
   */
  onSaveServiceHours: (windows: ServiceWindow[]) => Promise<void>;
  /**
   * #416 — Imprimante cuisine section (PRD 20 §14, mirror of native #412).
   *
   * `printerConfig`: the current persisted Star WebPRNT URL (or `null` /
   *   `undefined`). `undefined` is the Convex loading sentinel; the editor
   *   handles it identically to `null` (« no printer set yet »). On a
   *   successful save by the native app (or the gérant from this page),
   *   the Convex sub flips this prop live so the form re-syncs without
   *   needing a refresh.
   * `onSavePrinterConfig`: page-wired handler for the section's
   *   « Enregistrer » button. Receives `{ starWebPrntUrl }` (trimmed,
   *   validated). Page wires it to `useTenantMutation(api.lib.printing
   *   .printing.setPrinterConfig)` — REUSES the same mutation the native
   *   Settings screen calls (no `adminSetPrinterIp` invented; the
   *   `tenantMutation` wrapper's root override admits `kb_admin`, ADR 0014
   *   §3 + `withTenant.ts requireTenantAccess`).
   * `onClearPrinterConfig`: page-wired handler for the section's
   *   « Retirer l'imprimante » button. Page wires it to `useTenantMutation
   *   (api.lib.printing.printing.clearPrinterConfig)`. After clearing,
   *   auto-print on the native side becomes a clean no-op (PRD 20 §14
   *   « si pas configurée → no-op silencieux »).
   */
  printerConfig: PrinterConfigValue;
  onSavePrinterConfig: (args: { starWebPrntUrl: string }) => Promise<void>;
  onClearPrinterConfig: () => Promise<void>;
};

export function ParametresView({
  tenantId,
  serviceHours,
  branding,
  onSaveBranding,
  onUploadLogo,
  coordonnees,
  onSaveCoordonnees,
  acceptedModes,
  onSaveAcceptedModes,
  onSaveServiceHours,
  printerConfig,
  onSavePrinterConfig,
  onClearPrinterConfig,
}: ParametresViewProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <ParametresHeader />
      <div className="flex flex-col gap-4 px-4 md:gap-6 lg:px-6">
        {/*
         * `key` on each editor — fix 2026-06-01 (P1/P2/P3/P4 spot-check).
         *
         * Every editor below uses `useForm({ defaultValues })` (or `useState`
         * with an init callback for service-hours). Those APIs read `value`
         * ONCE on mount and ignore subsequent prop changes — so when the
         * Convex query resolves AFTER the editor has already mounted with
         * `value = {}` (the loading sentinel), the persisted value never
         * makes it into the form. The user sees defaults at every reload.
         *
         * Forcing a remount via a content-derived `key` re-runs the form's
         * init callback with the just-arrived `value`. The key is computed
         * from the persisted content, NOT identity, so a parent re-render
         * with the same value doesn't trigger a spurious remount (which
         * would wipe user input mid-typing). After a save, the persisted
         * value changes → remount → form re-syncs to what the user just
         * saved → no perceptible flash.
         */}
        <SectionIdentiteVisuelle
          key={brandingEditorKey(branding)}
          value={branding ?? {}}
          onSave={onSaveBranding}
          onUploadLogo={onUploadLogo}
        />
        <SectionCoordonnees
          key={coordonneesEditorKey(coordonnees)}
          value={coordonnees ?? {}}
          onSave={onSaveCoordonnees}
        />
        <SectionModesAcceptes
          key={modesEditorKey(acceptedModes)}
          value={acceptedModes ?? {}}
          onSave={onSaveAcceptedModes}
        />
        <SectionHorairesService
          key={serviceHoursEditorKey(serviceHours?.windows ?? [])}
          value={serviceHours?.windows ?? []}
          onSave={onSaveServiceHours}
        />
        <SectionImprimanteCuisine
          key={printerEditorKey(printerConfig)}
          value={printerConfig}
          onSave={onSavePrinterConfig}
          onClear={onClearPrinterConfig}
        />
        <SectionStripeConnect tenantId={tenantId} />
        <SectionUberDirect tenantId={tenantId} />
      </div>
    </div>
  );
}

/**
 * Editor `key` derivation helpers (cf. inline comment above). Each returns
 * a stable string per persisted-content shape; same content → same key
 * (no spurious remount on parent re-render); different content → different
 * key (remount, re-sync the form). `undefined` (query loading) collapses to
 * a sentinel so the editor mounts at most once with the loading state and
 * then remounts ONCE more when the value arrives.
 */
function brandingEditorKey(branding: BrandingValue | undefined): string {
  if (branding === undefined) return "branding|loading";
  return `branding|${branding.primaryColor ?? "-"}|${branding.logoUrl ?? "-"}`;
}

function coordonneesEditorKey(
  coordonnees: CoordonneesValue | undefined,
): string {
  if (coordonnees === undefined) return "coordonnees|loading";
  return `coordonnees|${coordonnees.address ?? "-"}|${coordonnees.phone ?? "-"}`;
}

function modesEditorKey(modes: ModesValue | undefined): string {
  if (modes === undefined) return "modes|loading";
  return `modes|${modes.delivery ?? "-"}|${modes.clickAndCollect ?? "-"}`;
}

function serviceHoursEditorKey(windows: ServiceWindow[]): string {
  // The editor's `useState` init callback reads `value` (windows) on mount
  // ONLY. Same reactivity bug as the RHF-based siblings. Key = a compact
  // signature over the persisted windows; small arrays (one row per tenant
  // carries ≤ ~30 windows in practice) so the JSON serialisation cost is
  // negligible. The empty array maps to a stable sentinel.
  if (windows.length === 0) return "service-hours|empty";
  return `service-hours|${JSON.stringify(windows)}`;
}

function printerEditorKey(value: PrinterConfigValue): string {
  // `undefined` (loading) and `null` (no printer set) collapse to ONE seed
  // ⇒ the editor mounts once with the empty form, then remounts once when
  // the Convex query resolves to either the persisted URL or `null`. Same
  // discipline as `brandingEditorKey` so the user can edit the input
  // without each Convex sub tick wiping their typing.
  if (value === undefined) return "printer|loading";
  if (value === null) return "printer|empty";
  return `printer|${value.starWebPrntUrl}`;
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

/**
 * F-PARAMETRES-03 (#231) — wired Coordonnées section. Wraps the reusable
 * `CoordonneesEditor` (signature `{ value, onSave }`) inside the canonical
 * Section card so the visual rhythm with the still-unwired sections (Modes
 * / Horaires) stays consistent. The card's `data-slot` is preserved from
 * slice 1 (#193) so consumers and tests that target the section by slot
 * don't need to know whether it's a placeholder or a live editor.
 */
function SectionCoordonnees({
  value,
  onSave,
}: {
  value: CoordonneesValue;
  onSave: (patch: CoordonneesPatch) => Promise<void>;
}) {
  return (
    <Card data-slot="parametres-section-coordonnees">
      <CardHeader>
        <CardTitle>Coordonnées</CardTitle>
        <CardDescription>Adresse et téléphone du restaurant.</CardDescription>
      </CardHeader>
      <CardContent>
        <CoordonneesEditor value={value} onSave={onSave} />
      </CardContent>
    </Card>
  );
}

/**
 * F-PARAMETRES-04 (#234) — wired Modes acceptés section. Wraps the reusable
 * `ModesEditor` (signature `{ value, onSave }`) inside the canonical Section
 * card so the visual rhythm with the still-unwired Horaires section stays
 * consistent. The card's `data-slot` is preserved from slice 1 (#193) so
 * consumers and tests that target the section by slot don't need to know
 * whether it's a placeholder or a live editor.
 */
function SectionModesAcceptes({
  value,
  onSave,
}: {
  value: ModesValue;
  onSave: (patch: AcceptedModesPatch) => Promise<void>;
}) {
  return (
    <Card data-slot="parametres-section-modes">
      <CardHeader>
        <CardTitle>Modes acceptés</CardTitle>
        <CardDescription>
          Activez la livraison et / ou le click &amp; collect.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ModesEditor value={value} onSave={onSave} />
      </CardContent>
    </Card>
  );
}

/**
 * F-PARAMETRES-05 (#236) — wired Horaires de service section. Wraps the
 * reusable `ServiceHoursEditor` (signature `{ value, onSave }`) inside
 * the canonical Section card so the visual rhythm with the sibling wired
 * sections stays consistent. The card's `data-slot` is preserved from
 * slice 1 (#193) so consumers and tests that target the section by slot
 * don't need to know whether it's a placeholder or a live editor.
 *
 * `value` is the windows array from `serviceHours?.windows ?? []`
 * (treated as empty when the Convex query is still loading — the editor
 * handles `[]` gracefully and re-seeds via React's `key` invalidation
 * once the real list arrives, or stays stable if it doesn't change).
 */
function SectionHorairesService({
  value,
  onSave,
}: {
  value: ServiceWindow[];
  onSave: (windows: ServiceWindow[]) => Promise<void>;
}) {
  return (
    <Card data-slot="parametres-section-horaires">
      <CardHeader>
        <CardTitle>Horaires de service</CardTitle>
        <CardDescription>
          Grille hebdomadaire des créneaux d&apos;ouverture (livraison + click
          &amp; collect).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ServiceHoursEditor value={value} onSave={onSave} />
      </CardContent>
    </Card>
  );
}

/**
 * #416 — wired Imprimante cuisine section (PRD 20 §14). Wraps the
 * reusable `PrinterEditor` (signature `{ value, onSave, onClear }`)
 * inside the canonical Section card so the visual rhythm with the
 * sibling wired sections stays consistent.
 *
 * Same backend persistence as the native #412 Settings screen
 * (`tenants.printerConfig.starWebPrntUrl`) — state Convex partagé,
 * a change here flips the kitchen tablet live through the Convex sub
 * (and vice versa).
 */
function SectionImprimanteCuisine({
  value,
  onSave,
  onClear,
}: {
  value: PrinterConfigValue;
  onSave: (args: { starWebPrntUrl: string }) => Promise<void>;
  onClear: () => Promise<void>;
}) {
  return (
    <Card data-slot="parametres-section-imprimante">
      <CardHeader>
        <CardTitle>Imprimante cuisine</CardTitle>
        <CardDescription>
          Configuration de l&apos;imprimante thermique Star WebPRNT du
          restaurant. La configuration est synchronisée en direct avec
          l&apos;app KB Orders (tablette cuisine).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <PrinterEditor value={value} onSave={onSave} onClear={onClear} />
      </CardContent>
    </Card>
  );
}

/**
 * PR #477 — entry-point card vers la sous-page Stripe Connect a posteriori
 * (`/t/[tenantId]/parametres/stripe`). Cette page dédiée porte le wiring
 * complet (lecture du statut + génération / régénération du lien Stripe
 * `account_link`) ; ici on n'expose que le lien, pour que la fonctionnalité
 * soit découvrable depuis la page Paramètres principale sans dupliquer le
 * statut (qui change en live via le webhook `account.updated`).
 */
function SectionStripeConnect({
  tenantId,
}: {
  tenantId: Id<"tenants">;
}): React.ReactElement {
  return (
    <Card data-slot="parametres-section-stripe">
      <CardHeader>
        <CardTitle>Stripe Connect</CardTitle>
        <CardDescription>
          Configurez le compte Stripe Connect du restaurant pour pouvoir
          encaisser les paiements clients.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href={`/t/${tenantId}/parametres/stripe`}>
            Configurer Stripe Connect →
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * Carte de navigation vers la page « Uber Direct a posteriori » (mirror de
 * SectionStripeConnect). Configure les credentials API qui permettent à KB
 * de créer des courses au nom du resto. La zone de livraison reste gérée
 * directement par Uber (pas exposée ici, c'est un setting Uber-side).
 */
function SectionUberDirect({
  tenantId,
}: {
  tenantId: Id<"tenants">;
}): React.ReactElement {
  return (
    <Card data-slot="parametres-section-uber-direct">
      <CardHeader>
        <CardTitle>Uber Direct</CardTitle>
        <CardDescription>
          Configurez les credentials API Uber Direct pour que KitchenBoost
          puisse créer des courses au nom du restaurant.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild variant="outline">
          <Link href={`/t/${tenantId}/parametres/uber-direct`}>
            Configurer Uber Direct →
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
