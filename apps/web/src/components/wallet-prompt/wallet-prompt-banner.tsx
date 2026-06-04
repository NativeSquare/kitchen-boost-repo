"use client";

/**
 * PWA-S9a (#460) — `<WalletPromptBanner>` — palier 2 of the 3-paliers Wallet
 * install moat (decisions-log Q5, US 28).
 *
 * Permanent top banner on /menu + /panier with two exits:
 *  - « Ajouter la carte → » primary CTA → navigates to the soft-prompt
 *    card at home (`/`). The actual install flow lives there in
 *    `<WalletPromptCard>` (palier 1); duplicating the full Wallet
 *    generation IO here would inflate the menu/cart bundle (avoids the
 *    Wallet `useAction` hook on every menu render — keeps LCP <1.5s).
 *  - « × » dismiss button → sets the sessionStorage flag
 *    `kb_wallet_banner_dismissed = "1"` and hides for the rest of the
 *    session (issue AC « X session-scoped (sessionStorage) »). A new
 *    browser tab gets a fresh storage → the banner re-appears (issue AC
 *    « re-apparaît à la session suivante »).
 *
 * The banner does NOT render when:
 *  - the Wallet pass is already enrolled (Convex sub on `walletStatus`),
 *  - OR the user dismissed it in this session (sessionStorage).
 * Both branches are decided by the pure `decideWalletPromptVisibility`
 * (same function the palier 1 card consumes — 1 decision, 2 surfaces).
 *
 * Hydration discipline : `dismissed` reads sessionStorage, which is not
 * available SSR — we use `useSyncExternalStore` so the SSR snapshot pins
 * `dismissed = false` (the banner renders by default) and the client
 * snapshot reads the real flag on mount. Avoids the « banner flash »
 * antipattern of a `useEffect(() => setDismissed(...))` in a `useState`
 * initial. Same shape as `<PushEnrollmentModal>` reading `'PushManager' in
 * window` via `useSyncExternalStore`.
 */
import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  WALLET_PROMPT_BANNER_DISMISS_KEY,
  decideWalletPromptVisibility,
} from "@/lib/wallet-prompt";

/** Read the dismissed flag from sessionStorage — client-side only. */
function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return (
      window.sessionStorage.getItem(WALLET_PROMPT_BANNER_DISMISS_KEY) === "1"
    );
  } catch {
    // Privacy mode / quota / disabled storage — treat as not-dismissed (the
    // pure decision returns « show »); the X click handler ALSO swallows
    // storage errors so the UI degrades gracefully.
    return false;
  }
}

/**
 * SSR snapshot for `useSyncExternalStore`. SessionStorage is unknown on the
 * server; we pin `false` so the SSR HTML and the first client render agree
 * (banner shows). The client snapshot below reads the real flag.
 */
function getServerDismissed(): boolean {
  return false;
}

/**
 * Subscribe to the `storage` event so a dismiss in another tab / a manual
 * sessionStorage edit (devtools) re-renders this banner. SessionStorage
 * events fire across same-origin documents — useful for the « close in
 * tab A, navigate /menu → /panier in tab A » roundtrip too (since both
 * routes mount this banner independently).
 *
 * The subscribe returns the cleanup; `useSyncExternalStore` calls it on
 * unmount.
 */
function subscribeDismissed(notify: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === WALLET_PROMPT_BANNER_DISMISS_KEY) notify();
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

export type WalletPromptBannerProps = {
  /** The current resto — needed for the `getCurrentCustomer` query. */
  tenantId: Id<"tenants">;
};

export function WalletPromptBanner({
  tenantId,
}: WalletPromptBannerProps): React.JSX.Element | null {
  const customer = useQuery(api.lib.customer.identity.getCurrentCustomer, {
    tenantId,
  });
  const dismissed = useSyncExternalStore<boolean>(
    subscribeDismissed,
    readDismissed,
    getServerDismissed,
  );

  const walletStatus = customer?.pushEnrollment?.walletStatus;
  const visibility = decideWalletPromptVisibility({
    walletStatus,
    dismissed,
  });

  if (visibility.kind === "hidden") return null;

  const onDismiss = (): void => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(WALLET_PROMPT_BANNER_DISMISS_KEY, "1");
      // sessionStorage.setItem does NOT fire `storage` on the SAME document
      // (only cross-document). Trigger a manual re-render by dispatching
      // a fake event — `useSyncExternalStore` re-reads on the next paint.
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: WALLET_PROMPT_BANNER_DISMISS_KEY,
          newValue: "1",
        }),
      );
    } catch {
      // Privacy mode — best-effort; the banner will re-appear next visit
      // but at least the click is acknowledged (no crash).
    }
  };

  return (
    <div
      role="region"
      aria-label="Ajoute ta carte de fidélité"
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900"
    >
      <Link
        href="/"
        className="flex-1 truncate text-left font-medium hover:underline"
      >
        🎁 -10% offerts → ajoute la carte
      </Link>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Masquer ce bandeau"
        className="rounded-full px-2 py-1 text-base text-emerald-900 hover:bg-emerald-100"
      >
        ×
      </button>
    </div>
  );
}
