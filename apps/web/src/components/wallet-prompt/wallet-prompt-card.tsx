"use client";

/**
 * PWA-S9a (#460) — `<WalletPromptCard>` — palier 1 of the 3-paliers Wallet
 * install moat (decisions-log Q5, US 27).
 *
 * Rendered AFTER a deliverable address-first verdict, in place of the
 * immediate `router.push("/menu")` that PWA-S3 (#451) used to fire. The card
 * is full-page, NON-blocking, with two exits:
 *  - « Ajouter à mon Wallet » primary CTA → reuses the existing
 *    `<AddToWalletButton>` from `push-enrollment-modal/` (S6a #455 — same
 *    component, same device-target detection, same Apple/Google split).
 *    On install effective the Convex sub on `getCurrentCustomer` flips
 *    `pushEnrollment.walletStatus = "enrolled"` → the pure decision
 *    `decideWalletPromptVisibility` returns `hidden` → the card calls
 *    `onSkip()` so the parent navigates the user to `/menu`.
 *  - « Plus tard » secondary link → calls `onSkip()` immediately. The card
 *    does NOT set the banner's `dismissed` flag (palier 2 is separate — the
 *    user who skipped here is STILL eligible for the banner on /menu).
 *
 * The card does NOT render at all when the prompt is hidden (Wallet already
 * enrolled — the user landed here from a stale form state — OR caller passed
 * `dismissed = true`). In the « already enrolled » branch the card also fires
 * `onSkip()` on mount so the user is not stuck on an empty page.
 *
 * Pure decision driven : `decideWalletPromptVisibility({ walletStatus,
 * dismissed: false })` — palier 1 is never « dismissed » (the « Plus tard »
 * link is a navigation, not a flag flip). The decision still drives the
 * « hidden » short-circuit on `walletStatus = "enrolled"` so the Convex sub
 * flip on install closes the card automatically (issue AC « install Wallet
 * effectif → 3 paliers hidden via Convex sub realtime »).
 */
import { useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { decideWalletPromptVisibility } from "@/lib/wallet-prompt";
import { AddToWalletButton } from "@/components/checkout/push-enrollment-modal/add-to-wallet-button";

export type WalletPromptCardProps = {
  /** The current resto — passed to `<AddToWalletButton>` for `generatePass`. */
  tenantId: Id<"tenants">;
  /**
   * Called when the user skips the card — either via « Plus tard » OR via
   * the Convex sub flipping `walletStatus = "enrolled"`. The parent decides
   * the navigation target (PWA-S3's `<AddressFirstForm>` navigates to
   * `/menu`).
   */
  onSkip: () => void;
};

export function WalletPromptCard({
  tenantId,
  onSkip,
}: WalletPromptCardProps): React.JSX.Element | null {
  // Convex sub on the customer fiche — realtime flip when the user installs
  // the Wallet pass (the backend webhook `pass_installed` writes
  // `pushEnrollment.walletStatus = "enrolled"` → this query re-runs → the
  // useEffect below fires `onSkip()` so the user lands on /menu).
  // `useQuery` returns `undefined` while loading; we treat that the same as
  // « not yet enrolled » so the card renders without a loader flash (the
  // card is the SSR-equivalent of a redirect — visible immediately).
  const customer = useQuery(api.lib.customer.identity.getCurrentCustomer, {
    tenantId,
  });

  const walletStatus = customer?.pushEnrollment?.walletStatus;
  // The card is never « dismissed » — see file header.
  const visibility = decideWalletPromptVisibility({
    walletStatus,
    dismissed: false,
  });

  // On install effective (Convex sub flip) → close the card by calling
  // onSkip(). The effect re-runs whenever the visibility flips to hidden;
  // we guard on the « already-enrolled » reason so a future `dismissed`
  // hidden branch does NOT also navigate (the dismiss path is « Plus
  // tard » which already navigates synchronously via its onClick).
  useEffect(() => {
    if (
      visibility.kind === "hidden" &&
      visibility.reason === "already-enrolled"
    ) {
      onSkip();
    }
  }, [visibility, onSkip]);

  if (visibility.kind === "hidden") {
    // The effect above will fire onSkip on the next tick; render nothing
    // in the meantime to avoid the flash of the card.
    return null;
  }

  return (
    <section
      aria-label="Ajoute ta carte de fidélité"
      className="flex w-full max-w-md flex-col gap-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-left shadow-sm"
    >
      <header className="flex flex-col gap-2">
        <p className="text-3xl">🎁</p>
        <h2 className="text-xl font-bold text-emerald-900">
          -10% sur ta prochaine commande
        </h2>
        <p className="text-sm text-emerald-800">
          Ajoute la carte de fidélité à ton Wallet pour recevoir ton offre +
          suivre tes commandes sur ton écran de verrouillage.
        </p>
      </header>

      <AddToWalletButton
        tenantId={tenantId}
        onGenerated={() => {
          // The Convex sub on `walletStatus` is the authoritative close
          // signal (file header). Nothing to do here — the generate has
          // kicked off the install sheet on iOS or the redirect on Android,
          // and the webhook will flip the status when the user completes.
        }}
        onError={() => {
          // V1: surface the error inline via the button's own state +
          // toast in S6a. The card stays open so the user can retry.
        }}
      />

      <button
        type="button"
        onClick={onSkip}
        className="self-start text-sm font-medium text-emerald-900 underline-offset-2 hover:underline"
      >
        Plus tard →
      </button>
    </section>
  );
}
