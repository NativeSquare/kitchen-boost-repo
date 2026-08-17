"use client";

/**
 * PWA-S3 (#451) — `<AddressFirstForm>`: the address-first entry point of the
 * PWA Client (PRD §10 PWA Client, decisions-log Q7).
 *
 * Owns the IO that the pure `decideAddressFirstAction` (`lib/address-first/`)
 * deliberately keeps out, but DELEGATES the two reusable pieces to shared hooks
 * so the reusable delivery-address sheet (Feature B) replays the SAME logic
 * (DRY — issue spec). This refactor is BEHAVIOUR-PRESERVING: the A.1 flow
 * (address → deliverable → palier 1 Wallet card → /menu) is unchanged.
 *  - `usePlacesAutocomplete` — mounts the `PlaceAutocompleteElement` (Places API
 *    New), loaded via DYNAMIC `import()` of `@googlemaps/js-api-loader` INSIDE a
 *    useEffect (MANDATORY guardrail `googlemaps-loader-ssr-bug` — never a static
 *    top-level import).
 *  - `useAddressQuoteChain` — on a suggestion SELECTION (= auto-validate, no
 *    « Valider » button), chains `signIn("anonymous")` → `getOrCreateCurrentCustomer`
 *    → `updateAddress` → `requestDeliveryQuote`, caches the verdict in
 *    localStorage (`<DeliveryModeProvider>` reads it on /menu + /panier).
 *
 * Branches on the verdict via `decideAddressFirstAction` (PURE, unit-tested):
 *  - `redirect` → renders `<WalletPromptCard>` (palier 1 of the 3-paliers Wallet
 *    install moat, #460) and navigates to `/menu` on « Plus tard » OR on
 *    enrollment (the card's `onSkip`).
 *  - `show-message` → inline message; surfaces a Retry button if `canRetry`
 *    (surge) or a C&C CTA if `cta` (hors_zone).
 *
 * Pre-fill (returning Sophie): `initialAddress` is the silent pre-fill of the
 * input. When the stored 3-tuple is complete (`initialAddress` + `initialLat`
 * + `initialLng`, all threaded from `getCurrentCustomer` via the RSC parent),
 * the form renders a PRIMARY « Confirmer · Voir le menu » CTA (REC #464 + #451)
 * that re-fires the SAME `submit(...)` chain from the KNOWN coordinates — ONE
 * TAP, no re-typing. The Places field stays available below it for MODIFYING
 * the address (re-selection still works exactly as before). The CTA is hidden
 * the moment the chain is loading or a verdict is being shown, so the verdict
 * UI (Wallet card / message) renders EXACTLY as a fresh selection would.
 *
 * First-time visitors (no `initialAddress`) see NO confirm CTA — the original
 * fresh-address flow is entirely unchanged (behaviour-preserving for A.1).
 */
import { useRouter } from "next/navigation";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  type AddressFirstAction,
  type DeliveryQuoteReason,
  decideAddressFirstAction,
} from "@/lib/address-first";
import { WalletPromptCard } from "@/components/wallet-prompt";
import { usePlacesAutocomplete } from "./use-places-autocomplete";
import { useAddressQuoteChain } from "./use-address-quote-chain";

/**
 * Narrowed shape of `AddressFirstAction` when the verdict is non-deliverable.
 */
type ShowMessageAction = Extract<AddressFirstAction, { kind: "show-message" }>;

/**
 * Texts the form renders for the 3 non-deliverable reasons (decisions-log Q7).
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
  /** Stored coordinates for the ONE-TAP confirm (REC #464). Both must be
   *  defined alongside `initialAddress` for the « Confirmer » CTA to render. */
  initialLat?: number;
  initialLng?: number;
};

export function AddressFirstForm({
  tenantId,
  initialAddress,
  initialLat,
  initialLng,
}: AddressFirstFormProps): React.JSX.Element {
  const router = useRouter();
  const { state, submit, retry, setError, lastSelection } =
    useAddressQuoteChain({ tenantId });
  const { containerRef } = usePlacesAutocomplete({
    initialAddress,
    onSelectionPicked: submit,
    onError: setError,
  });

  // The verdict is mapped to the UI action lazily at render (pure decision).
  const action: AddressFirstAction | null =
    state.kind === "verdict" ? decideAddressFirstAction(state.verdict) : null;

  // REC (#464 + #451) — the ONE-TAP confirm is offered only when the stored
  // 3-tuple is complete (address + lat + lng), and only while we are still at
  // the entry state (idle/error): once the chain is loading or a verdict is
  // shown, the spinner / Wallet card / message owns the UI. A trivial boolean
  // (per the guardrail: prefer the lighter option over a pure decide-* fn).
  const canConfirmStored =
    initialAddress !== undefined &&
    initialLat !== undefined &&
    initialLng !== undefined;
  const showConfirmCta =
    canConfirmStored && state.kind !== "loading" && action === null;

  const onConfirmStored = (): void => {
    if (
      initialAddress === undefined ||
      initialLat === undefined ||
      initialLng === undefined
    ) {
      return;
    }
    // Re-fire the EXACT same chain a fresh Places selection would
    // (getOrCreate → updateAddress → requestDeliveryQuote → decide-action).
    submit({ address: initialAddress, lat: initialLat, lng: initialLng });
  };

  const onRetry = (): void => {
    if (lastSelection === null) return;
    retry(lastSelection);
  };

  const onCtaClick = (path: string): void => {
    router.push(path);
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      {/* REC (#464 + #451) — PRIMARY ONE-TAP confirm for a recognised returning
          customer: re-fires the delivery quote from the stored 3-tuple, no
          re-typing. Hidden once loading / a verdict is shown so the verdict UI
          owns the screen. First-time visitors never see this (no stored tuple). */}
      {showConfirmCta && (
        <button
          type="button"
          onClick={onConfirmStored}
          data-testid="confirm-stored-address"
          className="w-full rounded-lg bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800"
        >
          Confirmer · Voir le menu
        </button>
      )}

      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-700">
          {showConfirmCta
            ? "ou modifie ton adresse de livraison"
            : "Ton adresse de livraison"}
        </span>
        {/* The `<gmp-place-autocomplete>` web component mounts here via the
            usePlacesAutocomplete effect. */}
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

      {action !== null && action.kind === "show-message" && (
        <MessageBanner
          action={action}
          onCtaClick={onCtaClick}
          onRetry={onRetry}
        />
      )}

      {/* PWA-S9a (#460) — palier 1 Wallet install card, rendered AFTER a
          deliverable verdict in place of the immediate `router.push`. The
          card's `onSkip` navigates to the destination the verdict carried. */}
      {action !== null &&
        action.kind === "redirect" &&
        (() => {
          const destination = action.path;
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
 * with the optional CTA (C&C on hors_zone) and the optional Retry button (surge).
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
