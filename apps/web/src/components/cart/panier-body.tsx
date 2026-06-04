"use client";

/**
 * PWA-S5 (#453) / PWA-S9a (#460) — `<PanierBody>` : client body of `/panier`,
 * extracted so the RSC parent (`app/panier/page.tsx`) can read the tenant
 * cookie and pass `tenantId` down to the palier 2 `<WalletPromptBanner>`.
 *
 * Owns the same providers + layout as the old client-only `PanierPage`:
 *  - `<CartProvider>` (localStorage-backed) + `<DeliveryModeProvider>`
 *    (one-shot localStorage read of the address-first verdict).
 *  - Optional `<WalletPromptBanner>` palier 2 (only when `tenantId` is
 *    resolvable — degrades gracefully when the cookie is missing, which
 *    is the same fallback shape `app/page.tsx` and `app/menu/page.tsx`
 *    use for missing tenants).
 */
import Link from "next/link";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { CartProvider } from "@/components/cart/cart-context";
import { CartView } from "@/components/cart/cart-view";
import { DeliveryModeProvider } from "@/components/delivery-mode/delivery-mode-context";
import { DeliveryModeToggle } from "@/components/delivery-mode/delivery-mode-toggle";
import { WalletPromptBanner } from "@/components/wallet-prompt";
import { AndroidInstallButton } from "@/components/a2hs-install";

export type PanierBodyProps = {
  /** Resolved tenantId from `__Host-kb_tenant` — `undefined` in degraded state. */
  tenantId: Id<"tenants"> | undefined;
  /** Resto display name — interpolated by the A2HS button « Installer X ». */
  tenantName?: string;
};

export function PanierBody({
  tenantId,
  tenantName,
}: PanierBodyProps): React.JSX.Element {
  return (
    <CartProvider>
      <DeliveryModeProvider>
        <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 pb-32 pt-8 md:px-8">
          {/* PWA-S9a (#460) — palier 2 of the 3-paliers Wallet install moat
              (decisions-log Q5, US 28). Same component as on /menu — the
              dismissed flag (sessionStorage) is shared across both routes
              within the session. Skipped when no tenantId (degraded). */}
          {tenantId !== undefined && <WalletPromptBanner tenantId={tenantId} />}
          <header className="flex flex-col gap-3">
            <h1 className="text-3xl font-bold text-black">Ton panier</h1>
            <DeliveryModeToggle />
          </header>

          <CartView />

          <footer className="flex items-center justify-between gap-3">
            <Link
              href="/menu"
              className="text-sm font-medium text-zinc-700 hover:underline"
            >
              ← Retour au menu
            </Link>
            <Link
              href="/checkout"
              className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
            >
              Continuer vers le paiement
            </Link>
          </footer>
        </div>
        {/* PWA-S10 (#462) — A2HS Android post-cart floating button. Same
            decision-driven render gate as on /menu — hides on iOS Safari,
            desktop, empty cart, already-standalone, already-enrolled. The
            captured `beforeinstallprompt` event comes from
            `<PWAInstallProvider>` in the root layout. Skipped when no
            tenantId (degraded — no Convex sub possible without it). */}
        {tenantId !== undefined && (
          <AndroidInstallButton
            tenantId={tenantId}
            tenantName={tenantName ?? "ce resto"}
          />
        )}
      </DeliveryModeProvider>
    </CartProvider>
  );
}
