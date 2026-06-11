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
 * input; the form does NOT auto-fire the chain on pre-fill (the user must
 * explicitly re-select a Places suggestion to confirm).
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
};

export function AddressFirstForm({
  tenantId,
  initialAddress,
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

  const onRetry = (): void => {
    if (lastSelection === null) return;
    retry(lastSelection);
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
