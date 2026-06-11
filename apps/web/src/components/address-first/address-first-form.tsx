"use client";

/**
 * PWA-S3 (#451) — `<AddressFirstForm>`: the address-first entry point of the
 * PWA Client (PRD §10 PWA Client, decisions-log Q7).
 *
 * Owns the BRANCHING (verdict → UI action) + the Wallet-install palier 1 card.
 * The address→quote IO chain itself now lives in the REUSABLE
 * `useAddressQuoteChain` hook (`lib/address-first/use-address-quote-chain.ts`)
 * and the Places mount in the REUSABLE `<PlacesAddressInput>` — both shared with
 * the `<DeliveryAddressSheet>` (the bottom sheet that replaces the dead disabled
 * « Livraison » button). This refactor keeps the form's OBSERVABLE behaviour
 * unchanged (address → deliverable → palier 1 Wallet card → /menu).
 *
 * Verdict branching via `decideAddressFirstAction` (PURE, unit-tested):
 *   - `redirect`     → render `<WalletPromptCard>` (palier 1), then `/menu`.
 *   - `show-message` → inline message; Retry button if `canRetry` (surge, US 7)
 *                      or a CTA to switch to C&C if `cta` (hors_zone, US 5).
 *
 * Pre-fill (returning Sophie): `initialAddress` silently pre-fills the input.
 * The form does NOT auto-fire the chain on pre-fill — the user must explicitly
 * re-select a Places suggestion (avoids silently re-quoting a stale address).
 */
import { useRouter } from "next/navigation";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  type AddressFirstAction,
  type DeliveryQuoteReason,
  decideAddressFirstAction,
} from "@/lib/address-first";
import { useAddressQuoteChain } from "@/lib/address-first/use-address-quote-chain";
import { WalletPromptCard } from "@/components/wallet-prompt";
import { PlacesAddressInput } from "./places-address-input";

/**
 * Narrowed shape of `AddressFirstAction` when the verdict is non-deliverable.
 */
type ShowMessageAction = Extract<AddressFirstAction, { kind: "show-message" }>;

/**
 * French user-facing copy for the 3 non-deliverable reasons. Shared verbatim
 * with the bottom sheet (`<DeliveryAddressSheet>`) — exported so both surfaces
 * use ONE wording source (decisions-log Q7).
 */
export const REASON_COPY: Record<DeliveryQuoteReason, string> = {
  hors_zone:
    "Trop éloignée pour la livraison depuis ce resto. Tu peux passer prendre ta commande sur place.",
  hors_horaire:
    "Le resto est fermé pour le moment. Reviens à l'ouverture pour commander.",
  surge: "Indisponible à cet horaire, réessaie dans quelques minutes.",
};

/** Spinner copy (Q7 (2): « On vérifie la livraison… »). */
export const SPINNER_LABEL = "On vérifie la livraison…";

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
  const { state, submit, retry, fail } = useAddressQuoteChain(tenantId);

  // Derive the UI action from the verdict (pure). Kept out of render-branches so
  // the JSX below narrows once.
  const action: AddressFirstAction | null =
    state.kind === "result" ? decideAddressFirstAction(state.verdict) : null;

  const onCtaClick = (path: string): void => {
    router.push(path);
  };

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-700">
          Ton adresse de livraison
        </span>
        <PlacesAddressInput
          onSelect={submit}
          onError={fail}
          initialAddress={initialAddress}
          className="w-full"
          ariaLabel="Adresse de livraison"
        />
      </label>

      {state.kind === "verifying" && (
        <p role="status" aria-live="polite" className="text-sm text-zinc-600">
          {SPINNER_LABEL}
        </p>
      )}

      {action !== null && action.kind === "show-message" && (
        <MessageBanner
          action={action}
          onCtaClick={onCtaClick}
          onRetry={retry}
        />
      )}

      {/* PWA-S9a (#460) — palier 1 Wallet install card, rendered AFTER a
          deliverable verdict in place of the immediate `router.push`. */}
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
 * with the optional CTA (C&C on hors_zone) and the optional Retry button
 * (surge). Exported so the bottom sheet can reuse the SAME banner.
 */
export function MessageBanner({
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
