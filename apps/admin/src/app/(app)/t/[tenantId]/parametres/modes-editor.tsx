"use client";

/**
 * F-PARAMETRES-04 (#234) — `ModesEditor`, the section éditeur for « Modes
 * acceptés » (delivery + click & collect) on the tenant Paramètres page.
 *
 * Stand-alone reusable deep module, mirrors the design of
 * `branding-editor.tsx` (#229) and `coordonnees-editor.tsx` (#231): a
 * narrow `{ value, onSave }` contract, an isolated `useForm` per user
 * story 9 (« save isolé : un échec sur cette section ne perd pas les
 * inputs en cours sur d'autres sections »), and no coupling to the URL /
 * tenant context / backend api (so a future surface — e.g. F-WIZARD —
 * can mount it without rework).
 *
 * What it owns:
 *  - the two toggle controls (`Switch` from `components/ui/switch`) for
 *    `delivery` and `clickAndCollect`, mounted as controlled components
 *    so the GUARD MÉTIER (« au moins un mode actif ») can drive the
 *    disabled state of each toggle from the LIVE form state;
 *  - the « Enregistrer » button → calls `onSave({ acceptedModes: {
 *    delivery, clickAndCollect } })`. ALWAYS forwards both flags — the
 *    backend `acceptedModesPatch` validator (cf.
 *    `packages/backend/convex/lib/admin/tenantSettings.ts`) requires
 *    BOTH booleans, never a partial sub-patch;
 *  - the inline guard message + the inline server-error surface;
 *  - the diff-vs-`value` check that short-circuits a no-op save (no
 *    network call when nothing changed).
 *
 * GUARD MÉTIER FRONT (user story 5, AC clé)
 * ----------------------------------------
 * Il est IMPOSSIBLE de désactiver les deux modes simultanément côté UI :
 *   - if exactly ONE mode is currently active (in the live form state),
 *     that mode's toggle is rendered DISABLED — clicking it does nothing;
 *   - the other (currently-off) toggle stays activable so the user can
 *     escape the « last active mode » state by enabling the other one
 *     FIRST, then disabling the first one;
 *   - an inline message « Au moins un mode doit rester actif » surfaces
 *     under the guard so the user understands WHY the toggle is locked.
 *
 * Defence in depth: the same predicate runs at submit time so a
 * programmatic submit (or a controlled-toggle round-trip bug) that
 * reaches the handler with both = false is REFUSED — `onSave` is never
 * called, an inline error surfaces.
 *
 * What it does NOT own:
 *  - the toast (page-level concern, ADR 0014 / consistent with the
 *    sibling editors);
 *  - the tenantId / mutation wiring (the page does both, the editor
 *    stays UI-only — reusable across surfaces).
 *
 * Default for a fresh tenant (`value = {}`)
 * -----------------------------------------
 * Both modes default to ENABLED (delivery = true, clickAndCollect = true).
 * Rationale: a tenant just provisioned has no `acceptedModes` row yet
 * (the field is optional on the schema). Showing both toggles ON is the
 * safest default — it mirrors « the resto accepts everything until told
 * otherwise », and it never engages the « au moins un mode actif » guard
 * spuriously. The user can then disable one (still legal — the other
 * stays on) and save; from that point on, `value` carries the stamped
 * choice and seeds the form.
 *
 * Scope discipline (#234 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/parametres/`. Zero coupling to
 * the backend api / Convex hooks / tenant context — pinned by
 * `modes-editor.test.tsx`'s source-level guards.
 */

import { useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/** The Modes acceptés sub-object — mirrors the optional `acceptedModes`
 *  field on the `tenants` row (`packages/backend/convex/table/tenants.ts`)
 *  AND the equivalent `acceptedModesPatch` slot on the
 *  `tenant.updateSettings` mutation's patch validator. Both inner flags
 *  are optional on the FRONT type so the editor can degrade gracefully
 *  for a fresh tenant; the backend validator however requires BOTH
 *  flags when a save lands, which is why the patch shape below stamps
 *  them as `boolean` (never `boolean | undefined`). */
export type ModesValue = {
  delivery?: boolean;
  clickAndCollect?: boolean;
};

/** Patch shape forwarded to the page's `onSave` handler — mirrors the
 *  backend mutation's top-level `acceptedModes` slot. ALWAYS carries
 *  BOTH booleans (the backend validator is non-optional on the inner
 *  fields — a partial patch would throw). */
export type AcceptedModesPatch = {
  acceptedModes: {
    delivery: boolean;
    clickAndCollect: boolean;
  };
};

export type ModesEditorProps = {
  /**
   * The current persisted value — seeds the form's defaults AND drives
   * the diff (a save with no change is a no-op). An empty object is
   * valid (« fresh tenant, no acceptedModes set yet »); the editor
   * defaults both flags to `true` in that case (see file header).
   */
  value: ModesValue;
  /**
   * Commit handler — receives `{ acceptedModes: { delivery,
   * clickAndCollect } }`. Empty-diff calls are short-circuited (no-op,
   * `onSave` is NOT invoked). Page-side wiring:
   * `useTenantMutation(api.lib.admin.tenantSettings.updateSettings)`.
   */
  onSave: (patch: AcceptedModesPatch) => Promise<void>;
};

type ModesFormShape = {
  delivery: boolean;
  clickAndCollect: boolean;
};

/** Default for a fresh tenant — both modes enabled (see file header). */
const FRESH_TENANT_DEFAULTS = {
  delivery: true,
  clickAndCollect: true,
} as const;

export function ModesEditor({
  value,
  onSave,
}: ModesEditorProps): React.ReactElement {
  const seededDelivery = value.delivery ?? FRESH_TENANT_DEFAULTS.delivery;
  const seededClickAndCollect =
    value.clickAndCollect ?? FRESH_TENANT_DEFAULTS.clickAndCollect;

  const form = useForm<ModesFormShape>({
    defaultValues: {
      delivery: seededDelivery,
      clickAndCollect: seededClickAndCollect,
    },
  });
  const { handleSubmit, watch, setValue, formState } = form;

  // Live-watched flags drive the GUARD MÉTIER (a toggle gets disabled
  // when flipping it off would leave both modes off). We can't use
  // RHF's `register()` directly on `Switch` (it's a Radix component
  // that doesn't take native `onChange` events) — we wire each toggle
  // as a controlled component via `watch` + `setValue`.
  const liveDelivery =
    (watch("delivery") as boolean | undefined) ?? seededDelivery;
  const liveClickAndCollect =
    (watch("clickAndCollect") as boolean | undefined) ?? seededClickAndCollect;

  // GUARD predicate — exactly one mode is currently active. In that
  // case, that toggle MUST stay on (turning it off would leave both
  // off, which the AC forbids).
  const onlyDeliveryActive = liveDelivery && !liveClickAndCollect;
  const onlyClickAndCollectActive = !liveDelivery && liveClickAndCollect;
  const lastActiveModeIsDelivery = onlyDeliveryActive;
  const lastActiveModeIsClickAndCollect = onlyClickAndCollectActive;
  const guardEngaged = onlyDeliveryActive || onlyClickAndCollectActive;

  // Inline server-side error (AC : « inline form errors »). Reset on
  // each submit attempt. Also surfaces the defence-in-depth refusal
  // when a programmatic submit reaches us with both = false.
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Diff helper: emit the patch ONLY when one of the two flags differs
  // from the seeded `value`. Returns `null` to signal « no-op save »
  // (the handler then short-circuits without calling `onSave`). For a
  // fresh tenant with no `value.delivery` / `value.clickAndCollect`,
  // the comparison treats `undefined` as the seeded default — so
  // « click save without touching anything » on a fresh tenant is a
  // no-op (the resto already has the safe default, no need for a
  // round-trip).
  const buildPatch = (data: ModesFormShape): AcceptedModesPatch | null => {
    const persistedDelivery = value.delivery ?? FRESH_TENANT_DEFAULTS.delivery;
    const persistedClickAndCollect =
      value.clickAndCollect ?? FRESH_TENANT_DEFAULTS.clickAndCollect;
    if (
      data.delivery === persistedDelivery &&
      data.clickAndCollect === persistedClickAndCollect
    ) {
      return null;
    }
    return {
      acceptedModes: {
        delivery: data.delivery,
        clickAndCollect: data.clickAndCollect,
      },
    };
  };

  const onSubmit = async (data: ModesFormShape): Promise<void> => {
    setSubmitError(null);
    // Defence in depth — refuse a submit that would persist both = false.
    if (!data.delivery && !data.clickAndCollect) {
      setSubmitError("Au moins un mode doit rester actif.");
      return;
    }
    const patch = buildPatch(data);
    if (patch === null) return; // no-op
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

  const deliveryToggleId = "parametres-modes-delivery-toggle-id";
  const clickAndCollectToggleId =
    "parametres-modes-click-and-collect-toggle-id";

  return (
    <form
      data-slot="parametres-modes-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-5"
    >
      <h2 className="sr-only">Modes acceptés</h2>

      {/* Delivery toggle row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label htmlFor={deliveryToggleId} className="text-sm font-medium">
            Livraison
          </Label>
          <p className="text-muted-foreground text-xs">
            Vos clients peuvent commander en livraison (Uber Direct).
          </p>
        </div>
        <Switch
          id={deliveryToggleId}
          data-slot="parametres-modes-delivery-toggle"
          checked={liveDelivery}
          disabled={lastActiveModeIsDelivery}
          onCheckedChange={(next) => {
            setValue("delivery", next, { shouldDirty: true });
          }}
        />
      </div>

      {/* Click & Collect toggle row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <Label
            htmlFor={clickAndCollectToggleId}
            className="text-sm font-medium"
          >
            Click &amp; Collect
          </Label>
          <p className="text-muted-foreground text-xs">
            Vos clients peuvent commander et venir récupérer leur commande sur
            place.
          </p>
        </div>
        <Switch
          id={clickAndCollectToggleId}
          data-slot="parametres-modes-click-and-collect-toggle"
          checked={liveClickAndCollect}
          disabled={lastActiveModeIsClickAndCollect}
          onCheckedChange={(next) => {
            setValue("clickAndCollect", next, { shouldDirty: true });
          }}
        />
      </div>

      {/* Inline guard message (user story 5: « message inline qui explique »).
          Surfaces ONLY when the guard is engaged (exactly one mode active),
          so the user understands WHY the disabled toggle won't budge. */}
      {guardEngaged ? (
        <p
          data-slot="parametres-modes-guard-message"
          className="text-muted-foreground text-xs"
        >
          Au moins un mode doit rester actif. Activez l&apos;autre mode pour
          pouvoir désactiver celui-ci.
        </p>
      ) : (
        <p className="text-muted-foreground text-xs">
          Au moins un mode doit rester actif à tout moment.
        </p>
      )}

      {/* Server-side rejection — kept distinct so a backend FORBIDDEN
          (cross-tenant) or other code surfaces with its actual message. */}
      {submitError !== null ? (
        <p
          data-slot="parametres-modes-submit-error"
          className="text-destructive text-sm"
        >
          {submitError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          data-slot="parametres-modes-save"
          disabled={formState.isSubmitting}
        >
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
