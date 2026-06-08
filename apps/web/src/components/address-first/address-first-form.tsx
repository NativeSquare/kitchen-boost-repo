"use client";

/**
 * PWA-S3 (#451) — `<AddressFirstForm>`: the address-first entry point of the
 * PWA Client (PRD §10 PWA Client, decisions-log Q7).
 *
 * Owns the IO that the pure `decideAddressFirstAction` (`lib/address-first/`)
 * deliberately keeps out:
 *  - Loads `@googlemaps/js-api-loader` with the public Places API key (env
 *    `NEXT_PUBLIC_GOOGLE_PLACES_API_KEY`, HTTP-referrer-restricted in Google
 *    Cloud Console — cf. issue body « lue depuis env, pas hardcodée »).
 *  - Mounts a `PlaceAutocompleteElement` (Places API New) restricted to
 *    `includedRegionCodes: ["fr"]` + `includedPrimaryTypes: ["street_address",
 *    "premise"]` (Q7 (1), refactor 2026-06-08 from the legacy
 *    `places.Autocomplete` widget — that one requires the deprecated Places
 *    API legacy SKU which we no longer enable in Google Cloud).
 *  - On a suggestion SELECTION (= auto-validate, NOT a separate « Valider »
 *    button — US 3 saves one tap), chains:
 *       `signIn("anonymous")` (if not already authenticated)
 *       → `mutation getOrCreateCurrentCustomer({ tenantId })`
 *       → `mutation updateAddress({ tenantId, address, lat, lng })`
 *       → `action requestDeliveryQuote({ tenantId, address })`
 *  - Branches on the verdict via `decideAddressFirstAction` (PURE, unit-tested
 *    in `lib/address-first/decide-address-first-action.test.ts`):
 *       - `redirect` → `router.push("/menu")` (verdict carries fee/eta/quoteId
 *         so /menu can show the toggle without re-quoting — PRD Q7 (3))
 *       - `show-message` → inline message; surfaces a Retry button if
 *         `canRetry` (surge, US 7) or a CTA to switch to C&C if `cta` is
 *         present (hors_zone, US 5).
 *  - Editing the address AFTER a verdict re-fires the chain from
 *    `updateAddress` onwards (US: « édit adresse après validation re-fire
 *    quote »); the signIn step is skipped on subsequent submits (idempotent
 *    `getOrCreateCurrentCustomer` + already-authenticated session).
 *
 * Pre-fill (returning Sophie): `initialAddress` is the silent pre-fill of the
 * input (the « Bonjour {firstName} » banner is deferred to PWA-S12 #464 —
 * decisions-log Q3). The form does NOT auto-fire the chain on pre-fill: the
 * user must explicitly re-select a Places suggestion to confirm (avoids
 * silently re-quoting a stale cached address every visit).
 *
 * The component is client-only (`"use client"`) — Google Places SDK + Convex
 * hooks both require the browser. Rendered by the RSC `app/page.tsx`, which
 * does the SSR pre-fill via `preloadQuery(getCurrentCustomer)`.
 */
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { importLibrary, setOptions } from "@googlemaps/js-api-loader";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  type AddressFirstAction,
  type DeliveryQuoteReason,
  decideAddressFirstAction,
} from "@/lib/address-first";
import { encodeVerdict, VERDICT_STORAGE_KEY } from "@/lib/delivery-mode";
import { WalletPromptCard } from "@/components/wallet-prompt";

/**
 * Narrowed shape of `AddressFirstAction` when the verdict is non-deliverable.
 * Extracted as a discriminated alias so the `<MessageBanner>` subcomponent
 * does not have to re-narrow on every JSX line.
 */
type ShowMessageAction = Extract<AddressFirstAction, { kind: "show-message" }>;

/**
 * Texts the form renders for the 3 non-deliverable reasons. The pure decision
 * `decideAddressFirstAction` returns the `reason` ENUM (machine-stable); this
 * map turns it into French user-facing copy (decisions-log Q7 wordings).
 */
const REASON_COPY: Record<DeliveryQuoteReason, string> = {
  hors_zone:
    "Trop éloignée pour la livraison depuis ce resto. Tu peux passer prendre ta commande sur place.",
  hors_horaire:
    "Le resto est fermé pour le moment. Reviens à l'ouverture pour commander.",
  surge: "Indisponible à cet horaire, réessaie dans quelques minutes.",
};

/** Spinner copy (Q7 (2): « On vérifie la livraison… »). */
const SPINNER_LABEL = "On vérifie la livraison…";

export type AddressFirstFormProps = {
  /** The resolved tenantId from `__Host-kb_tenant` (RSC reads the cookie). */
  tenantId: Id<"tenants">;
  /** Silent pre-fill for returning Sophie (PWA-S12 adds the « Bonjour » UX). */
  initialAddress?: string;
};

type FormState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "result"; action: AddressFirstAction }
  | { kind: "error"; message: string };

export function AddressFirstForm({
  tenantId,
  initialAddress,
}: AddressFirstFormProps): React.JSX.Element {
  // `PlaceAutocompleteElement` is a custom HTML element from Places API (New)
  // — it owns its own input internally, so we mount it into a container div
  // (vs the previous legacy widget that attached to our own `<input>`).
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { signIn } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const getOrCreateCurrentCustomer = useMutation(
    api.lib.customer.identity.getOrCreateCurrentCustomer,
  );
  const updateAddress = useMutation(api.lib.customer.address.updateAddress);
  const requestDeliveryQuote = useAction(
    api.lib.delivery.quote.requestDeliveryQuote,
  );

  // Latest selected suggestion — kept in a ref so the Retry handler can re-fire
  // the chain with the same address without re-opening Places Autocomplete.
  const lastSelectionRef = useRef<{
    address: string;
    lat: number;
    lng: number;
  } | null>(null);

  const [state, setState] = useState<FormState>({ kind: "idle" });

  /**
   * Run the address-first chain for an explicit Places selection. Called by:
   *  - the Autocomplete `place_changed` listener (initial submit), and
   *  - the Retry button on the `surge` branch (re-fires from `requestQuote`
   *    only — signIn / provisioning / updateAddress are already done).
   */
  const runChain = async (
    selection: { address: string; lat: number; lng: number },
    options: { skipPersist?: boolean } = {},
  ): Promise<void> => {
    setState({ kind: "loading" });
    try {
      if (!options.skipPersist) {
        if (!isAuthenticated) {
          // Anonymous provider — no params (the profile callback ignores
          // them anyway, cf. anonymousProfile in `packages/backend/convex/
          // auth.ts`). Stamps the Convex Auth session cookie (HttpOnly,
          // Secure, host-only — ADR 0008).
          await signIn("anonymous", {});
        }
        // Provision the fiche idempotently, then persist the Places selection.
        // The mutations are tenant-scoped via the `customerMutation` wrapper.
        await getOrCreateCurrentCustomer({ tenantId });
        await updateAddress({
          tenantId,
          address: selection.address,
          lat: selection.lat,
          lng: selection.lng,
        });
      }
      const verdict = await requestDeliveryQuote({
        tenantId,
        address: selection.address,
      });
      // PWA-S5 (#453) : cache the verdict in localStorage so
      // `<DeliveryModeProvider>` on /menu and /panier can derive the
      // initial toggle state + switch modes without re-quoting Uber
      // (decisions-log Q7 « verdict cache 2 modes »). Swallow quota /
      // privacy-mode errors — the cart already handles « no verdict »
      // as the C&C-default branch.
      try {
        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            VERDICT_STORAGE_KEY,
            encodeVerdict(verdict),
          );
        }
      } catch {
        // Quota / privacy mode — non-fatal; the cart degrades gracefully.
      }
      const action = decideAddressFirstAction(verdict);
      setState({ kind: "result", action });
      // PWA-S9a (#460) : `kind === "redirect"` no longer navigates immediately
      // — the form renders `<WalletPromptCard>` (palier 1 of the 3-paliers
      // Wallet install moat, decisions-log Q5 + US 27) and only navigates to
      // `action.path` when the user clicks « Plus tard » OR the Convex sub
      // flips `walletStatus = "enrolled"`. Both exits route through the
      // card's `onSkip` handler, which calls `router.push(action.path)`.
      // Returning Sophie with `walletStatus = "enrolled"` already gets a
      // no-op card (decideWalletPromptVisibility → hidden, useEffect fires
      // onSkip immediately) — preserves the « zero-friction redirect » UX
      // of returning customers who already converted.
    } catch (err) {
      setState({
        kind: "error",
        message:
          err instanceof Error
            ? err.message
            : "Erreur inattendue, réessaie dans un moment.",
      });
    }
  };

  // Mount `PlaceAutocompleteElement` (Places API New) inside the container.
  // The loader is cached internally so mounting twice (Fast Refresh / strict
  // mode) does not re-fetch the SDK. Refactor 2026-06-08 — the previous
  // legacy `places.Autocomplete` widget hit `LegacyApiNotActivatedMapError`
  // unless the deprecated legacy Places API SKU was also enabled in GCP,
  // which we explicitly do NOT enable (V1 stays on the New SKU only).
  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY;
    if (!apiKey) {
      // Missing key is a deploy misconfig — surface it loudly to the user
      // rather than silently breaking the autocomplete. Avoids the « form
      // looks fine but does nothing on type » failure mode.
      setState({
        kind: "error",
        message:
          "Configuration manquante (NEXT_PUBLIC_GOOGLE_PLACES_API_KEY). Contacte le support.",
      });
      return;
    }
    if (containerRef.current === null) return;

    const container = containerRef.current;
    let cancelled = false;
    let mountedElement: google.maps.places.PlaceAutocompleteElement | null =
      null;
    // Functional loader API (`setOptions` + `importLibrary` from
    // `@googlemaps/js-api-loader`). `setOptions` is a no-op after the first
    // call within the same session, so re-mounting (Fast Refresh / strict
    // mode) does not re-fetch the SDK.
    setOptions({ key: apiKey, v: "weekly", libraries: ["places"] });

    importLibrary("places")
      .then((places) => {
        if (cancelled) return;
        const element = new places.PlaceAutocompleteElement({
          includedRegionCodes: ["fr"],
          includedPrimaryTypes: ["street_address", "premise"],
        });
        // Silent pre-fill for returning Sophie (PWA-S12 #464). The New API
        // exposes `value` directly on the element (vs the legacy widget that
        // needed `<input defaultValue>`).
        if (initialAddress !== undefined) {
          element.value = initialAddress;
        }
        element.addEventListener("gmp-select", (event) => {
          // `gmp-select` carries a `PlacePredictionSelectEvent`. We call
          // `.toPlace()` and `fetchFields` to get the resolved address +
          // coordinates — the session token billing is handled automatically
          // by the SDK (same session covers query + selection).
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
                // The user picked something Google could not resolve to a
                // street address — keep the current state, do not fire the
                // chain. V1 forbids free typing (decision 2026-05-23) so a
                // non-suggestion submit is silently ignored.
                return;
              }
              lastSelectionRef.current = { address, lat, lng };
              void runChain({ address, lat, lng });
            } catch (err) {
              setState({
                kind: "error",
                message:
                  err instanceof Error
                    ? err.message
                    : "Impossible de récupérer l'adresse, réessaie.",
              });
            }
          })();
        });
        container.appendChild(element);
        mountedElement = element;
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          kind: "error",
          message:
            "Impossible de charger les suggestions d'adresse. Réessaie dans un moment.",
        });
      });

    return () => {
      cancelled = true;
      if (mountedElement !== null) {
        mountedElement.remove();
      }
    };
    // We deliberately omit `runChain` from deps — it closes over latest state
    // through `lastSelectionRef` / setState, and re-mounting Places on every
    // render would thrash the SDK. The mutation/action handles are stable
    // (Convex returns the same fn ref unless the api shape changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onRetry = (): void => {
    if (lastSelectionRef.current === null) return;
    // Retry only re-fires `requestDeliveryQuote` for the SAME address — signIn
    // + provisioning + persist were already done on the first attempt.
    void runChain(lastSelectionRef.current, { skipPersist: true });
  };

  const onCtaClick = (path: string): void => {
    router.push(path);
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-700">
          Ton adresse de livraison
        </span>
        {/* The `<gmp-place-autocomplete>` web component is mounted here in
            the effect above. Tailwind styles the wrapping container; the
            element itself uses Google's default design (CSS shadow parts
            can be tuned post-V1 if needed). */}
        <div
          ref={containerRef}
          className="w-full"
          aria-label="Adresse de livraison"
        />
      </label>

      {state.kind === "loading" && (
        <p role="status" aria-live="polite" className="text-sm text-zinc-600">
          {SPINNER_LABEL}
        </p>
      )}

      {state.kind === "result" && state.action.kind === "show-message" && (
        <MessageBanner
          action={state.action}
          onCtaClick={onCtaClick}
          onRetry={onRetry}
        />
      )}

      {/* PWA-S9a (#460) — palier 1 Wallet install card, rendered AFTER a
          deliverable verdict in place of the immediate `router.push`. The
          card's `onSkip` (« Plus tard » OR Convex sub flip on enrollment)
          navigates to the destination the verdict carried (`/menu`). The
          path is captured once at render so the onSkip closure does not
          have to re-narrow `state.action.kind` inside the callback. */}
      {state.kind === "result" &&
        state.action.kind === "redirect" &&
        (() => {
          const destination = state.action.path;
          return (
            <WalletPromptCard
              tenantId={tenantId}
              onSkip={() => router.push(destination)}
            />
          );
        })()}

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
    </div>
  );
}

/**
 * Renders the non-deliverable verdict banner (hors_zone / hors_horaire / surge)
 * with the optional CTA (C&C on hors_zone) and the optional Retry button
 * (surge). Extracted from the form so the deeply-nested `state.action.kind` /
 * `cta` narrowings happen once per render, in one place, on a discriminated
 * `ShowMessageAction` rather than re-narrowed inside every onClick.
 */
function MessageBanner({
  action,
  onCtaClick,
  onRetry,
}: {
  action: ShowMessageAction;
  onCtaClick: (path: string) => void;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-left"
    >
      <p className="text-sm text-black">{REASON_COPY[action.reason]}</p>
      {action.cta !== undefined &&
        (() => {
          // Capture once so TS narrows it cleanly inside the callback (the
          // outer narrowing would not survive the closure).
          const cta = action.cta;
          return (
            <button
              type="button"
              onClick={() => onCtaClick(cta.path)}
              className="self-start rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              {cta.label}
            </button>
          );
        })()}
      {action.canRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-black hover:bg-zinc-100"
        >
          Réessayer
        </button>
      )}
    </div>
  );
}
