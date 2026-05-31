"use client";

/**
 * F-WIZARD [3/10] (#267) — `Step1ProvisioningForm`, the real Step 1 form that
 * replaces the placeholder shipped by slice [1/10] (#265).
 *
 * Slice charnière du wizard de provisioning : sans cette étape, aucun step
 * suivant n'a d'objet sur lequel opérer (le tenant `pending`, créé ici,
 * débloque les steps 2..8 + permet de poser le back-link `tenantId` sur le
 * prospect).
 *
 * Surface (issue #267) :
 *   - 6 champs : nom, SIRET, adresse, contact (nom du gérant ou raison
 *     sociale), email gérant, slug.
 *   - Pré-remplissage : les valeurs connues du prospect sont injectées au
 *     premier rendu. Les optionnelles absentes restent vides (jamais
 *     « undefined » dans le DOM).
 *   - Slug : auto-pré-rempli depuis le nom via `generateSlug` (mirror de la
 *     helper backend `lib/onboarding/provisioning.ts:generateSlug`). Tant
 *     que l'opérateur n'a pas édité le slug manuellement, il SUIT le nom à
 *     chaque keystroke ; dès qu'il le touche, le slug devient libre (n'est
 *     plus écrasé par le nom).
 *   - Validation client-side : SIRET 14 chiffres exactement, email format
 *     RFC-light, slug regex `^[a-z0-9-]+$`, nom non vide. Le bouton
 *     « Créer le tenant » reste désactivé tant que le payload n'est pas
 *     valide (gate UX, pas seul rempart — le backend re-valide).
 *   - Submit : appelle `onProvision({ prospectId, name, siret, address,
 *     contactName, emailManager, slug })`. Le parent (`page.tsx`) wrappe
 *     `api.lib.onboarding.provisioning.provisionTenant`, surface l'erreur
 *     via `submitError` et navigue vers step 2 sur succès via `onNext`.
 *   - Erreur backend (ex. `SLUG_TAKEN`, `INVALID_SIRET`) : le parent passe
 *     `submitError`, qu'on affiche inline ; la form garde ses valeurs (état
 *     local intact, l'opérateur peut corriger sans tout re-taper).
 *   - Re-visite après création (`prospect.tenantId !== undefined`) : form en
 *     READ-ONLY avec message « Compte créé, modifications via Paramètres
 *     tenant » (issue spec verbatim) + bouton « Suivant » pour avancer. Le
 *     slug est structurellement immuable (multi-tenant CONTEXT « Slug »),
 *     les autres champs aussi pour V1 (modifications via la fiche tenant
 *     post-provisioning, pas via le wizard).
 *
 * Scope (#267 hard constraint) : `apps/admin/src/app/(app)/pipeline/[prospectId]/provision/`
 * UNIQUEMENT. Aucune touche à `apps/web`, `apps/native`, ni
 * `packages/backend/convex/`. La mutation `provisionTenant` existe déjà côté
 * backend (slice 2.9-E), on ne fait QUE la consommer.
 *
 * Testabilité : composant purement présentationnel. Les hooks Convex
 * (`useQuery(getProspect)`, `useMutation(provisionTenant)`) vivent dans
 * `page.tsx`, qui threade prospect + onProvision + isSubmitting +
 * submitError ici. Cela permet de pinner toute la matrice de tests sous le
 * lean `node` vitest env via le même React-tree serializer que les autres
 * vues (`wizard-view.test.tsx`, `prospect-fiche-view.test.tsx`).
 */
import { useMemo, useState } from "react";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { StepFormProps } from "./step-forms";

// ---------------------------------------------------------------------------
// Pure helpers — mirror of the backend slug normalizer + light validators.
// ---------------------------------------------------------------------------

/**
 * Front-side mirror of `packages/backend/convex/lib/onboarding/provisioning
 * .ts::generateSlug`. The wizard front needs the SAME normalization to
 * propose a candidate slug from the restaurant name without a network
 * round-trip per keystroke; the backend re-runs its own version on submit
 * (single source of truth for the uniqueness check). Keep both in sync — a
 * drift would surface as a confusing « slug différent du nom » UX without
 * breaking correctness.
 *
 * Algorithm (lowercase, strip accents NFD + combining marks, replace every
 * run of non-alphanumerics with a single hyphen, trim edge hyphens).
 */
export function generateSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Mn}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** SIRET = 14 chiffres exactement (norme INSEE). */
function isValidSiret(value: string): boolean {
  return /^\d{14}$/.test(value);
}

/**
 * Format email RFC-light (assez strict pour bloquer « not-an-email » mais
 * volontairement permissif sur les sous-domaines / TLD longs / + tags).
 * Le backend re-valide via Resend / `signIn(password, {flow: signUp})` —
 * c'est le filet final.
 */
function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

/** Slug : `^[a-z0-9-]+$` (multi-tenant CONTEXT « Slug »). */
function isValidSlug(value: string): boolean {
  return /^[a-z0-9-]+$/.test(value);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The payload the form fires to its parent on submit. The parent maps it to
 * the backend `provisionTenant` mutation signature
 * (`{ prospectId, name, siret, slug, manager: { email, name } }`). The form
 * keeps the spec-aligned shape (with `address` + `contactName` +
 * `emailManager`) so the wiring layer owns the mapping in ONE place.
 */
export type Step1ProvisioningPayload = {
  prospectId: Id<"prospects">;
  name: string;
  siret: string;
  address: string;
  contactName: string;
  emailManager: string;
  slug: string;
};

export type Step1ProvisioningFormProps = StepFormProps & {
  /**
   * The hydrated prospect doc, used to pre-fill the 6 fields and to detect
   * the read-only state (tenant already provisioned).
   */
  prospect: Doc<"prospects">;
  /**
   * Submit handler. The parent wires `api.lib.onboarding.provisioning
   * .provisionTenant` and either resolves (parent navigates to step 2 via
   * its own `onNext` chain) or surfaces the error via `submitError`.
   */
  onProvision: (payload: Step1ProvisioningPayload) => Promise<void> | void;
  /**
   * Re-disables the submit button while the round-trip is in flight (avoids
   * double-creating the tenant on a fast double-click — the backend
   * uniqueness check on slug is the safety net, this is the UX layer).
   */
  isSubmitting: boolean;
  /**
   * Backend error message (e.g. « Slug "x" déjà pris ») surfaced inline
   * under the form. The form NEVER clears it itself — the parent flips it
   * back to `null` when it re-fires `onProvision` or when the user closes
   * the wizard (cf. `page.tsx`).
   */
  submitError: string | null;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Step1ProvisioningForm(
  props: Step1ProvisioningFormProps,
): React.JSX.Element {
  const { prospect, onProvision, isSubmitting, submitError, onNext } = props;

  // Read-only mode: the prospect already carries a tenantId, i.e. step 1
  // has already been completed (re-visite via Précédent depuis step 2+).
  // Issue spec verbatim: « Compte créé, modifications via Paramètres
  // tenant » — V1 le step 1 est immuable après création.
  const isReadOnly = prospect.tenantId !== undefined;

  // -- Local form state ----------------------------------------------------
  // Pre-fill from the prospect doc on first render. Optional fields fall
  // back to "" so the controlled inputs never render `undefined` (which
  // React would coerce to the string « undefined » in the DOM).
  const [name, setName] = useState<string>(prospect.name ?? "");
  const [siret, setSiret] = useState<string>(prospect.siret ?? "");
  const [address, setAddress] = useState<string>(prospect.address ?? "");
  const [contactName, setContactName] = useState<string>(
    prospect.contactName ?? "",
  );
  const [emailManager, setEmailManager] = useState<string>(
    prospect.email ?? "",
  );
  // Slug suit le nom auto via `generateSlug` jusqu'à ce que l'opérateur
  // l'édite explicitement. On track ce moment via `slugTouched` ; une fois
  // touché, le slug devient libre (n'est plus écrasé par les changements
  // du nom). Au premier rendu, on dérive depuis le nom pré-rempli.
  const [slug, setSlug] = useState<string>(() =>
    generateSlug(prospect.name ?? ""),
  );
  const [slugTouched, setSlugTouched] = useState<boolean>(false);

  // -- Handlers ------------------------------------------------------------
  const handleNameChange = (next: string) => {
    setName(next);
    if (!slugTouched) {
      // Slug auto-suit le nom tant que l'opérateur n'a pas explicitement
      // touché le champ slug — UX du « brouillon intelligent ».
      setSlug(generateSlug(next));
    }
  };
  const handleSlugChange = (next: string) => {
    setSlug(next);
    setSlugTouched(true);
  };

  // -- Derived: form-level validity ----------------------------------------
  const validity = useMemo(() => {
    const nameOk = name.trim().length > 0;
    const siretOk = isValidSiret(siret);
    const emailOk = isValidEmail(emailManager);
    const slugOk = isValidSlug(slug);
    return {
      nameOk,
      siretOk,
      emailOk,
      slugOk,
      all: nameOk && siretOk && emailOk && slugOk,
    };
  }, [name, siret, emailManager, slug]);

  const canSubmit = validity.all && !isSubmitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onProvision({
      prospectId: prospect._id,
      name: name.trim(),
      siret,
      address,
      contactName,
      emailManager,
      slug,
    });
  };

  // -------------------------------------------------------------------------
  // Read-only branch (re-visite après création)
  // -------------------------------------------------------------------------
  if (isReadOnly) {
    return (
      <div
        className="flex flex-col gap-4 px-4 py-2 lg:px-6"
        data-slot="wizard-step1-readonly"
      >
        <div className="rounded-lg border bg-muted/40 p-4 text-sm">
          <p className="font-medium">Compte créé</p>
          <p className="text-muted-foreground mt-1">
            Le compte restaurant a déjà été provisionné pour ce prospect. Les
            modifications du nom, SIRET, adresse, contact et email gérant se
            font désormais via Paramètres tenant. Le slug est immuable
            structurellement.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button type="button" onClick={onNext} data-slot="wizard-step1-next">
            Suivant
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Editable branch
  // -------------------------------------------------------------------------
  return (
    <div
      className="flex flex-col gap-4 px-4 py-2 lg:px-6"
      data-slot="wizard-step1-form"
    >
      {/* Nom */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wizard-step1-name">Nom du restaurant</Label>
        <Input
          id="wizard-step1-name"
          data-slot="wizard-step1-name-input"
          name="name"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          placeholder="L'Artisan"
          aria-invalid={!validity.nameOk || undefined}
        />
      </div>

      {/* SIRET */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wizard-step1-siret">SIRET (14 chiffres)</Label>
        <Input
          id="wizard-step1-siret"
          data-slot="wizard-step1-siret-input"
          name="siret"
          value={siret}
          onChange={(e) => setSiret(e.target.value)}
          placeholder="12345678901234"
          inputMode="numeric"
          aria-invalid={!validity.siretOk || undefined}
        />
        {siret.length > 0 && !validity.siretOk ? (
          <p
            data-slot="wizard-step1-siret-error"
            className="text-destructive text-xs"
          >
            Le SIRET doit comporter exactement 14 chiffres.
          </p>
        ) : null}
      </div>

      {/* Adresse */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wizard-step1-address">Adresse</Label>
        <Input
          id="wizard-step1-address"
          data-slot="wizard-step1-address-input"
          name="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="1 rue de la Paix, 75001 Paris"
        />
      </div>

      {/* Contact (nom du gérant ou raison sociale) */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wizard-step1-contact">
          Contact (gérant ou raison sociale)
        </Label>
        <Input
          id="wizard-step1-contact"
          data-slot="wizard-step1-contact-input"
          name="contactName"
          value={contactName}
          onChange={(e) => setContactName(e.target.value)}
          placeholder="Yanis"
        />
      </div>

      {/* Email gérant */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wizard-step1-email">Email du gérant</Label>
        <Input
          id="wizard-step1-email"
          data-slot="wizard-step1-email-input"
          name="emailManager"
          type="email"
          value={emailManager}
          onChange={(e) => setEmailManager(e.target.value)}
          placeholder="gerant@restaurant.fr"
          aria-invalid={!validity.emailOk || undefined}
        />
        {emailManager.length > 0 && !validity.emailOk ? (
          <p
            data-slot="wizard-step1-email-error"
            className="text-destructive text-xs"
          >
            Format d&apos;email invalide.
          </p>
        ) : null}
      </div>

      {/* Slug */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="wizard-step1-slug">
          Slug ({String.fromCharCode(0x60)}lowercase{String.fromCharCode(0x60)},
          chiffres, tirets — immuable après création)
        </Label>
        <Input
          id="wizard-step1-slug"
          data-slot="wizard-step1-slug-input"
          name="slug"
          value={slug}
          onChange={(e) => handleSlugChange(e.target.value)}
          placeholder="l-artisan"
          aria-invalid={!validity.slugOk || undefined}
        />
        {slug.length > 0 && !validity.slugOk ? (
          <p
            data-slot="wizard-step1-slug-error"
            className="text-destructive text-xs"
          >
            Le slug accepte uniquement [a-z0-9-].
          </p>
        ) : null}
      </div>

      {/* Backend error surfaced inline (slug taken, invalid SIRET, etc.) */}
      {submitError !== null ? (
        <div
          data-slot="wizard-step1-submit-error"
          className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
        >
          {submitError}
        </div>
      ) : null}

      {/* Submit */}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          data-slot="wizard-step1-submit"
          onClick={handleSubmit}
          disabled={!canSubmit}
        >
          {isSubmitting ? "Création…" : "Créer le tenant"}
        </Button>
      </div>
    </div>
  );
}
