"use client";

/**
 * FEATURE B (#reusable delivery-address sheet) — the Google Places
 * `PlaceAutocompleteElement` mounting logic, extracted from `<AddressFirstForm>`
 * so BOTH the full-page address-first form AND the reusable delivery-address
 * sheet mount the SAME widget through ONE code path (DRY — issue spec). The
 * extraction is behaviour-preserving: the form keeps its exact observable flow.
 *
 * CRITICAL guardrail (`googlemaps-loader-ssr-bug`): `@googlemaps/js-api-loader@2.x`
 * touches `window` at module top-level and breaks Next 16 SSR (500 in prod). The
 * loader MUST be brought in via a DYNAMIC `import()` INSIDE the effect (never a
 * static top-level import) — this hook preserves exactly that pattern.
 *
 * Contract:
 *  - `containerRef` — attach to the `<div>` the widget mounts into.
 *  - `initialAddress` — optional silent pre-fill (returning Sophie / EDIT mode
 *    of the sheet pre-filled with the current address).
 *  - `onSelectionPicked` — called with `{ address, lat, lng }` once the user
 *    selects a resolvable Places suggestion (the caller fires its quote chain).
 *  - `onError` — surfaced to the caller's own state (missing API key = deploy
 *    misconfig, SDK load failure, unresolvable selection).
 */
import { useEffect, useLayoutEffect, useRef } from "react";

export type PlacesSelection = { address: string; lat: number; lng: number };

export type UsePlacesAutocompleteArgs = {
  initialAddress?: string;
  onSelectionPicked: (selection: PlacesSelection) => void;
  onError: (message: string) => void;
};

export function usePlacesAutocomplete({
  initialAddress,
  onSelectionPicked,
  onError,
}: UsePlacesAutocompleteArgs): {
  containerRef: React.RefObject<HTMLDivElement | null>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks in refs so the mount effect runs ONCE (re-mounting
  // Places on every render would thrash the SDK) while still calling the freshest
  // closures — same trade-off the original form documented. The refs are written
  // in a layout effect (NOT during render) to satisfy the React Compiler's
  // « no ref access during render » rule.
  const onSelectionPickedRef = useRef(onSelectionPicked);
  const onErrorRef = useRef(onError);
  useLayoutEffect(() => {
    onSelectionPickedRef.current = onSelectionPicked;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      onErrorRef.current(
        "Configuration manquante (NEXT_PUBLIC_GOOGLE_PLACES_API_KEY). Contacte le support.",
      );
      return;
    }
    if (containerRef.current === null) return;

    const container = containerRef.current;
    let cancelled = false;
    let mountedElement: google.maps.places.PlaceAutocompleteElement | null =
      null;

    // DYNAMIC import obligatoire (guardrail googlemaps-loader-ssr-bug) :
    // `@googlemaps/js-api-loader@2.x` lit `window` au top-level du module, ce qui
    // jette en SSR Next 16 — même en `"use client"`. Le lazy `import()` retarde
    // l'évaluation au mount client où `window` existe.
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
        if (initialAddress !== undefined) {
          element.value = initialAddress;
        }
        element.addEventListener("gmp-select", (event) => {
          void (async () => {
            try {
              const place = event.placePrediction.toPlace();
              await place.fetchFields({
                fields: ["formattedAddress", "location"],
              });
              const address = place.formattedAddress;
              const lat = place.location?.lat();
              const lng = place.location?.lng();
              if (
                typeof address !== "string" ||
                lat === undefined ||
                lng === undefined
              ) {
                // Unresolvable selection — V1 forbids free typing, so silently
                // ignore (keep the caller's current state).
                return;
              }
              onSelectionPickedRef.current({ address, lat, lng });
            } catch (err) {
              onErrorRef.current(
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
        onErrorRef.current(
          "Impossible de charger les suggestions d'adresse. Réessaie dans un moment.",
        );
      });

    return () => {
      cancelled = true;
      if (mountedElement !== null) mountedElement.remove();
    };
    // Mount once: callbacks are read through refs, the api key is stable.
    // `initialAddress` is the silent pre-fill captured at first mount (a later
    // change does not re-mount the widget — same as the original form).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef };
}
