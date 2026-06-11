"use client";

/**
 * F-PARAMETRES-03 (#231) + Address-first slice 2 (2026-06-11) —
 * `CoordonneesEditor`, the section éditeur for Coordonnées (adresse + téléphone)
 * on the tenant Paramètres page (and on Step 4 of the provisioning wizard).
 *
 * Stand-alone reusable deep module, mirrors the design of `branding-editor.tsx`
 * (#229): a narrow `{ value, onSave }` contract, an isolated `useForm` per user
 * story 9 (« save isolé »), and no coupling to the URL / tenant context /
 * backend api (so a future surface can mount it without rework).
 *
 * Slice 2 change (address-first refonte) — the address field is no longer a
 * free-typed `<Input>`. It is now a `<gmp-place-autocomplete>` (Google Places
 * API New) web component, mounted from a dynamic import of
 * `@googlemaps/js-api-loader` inside a `useEffect` (NEVER a top-level static
 * import — `@googlemaps/js-api-loader@2.x` touches `window` at module
 * evaluation time, which crashes Next 16 SSR even under "use client" because
 * Next still evaluates client modules server-side to identify their exports.
 * Cf. memory `googlemaps-loader-ssr-bug`).
 *
 * The contract is now an all-or-nothing 4-tuple `{ address, addressLat,
 * addressLng, addressComponents }` — required by the backend slice 1 mutation
 * `tenant.updateSettings` (which throws `INVALID_ADDRESS_PAYLOAD` on any
 * half-patch carrying `address` without the lat/lng/components siblings). The
 * editor enforces this on the wire: a Places selection populates ALL FOUR
 * slots together; a phone-only save omits all four; never a mix.
 *
 * What it owns:
 *  - the Places autocomplete element (mounted via dynamic import in `useEffect`);
 *  - the phone field (still a controlled `<Input>` because there is no
 *    autocomplete UX for FR phones the way Places does for addresses);
 *  - the pure FR-phone validator (`isValidFrenchPhone`);
 *  - the pure Google Places → Uber components parser
 *    (`parseGooglePlacesToUberComponents`) — exported so
 *    `coordonnees-editor.test.tsx` can unit-test the 5 rejection / acceptance
 *    branches in isolation;
 *  - the « Enregistrer » button gating — DISABLED if (a) the phone is
 *    non-empty AND invalid, (b) nothing has changed vs `value` (no Places
 *    selection AND no phone diff), (c) the legacy warning is showing AND
 *    the user has not yet re-selected a Places suggestion;
 *  - the save flow — diff-only patch (only the changed sections land in the
 *    patch; the address sub-patch is ALWAYS the complete 4-tuple, never a
 *    `address`-only or `addressLat`-only half-patch);
 *  - the inline error surfaces — phone-format, Places-rejection (« Adresse
 *    non livrable »), legacy warning (« Adresse à re-saisir »), and
 *    server-side rejection.
 *
 * What it does NOT own:
 *  - the toast (page-level concern, ADR 0014);
 *  - the tenantId / mutation wiring (the page does both);
 *  - canonicalising the phone for storage (backend `normalisePhone`).
 *
 * Scope discipline (#231 hard constraint, slice 2 unchanged): this file lives
 * under `apps/admin/src/app/(app)/t/[tenantId]/parametres/`. Zero coupling to
 * the backend api / Convex hooks / tenant context — pinned by
 * `coordonnees-editor.test.tsx`'s source-level guards.
 */

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Uber-shaped address components (4-tuple, slice 1 backend contract). Mirrors
 * the `addressComponents` slot on the `tenants` row and on the
 * `tenant.updateSettings` mutation patch validator.
 */
export type AddressComponents = {
  streetAddress: string;
  city: string;
  zipCode: string;
  country: string;
};

/**
 * The Coordonnées sub-object — extended for slice 2 with the structured
 * address siblings persisted alongside the display string. Every field is
 * optional so a fresh tenant (`{}`) is a legitimate seed.
 */
export type CoordonneesValue = {
  /** Display string (Google Places `formattedAddress`). */
  address?: string;
  /** `place.location.lat()` — required to be present together with the rest. */
  addressLat?: number;
  /** `place.location.lng()` — required to be present together with the rest. */
  addressLng?: number;
  /** Parsed components, Uber-shape. */
  addressComponents?: AddressComponents;
  /** FR phone number, user-typed shape. Backend canonicalises. */
  phone?: string;
};

/**
 * Patch shape forwarded to the page's `onSave` handler. Slice 2: the address
 * sub-patch is ALL-OR-NOTHING (the backend throws `INVALID_ADDRESS_PAYLOAD`
 * on any partial address). The four address slots are EITHER all present
 * together (Places selection) or all absent (phone-only change).
 */
export type CoordonneesPatch = {
  address?: string;
  addressLat?: number;
  addressLng?: number;
  addressComponents?: AddressComponents;
  phone?: string;
};

export type CoordonneesEditorProps = {
  /**
   * The current persisted value — seeds the form's defaults AND drives the
   * diff. An empty object is valid.
   */
  value: CoordonneesValue;
  /**
   * Commit handler — receives the diff between the form state and `value`.
   * Empty patch never reaches this callback. The address sub-patch is
   * ALWAYS the complete 4-tuple (never a half-patch).
   */
  onSave: (patch: CoordonneesPatch) => Promise<void>;
};

type CoordonneesFormShape = {
  phone: string;
};

/** Result of `parseGooglePlacesToUberComponents` — discriminated union so the
 *  caller pattern-matches on `ok` and the failure carries an explicit reason
 *  for the inline error surface. */
export type ParseResult =
  | { ok: true; value: AddressComponents }
  | { ok: false; reason: string };

/**
 * Pure FR-phone validator (exported for the unit-test AC).
 *
 * Accepts:
 *  - `0[1-79][0-9]{8}` (10-digit FR number, leading 0, trunk digit ≠ 0/8);
 *  - the same prefixed by `+33` or `0033`.
 *
 * Separators (spaces, dots, dashes) are tolerated anywhere and stripped
 * before matching.
 *
 * Rejects 08 / 00 prefixes, wrong-length numbers, non-numeric characters,
 * empty / whitespace-only input.
 */
export function isValidFrenchPhone(value: string): boolean {
  const stripped = value.replace(/[\s.\-]/g, "");
  if (stripped.length === 0) return false;
  if (stripped.startsWith("+33")) {
    const rest = stripped.slice(3);
    return /^[1-79][0-9]{8}$/.test(rest);
  }
  if (stripped.startsWith("0033")) {
    const rest = stripped.slice(4);
    return /^[1-79][0-9]{8}$/.test(rest);
  }
  return /^0[1-79][0-9]{8}$/.test(stripped);
}

/**
 * Shape we read from a Google Places `AddressComponent`. Matches both the
 * Places API New class (`{ longText, shortText, types }` — with `longText` /
 * `shortText` potentially `null`) and a plain-object test fixture.
 */
type GooglePlacesAddressComponent = {
  types: string[];
  longText: string | null;
  shortText: string | null;
};

/**
 * Slice 2 — Pure parser: Google Places `addressComponents` array → Uber-shape
 * `{ streetAddress, city, zipCode, country }`. Exported so tests can pin every
 * branch in isolation under the lean `node` vitest env.
 *
 *  - `streetAddress` = `street_number + " " + route` (concatenated, trimmed).
 *    Both components are typically present together on a residential / SoHo
 *    pin; one without the other is rare but real (e.g. « Avenue de l'Opéra »
 *    without a number on a plaza pin).
 *  - `city`          = `locality` (`longText`), or `postal_town` as fallback
 *    (UK / Channel-Islands border edge cases that surface near Calais).
 *  - `zipCode`       = `postal_code` (`longText`), must match `^\d{5}$` (FR).
 *  - `country`       = `country` `shortText` (e.g. `"FR"`). MUST be `"FR"`
 *    (V1 France-only, same gate as the backend `isValidAddressPayload`).
 *
 * The parser rejects (returns `{ ok: false, reason }`) on:
 *  - empty `streetAddress` (both `street_number` AND `route` absent / empty);
 *  - missing or wrong-format `zipCode` (not `\d{5}`);
 *  - non-FR country `shortText`.
 *
 * No throws — the caller renders the `reason` as an inline error and keeps
 * the form state untouched (user can pick another suggestion).
 */
export function parseGooglePlacesToUberComponents(
  components: ReadonlyArray<GooglePlacesAddressComponent>,
): ParseResult {
  const findByType = (
    target: string,
  ): GooglePlacesAddressComponent | undefined =>
    components.find((c) => c.types.includes(target));

  const streetNumberText = findByType("street_number")?.longText ?? "";
  const routeText = findByType("route")?.longText ?? "";
  const streetAddress = [streetNumberText, routeText]
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join(" ")
    .trim();
  if (streetAddress.length === 0) {
    return {
      ok: false,
      reason: "Adresse non livrable (numéro et rue manquants).",
    };
  }

  // `locality` is the standard FR city component. `postal_town` is the UK /
  // Crown Dependencies fallback the Geocoder occasionally surfaces — we
  // accept it as a city for robustness (e.g. Channel-Islands border pin).
  const cityText =
    findByType("locality")?.longText ?? findByType("postal_town")?.longText;
  const city = cityText?.trim() ?? "";

  const zipCodeText = findByType("postal_code")?.longText ?? "";
  const zipCode = zipCodeText.trim();
  if (!/^\d{5}$/.test(zipCode)) {
    return {
      ok: false,
      reason:
        "Adresse non livrable (code postal manquant ou hors format français).",
    };
  }

  const countryShort = findByType("country")?.shortText?.trim() ?? "";
  if (countryShort !== "FR") {
    return {
      ok: false,
      reason: "Adresse non livrable (France métropolitaine uniquement).",
    };
  }

  if (city.length === 0) {
    return {
      ok: false,
      reason: "Adresse non livrable (ville manquante).",
    };
  }

  return {
    ok: true,
    value: {
      streetAddress,
      city,
      zipCode,
      country: countryShort,
    },
  };
}

/** Internal shape of the editor's local Places selection state. */
type PlacesSelection = {
  address: string;
  addressLat: number;
  addressLng: number;
  addressComponents: AddressComponents;
};

/**
 * Deep equality of two 4-tuples, used to short-circuit the patch when the
 * Places selection happens to match what's already persisted (no need to
 * re-send the address).
 */
function selectionsEqual(
  a: PlacesSelection,
  b: { address?: string; addressLat?: number; addressLng?: number },
): boolean {
  return (
    a.address === b.address &&
    a.addressLat === b.addressLat &&
    a.addressLng === b.addressLng
  );
}

export function CoordonneesEditor({
  value,
  onSave,
}: CoordonneesEditorProps): React.ReactElement {
  const form = useForm<CoordonneesFormShape>({
    defaultValues: {
      phone: value.phone ?? "",
    },
  });
  const { register, handleSubmit, watch, formState } = form;
  const watchedPhone = watch("phone") ?? "";

  // Inline server-side error.
  const [submitError, setSubmitError] = useState<string | null>(null);

  /**
   * The current Places selection. `null` until the user picks a suggestion.
   * The Save button reads this state to decide whether to include the address
   * 4-tuple in the patch.
   */
  const [placesSelection, setPlacesSelection] =
    useState<PlacesSelection | null>(null);

  /**
   * Inline error from the parser (« Adresse non livrable ») — distinct from
   * `submitError` so a Places rejection doesn't shadow a server-side error
   * from a previous attempt.
   */
  const [placesError, setPlacesError] = useState<string | null>(null);

  // Phone format gate.
  const phoneIsInvalid =
    watchedPhone.length > 0 && !isValidFrenchPhone(watchedPhone);

  // Legacy warning: `value.address` set but `value.addressLat` missing → the
  // tenant predates the address-first refonte (pre-slice-1). Force a re-pick.
  const isLegacyAddress =
    value.address !== undefined &&
    value.address.length > 0 &&
    value.addressLat === undefined;

  // Diff signals.
  const addressDiffers =
    placesSelection !== null &&
    !selectionsEqual(placesSelection, {
      address: value.address,
      addressLat: value.addressLat,
      addressLng: value.addressLng,
    });
  const trimmedPhone = watchedPhone.trim();
  const phoneDiffers =
    trimmedPhone.length > 0 && trimmedPhone !== (value.phone ?? "");
  const hasAnyDiff = addressDiffers || phoneDiffers;

  // Save disabled when:
  //  - submitting;
  //  - phone is invalid;
  //  - the legacy warning is showing AND no Places selection has been made
  //    yet (the user MUST re-pick before saving — defensive against
  //    accidentally persisting the legacy address as-is);
  //  - nothing has changed (empty patch — no point in calling onSave).
  const saveDisabled =
    formState.isSubmitting ||
    phoneIsInvalid ||
    (isLegacyAddress && placesSelection === null) ||
    !hasAnyDiff;

  // Build the patch — slice 2 contract: address sub-patch is all-or-nothing.
  const buildPatch = (data: CoordonneesFormShape): CoordonneesPatch | null => {
    const patch: CoordonneesPatch = {};
    if (addressDiffers && placesSelection !== null) {
      patch.address = placesSelection.address;
      patch.addressLat = placesSelection.addressLat;
      patch.addressLng = placesSelection.addressLng;
      patch.addressComponents = placesSelection.addressComponents;
    }
    const formPhone = data.phone.trim();
    if (formPhone.length > 0 && formPhone !== (value.phone ?? "")) {
      patch.phone = formPhone;
    }
    if (Object.keys(patch).length === 0) return null;
    return patch;
  };

  const onSubmit = async (data: CoordonneesFormShape): Promise<void> => {
    setSubmitError(null);
    // Defence-in-depth phone gate (matches the disabled button).
    if (data.phone.length > 0 && !isValidFrenchPhone(data.phone)) {
      setSubmitError(
        "Le numéro de téléphone n'est pas dans un format français valide.",
      );
      return;
    }
    const patch = buildPatch(data);
    if (patch === null) return;
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

  // ── Google Places autocomplete element ─────────────────────────────────
  //
  // Mounted in a `useEffect` with a DYNAMIC `import("@googlemaps/js-api-loader")`
  // — see file header for why this is mandatory under Next 16 SSR (memory:
  // `googlemaps-loader-ssr-bug`). Pattern replicated from the PWA's
  // `address-first-form.tsx` (apps/web).
  //
  // On `gmp-select`:
  //  - `.toPlace()` resolves the prediction to a Place;
  //  - `fetchFields` pulls `formattedAddress`, `location`, `addressComponents`;
  //  - the pure parser maps Google's components to the Uber shape;
  //  - on parser rejection (`{ ok: false }`), we surface `placesError` and
  //    leave `placesSelection` untouched (no half-state);
  //  - on parser acceptance, we set `placesSelection` (Save button enables
  //    if the 4-tuple differs from `value` and the phone gate is satisfied).
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      setPlacesError(
        "Configuration manquante (NEXT_PUBLIC_GOOGLE_PLACES_API_KEY). Contacte le support.",
      );
      return;
    }
    if (containerRef.current === null) return;
    const container = containerRef.current;
    let cancelled = false;
    let mountedElement: google.maps.places.PlaceAutocompleteElement | null =
      null;

    // DYNAMIC import — see file header. The static form would crash SSR.
    void import("@googlemaps/js-api-loader")
      .then(({ setOptions, importLibrary }) => {
        if (cancelled) return undefined;
        setOptions({ key: apiKey, v: "weekly", libraries: ["places"] });
        return importLibrary("places");
      })
      .then((places) => {
        if (places === undefined || cancelled) return;
        const element = new places.PlaceAutocompleteElement({
          includedRegionCodes: ["fr"],
          includedPrimaryTypes: ["street_address", "premise"],
        });
        // Silent pre-fill — the New API exposes `value` directly on the
        // element (no `<input defaultValue>` indirection).
        if (value.address !== undefined && value.address.length > 0) {
          element.value = value.address;
        }
        element.addEventListener("gmp-select", (event) => {
          void (async () => {
            try {
              const place = event.placePrediction.toPlace();
              await place.fetchFields({
                fields: ["formattedAddress", "location", "addressComponents"],
              });
              const formattedAddress = place.formattedAddress;
              const lat = place.location?.lat();
              const lng = place.location?.lng();
              const rawComponents = place.addressComponents;
              if (
                typeof formattedAddress !== "string" ||
                lat === undefined ||
                lng === undefined ||
                rawComponents === undefined
              ) {
                setPlacesError(
                  "Impossible de résoudre cette adresse — choisis-en une autre.",
                );
                return;
              }
              const parsed = parseGooglePlacesToUberComponents(
                rawComponents.map((c) => ({
                  types: c.types,
                  longText: c.longText,
                  shortText: c.shortText,
                })),
              );
              if (!parsed.ok) {
                setPlacesError(parsed.reason);
                return;
              }
              setPlacesError(null);
              setPlacesSelection({
                address: formattedAddress,
                addressLat: lat,
                addressLng: lng,
                addressComponents: parsed.value,
              });
            } catch (err) {
              setPlacesError(
                err instanceof Error
                  ? err.message
                  : "Impossible de récupérer l'adresse, réessaie.",
              );
            }
          })();
        });
        container.appendChild(element);
        mountedElement = element;
      })
      .catch(() => {
        if (cancelled) return;
        setPlacesError(
          "Impossible de charger les suggestions d'adresse. Réessaie dans un moment.",
        );
      });

    return () => {
      cancelled = true;
      if (mountedElement !== null) {
        mountedElement.remove();
      }
    };
    // We deliberately omit deps — re-mounting Places on every render would
    // thrash the SDK. The initial `value.address` is captured once for the
    // silent pre-fill; subsequent value mutations re-mount via the parent's
    // `key` invalidation strategy (cf. `parametres-view.tsx` `coordonneesEditorKey`).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const phoneInputId = "parametres-coordonnees-phone-id";

  return (
    <form
      data-slot="parametres-coordonnees-form"
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-5"
    >
      <h2 className="sr-only">Coordonnées</h2>

      {/* Legacy warning — fires for pre-slice-1 tenants whose `address` is
          set but who have no `addressLat`. Force a re-pick before allowing
          save (the legacy display string alone is not enough to power the
          Uber Direct quote chain). */}
      {isLegacyAddress && placesSelection === null ? (
        <div
          data-slot="parametres-coordonnees-legacy-warning"
          className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-900"
          role="alert"
        >
          Adresse à re-saisir via la recherche pour réactiver la livraison Uber
          Direct.
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="parametres-coordonnees-address-id">Adresse</Label>
        {/* Google Places autocomplete element mounted here by the effect
            above. Free-typing is forbidden — only a selection from the
            suggestions list updates `placesSelection`. */}
        <div
          ref={containerRef}
          id="parametres-coordonnees-address-id"
          data-slot="parametres-coordonnees-places-container"
        />
        <p className="text-muted-foreground text-xs">
          Recherche l&apos;adresse complète du restaurant et clique une
          suggestion. Utilisée pour l&apos;affichage public et pour la zone de
          livraison Uber Direct.
        </p>
        {placesError !== null ? (
          <p
            data-slot="parametres-coordonnees-places-error"
            className="text-destructive text-xs"
          >
            {placesError}
          </p>
        ) : null}
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
          disabled={saveDisabled}
        >
          Enregistrer
        </Button>
      </div>
    </form>
  );
}
