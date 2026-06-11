"use client";

/**
 * Reusable Google Places address input (extracted from `<AddressFirstForm>`,
 * PWA-S3 #451) so BOTH the full-page form AND the `<DeliveryAddressSheet>` mount
 * the SAME `PlaceAutocompleteElement` with the SAME FR/street restrictions and
 * the SAME dynamic-import discipline — no copy-paste.
 *
 * Mounts a `PlaceAutocompleteElement` (Places API New) restricted to
 * `includedRegionCodes: ["fr"]` + `includedPrimaryTypes: ["street_address",
 * "premise"]`. On a suggestion selection it resolves `formattedAddress` +
 * `location` and calls `onSelect({ address, lat, lng })`.
 *
 * CRITICAL — DYNAMIC import obligatoire : `@googlemaps/js-api-loader@2.x` lit
 * `window` au top-level du module, ce qui jette « window is not defined » dès
 * l'évaluation SSR de Next 16 (même en `"use client"`). Le lazy `import()` dans
 * le `useEffect` retarde l'évaluation au mount client où `window` existe. NE
 * JAMAIS ajouter d'import statique top-level du loader.
 */
import { useEffect, useRef } from "react";
import type { AddressSelection } from "@/lib/address-first/use-address-quote-chain";

export type PlacesAddressInputProps = {
  /** Called with the resolved selection when the user picks a suggestion. */
  onSelect: (selection: AddressSelection) => void;
  /** Called when the SDK key is missing or the loader/mount fails. */
  onError: (message: string) => void;
  /** Silent pre-fill (returning Sophie). The user must still re-select. */
  initialAddress?: string;
  /** Optional class on the mount container. */
  className?: string;
  /** Accessible label for the mount container. */
  ariaLabel?: string;
};

export function PlacesAddressInput({
  onSelect,
  onError,
  initialAddress,
  className,
  ariaLabel,
}: PlacesAddressInputProps): React.JSX.Element {
  // `PlaceAutocompleteElement` is a custom HTML element from Places API (New) —
  // it owns its own input internally, so we mount it into a container div.
  const containerRef = useRef<HTMLDivElement>(null);
  // Keep the latest callbacks in refs so we can mount Places ONCE (empty deps)
  // without thrashing the SDK on every parent re-render, while still calling the
  // freshest handler from inside the `gmp-select` listener. The ref sync happens
  // in an effect (NOT during render — refs are write-during-commit only).
  const onSelectRef = useRef(onSelect);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onSelectRef.current = onSelect;
    onErrorRef.current = onError;
  }, [onSelect, onError]);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      // Missing key is a deploy misconfig — surface it loudly rather than
      // silently breaking the autocomplete.
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

    // DYNAMIC import obligatoire — cf. file header. The functional loader API
    // (`setOptions` + `importLibrary`) caches the SDK internally so re-mounting
    // (Fast Refresh / strict mode) does not re-fetch it.
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
                // Google could not resolve a street address — V1 forbids free
                // typing (decision 2026-05-23), so silently ignore.
                return;
              }
              onSelectRef.current({ address, lat, lng });
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
      if (mountedElement !== null) {
        mountedElement.remove();
      }
    };
    // Mount ONCE — callbacks are read through refs (see above), `initialAddress`
    // is a one-shot pre-fill. Re-mounting Places on every render would thrash
    // the SDK.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} className={className} aria-label={ariaLabel} />
  );
}
