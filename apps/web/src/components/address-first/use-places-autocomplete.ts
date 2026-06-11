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
 * MOUNT TIMING (callback ref, NOT an object ref): the widget is mounted by an
 * effect keyed on the container NODE, set through a callback ref. The earlier
 * object-ref + `useEffect([])` version read `containerRef.current` ONCE and
 * bailed when it was `null` — which is exactly what happens inside a Vaul Drawer,
 * whose portal content mounts in a LATER commit (open animation) than the
 * consuming component. The effect bailed and never retried, so the field never
 * appeared in the bottom sheet (on the full-page form the div is present
 * immediately, so it happened to work). A callback ref re-runs the mount effect
 * the moment the node actually attaches — late attach included — and tears the
 * widget down when it detaches (drawer close), then re-mounts on re-open.
 *
 * Contract:
 *  - `containerRef` — a callback ref to attach to the `<div>` the widget mounts
 *    into (`ref={containerRef}`).
 *  - `initialAddress` — optional silent pre-fill (returning Sophie / EDIT mode
 *    of the sheet pre-filled with the current address). Read at mount time via a
 *    ref, so a later change does not thrash-remount the widget.
 *  - `onSelectionPicked` — called with `{ address, lat, lng }` once the user
 *    selects a resolvable Places suggestion (the caller fires its quote chain).
 *  - `onError` — surfaced to the caller's own state (missing API key = deploy
 *    misconfig, SDK load failure, unresolvable selection).
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
  containerRef: (node: HTMLDivElement | null) => void;
} {
  // The container NODE, set via a callback ref so the mount effect fires when it
  // actually attaches (robust to Vaul's deferred portal mount — see file docs).
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const containerRef = useCallback((node: HTMLDivElement | null) => {
    setContainer(node);
  }, []);

  // Keep the latest callbacks + initial pre-fill in refs so the mount effect is
  // keyed ONLY on the container node (re-mounting Places on every render would
  // thrash the SDK) while still reading the freshest closures. Written in a
  // layout effect (NOT during render) to satisfy the React Compiler's « no ref
  // access during render » rule.
  const onSelectionPickedRef = useRef(onSelectionPicked);
  const onErrorRef = useRef(onError);
  const initialAddressRef = useRef(initialAddress);
  useLayoutEffect(() => {
    onSelectionPickedRef.current = onSelectionPicked;
    onErrorRef.current = onError;
    initialAddressRef.current = initialAddress;
  });

  useEffect(() => {
    if (container === null) return;

    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      onErrorRef.current(
        "Configuration manquante (NEXT_PUBLIC_GOOGLE_PLACES_API_KEY). Contacte le support.",
      );
      return;
    }

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
        const prefill = initialAddressRef.current;
        if (prefill !== undefined) {
          element.value = prefill;
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
    // Keyed on the container node: mounts when it attaches (incl. late, inside a
    // Vaul Drawer), tears down + re-mounts on detach/re-attach. Callbacks +
    // pre-fill are read through refs, the api key is stable.
  }, [container]);

  return { containerRef };
}
