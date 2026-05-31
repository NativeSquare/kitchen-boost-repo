"use client";

/**
 * F-PARAMETRES-03 (#231) — `CoordonneesEditor`, the section éditeur for
 * Coordonnées (adresse + téléphone) on the tenant Paramètres page.
 *
 * Stand-alone reusable deep module, mirrors the design of
 * `branding-editor.tsx` (#229): a narrow `{ value, onSave }` contract, an
 * isolated `useForm` per user story 9 (« save isolé : un échec sur cette
 * section ne perd pas les inputs en cours d'Identité visuelle »), and no
 * coupling to the URL / tenant context / backend api (so a future surface
 * can mount it without rework).
 *
 * What it owns:
 *  - the two form fields (`address`, `phone`) and their persisted seeds;
 *  - the pure FR-phone validator (`isValidFrenchPhone`) — also exported so
 *    `coordonnees-editor.test.tsx` can pin the regex in isolation (AC :
 *    « Test du regex de validation téléphone FR (unitaire) »);
 *  - the « Enregistrer » button — DISABLED when the current phone is
 *    non-empty AND invalid (AC : « Erreur inline si format invalide, bouton
 *    Enregistrer désactivé »);
 *  - the save flow — diff-only patch (only the changed fields land in the
 *    patch, empty patch = no-op, no round-trip);
 *  - the inline error surface — `phone` format error AND server-side
 *    rejection (AC : « inline form errors incluant erreurs backend type
 *    isolation tenant »). Page-level toast lives at the page (consistent
 *    with the rest of admin).
 *
 * What it does NOT own:
 *  - the toast (page-level concern, ADR 0014 / consistent with branding);
 *  - the tenantId / mutation wiring (the page does both, the editor stays
 *    UI-only — reusable across surfaces);
 *  - canonicalising the phone for storage. The user-typed value is
 *    forwarded as-is in the patch; the backend's `normalisePhone` (in
 *    `lib/admin/tenantSettingsValidation.ts`) is the single source of
 *    truth for the canonical form, avoiding client/server drift.
 *
 * Scope discipline (#231 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/parametres/`. Zero coupling to the
 * backend api / Convex hooks / tenant context — pinned by
 * `coordonnees-editor.test.tsx`'s source-level guards.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The Coordonnées sub-object — mirrors the optional `address` + `phone`
 *  fields on the `tenants` row (`packages/backend/convex/table/tenants.ts`)
 *  and the equivalent slots on the `tenant.updateSettings` mutation's
 *  patch validator. */
export type CoordonneesValue = {
  address?: string;
  phone?: string;
};

/** Patch shape forwarded to the page's `onSave` handler — mirrors the
 *  backend mutation's top-level `{ address?, phone? }` patch slots (the
 *  `branding` and `acceptedModes` slots belong to other sections). */
export type CoordonneesPatch = {
  address?: string;
  phone?: string;
};

export type CoordonneesEditorProps = {
  /**
   * The current persisted value — seeds the form's defaults AND drives the
   * diff (fields whose form value equals the seed are NOT in the patch).
   * An empty object is valid (« no address, no phone yet » — a fresh
   * tenant before the wizard finished, or a partial save).
   */
  value: CoordonneesValue;
  /**
   * Commit handler — receives the diff between the form state and `value`.
   * Empty patch never reaches this callback (the editor short-circuits to
   * a no-op). Page-side wiring:
   * `useTenantMutation(api.lib.admin.tenantSettings.updateSettings)`.
   */
  onSave: (patch: CoordonneesPatch) => Promise<void>;
};

type CoordonneesFormShape = {
  address: string;
  phone: string;
};

/**
 * Pure FR-phone validator (exported for the unit-test AC).
 *
 * Accepts:
 *  - `0[1-79][0-9]{8}` (10-digit FR number, leading 0, trunk digit ≠ 0/8;
 *    trunk 1-5 = landline geo, 6/7 = mobile, 9 = VoIP/landline IP);
 *  - the same prefixed by `+33` or `0033` (international form). The leading
 *    0 is optional after `+33` / `0033` — both `+33612...` and `+33 0 6 12`
 *    aren't standard, so the canonical accepted form drops the leading 0
 *    after the country code.
 *
 * Separators (spaces, dots, dashes) are tolerated anywhere and stripped
 * before matching — common FR UX where users type « 06 12 34 56 78 ».
 *
 * Rejects:
 *  - 08 / 00 prefixes (premium / international placeholder);
 *  - wrong-length numbers (too short / too long);
 *  - non-numeric characters (letters, slashes, etc.) — other than the
 *    tolerated leading `+` and the stripped separators;
 *  - empty / whitespace-only input.
 *
 * The backend's `normalisePhone` (in `lib/admin/tenantSettingsValidation`)
 * is intentionally more permissive (it just strips whitespace and accepts
 * any all-digit sequence) — the front's regex is the stricter FR-format
 * gate, applied before the network call so the user gets immediate
 * feedback on bad input.
 */
export function isValidFrenchPhone(value: string): boolean {
  // Strip the tolerated separators. Anything else (letters, `/`, …) will
  // fail the digit-only check below.
  const stripped = value.replace(/[\s.\-]/g, "");
  if (stripped.length === 0) return false;

  // Optional leading `+33` or `0033` (international). After this prefix
  // we expect 9 digits whose first digit is the trunk digit (1-7 or 9).
  if (stripped.startsWith("+33")) {
    const rest = stripped.slice(3);
    return /^[1-79][0-9]{8}$/.test(rest);
  }
  if (stripped.startsWith("0033")) {
    const rest = stripped.slice(4);
    return /^[1-79][0-9]{8}$/.test(rest);
  }
  // Domestic form: leading 0, trunk digit 1-7 or 9, then 8 digits.
  return /^0[1-79][0-9]{8}$/.test(stripped);
}

export function CoordonneesEditor({
  value,
  onSave,
}: CoordonneesEditorProps): React.ReactElement {
  const form = useForm<CoordonneesFormShape>({
    defaultValues: {
      address: value.address ?? "",
      phone: value.phone ?? "",
    },
  });
  const { register, handleSubmit, watch, formState } = form;

  // Live-watched values drive the validation + diff. Read both fields so the
  // « Enregistrer » disabled state updates on every keystroke (and so the
  // diff is computed from what the user currently sees).
  const watchedAddress = watch("address") ?? "";
  const watchedPhone = watch("phone") ?? "";

  // Inline server-side error (AC : « inline form errors incluant erreurs
  // backend type isolation tenant »). Reset on each submit attempt.
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Phone format gate: an empty phone is allowed (the field is optional —
  // a partial save without phone is legitimate). A non-empty phone must
  // match the FR regex; otherwise the inline error surfaces AND the save
  // button is disabled.
  const phoneIsInvalid =
    watchedPhone.length > 0 && !isValidFrenchPhone(watchedPhone);

  // Diff helper: only fields whose form value differs from `value` land in
  // the patch. An empty string vs `undefined` is considered « unchanged »
  // (a fresh tenant has no address / phone — leaving the input blank
  // shouldn't synthesise an empty string in the patch).
  const buildPatch = (data: CoordonneesFormShape): CoordonneesPatch | null => {
    const patch: CoordonneesPatch = {};
    const formAddress = data.address.trim();
    const formPhone = data.phone.trim();
    if (formAddress !== (value.address ?? "") && formAddress.length > 0) {
      patch.address = formAddress;
    }
    if (formPhone !== (value.phone ?? "") && formPhone.length > 0) {
      patch.phone = formPhone;
    }
    if (Object.keys(patch).length === 0) return null;
    return patch;
  };

  const onSubmit = async (data: CoordonneesFormShape): Promise<void> => {
    setSubmitError(null);
    // Re-assert the phone gate at submit time (defence in depth — the
    // button is also disabled, but a programmatic submit could bypass that).
    if (data.phone.length > 0 && !isValidFrenchPhone(data.phone)) {
      setSubmitError(
        "Le numéro de téléphone n'est pas dans un format français valide.",
      );
      return;
    }
    const patch = buildPatch(data);
    if (patch === null) return; // empty patch — no-op
    try {
      await onSave(patch);
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : "Échec de l'enregistrement, réessayez.";
      setSubmitError(message);
    }
  };

  const addressInputId = "parametres-coordonnees-address-id";
  const phoneInputId = "parametres-coordonnees-phone-id";

  return (
    <form
      data-slot="parametres-coordonnees-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-5"
    >
      <h2 className="sr-only">Coordonnées</h2>

      <div className="flex flex-col gap-2">
        <Label htmlFor={addressInputId}>Adresse</Label>
        <Input
          id={addressInputId}
          data-slot="parametres-coordonnees-address-input"
          type="text"
          autoComplete="street-address"
          placeholder="12 rue de la Paix, 75002 Paris"
          {...register("address")}
        />
        <p className="text-muted-foreground text-xs">
          Adresse complète du restaurant. Utilisée pour l&apos;affichage public
          et pour la zone de livraison Uber Direct.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={phoneInputId}>Téléphone</Label>
        <Input
          id={phoneInputId}
          data-slot="parametres-coordonnees-phone-input"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="06 12 34 56 78"
          aria-invalid={phoneIsInvalid || undefined}
          {...register("phone")}
        />
        {phoneIsInvalid ? (
          <p
            data-slot="parametres-coordonnees-phone-error"
            className="text-destructive text-xs"
          >
            Format de téléphone invalide. Exemples acceptés : 06 12 34 56 78,
            0612345678, +33 6 12 34 56 78.
          </p>
        ) : (
          <p className="text-muted-foreground text-xs">
            Format français : mobile (06/07) ou fixe (01-05/09).
          </p>
        )}
      </div>

      {/* Server-side rejection — kept distinct from the per-field error so
          a backend FORBIDDEN (cross-tenant), INVALID_PHONE, INVALID_ADDRESS,
          etc. surfaces with its actual message. */}
      {submitError !== null ? (
        <p
          data-slot="parametres-coordonnees-submit-error"
          className="text-destructive text-sm"
        >
          {submitError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          data-slot="parametres-coordonnees-save"
          disabled={formState.isSubmitting || phoneIsInvalid}
        >
          Enregistrer
        </Button>
      </div>

      {/* Render the seed address even when react-hook-form's register/watch
          haven't propagated yet (defensive, mostly a no-op in the live UI;
          harmless under serializer tests). */}
      <span className="sr-only">{watchedAddress}</span>
    </form>
  );
}
