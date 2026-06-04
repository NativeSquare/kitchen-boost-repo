"use client";

/**
 * PWA-S10 (#462) — `<AndroidInstallButton>` — palier A2HS Android post-cart
 * (decisions-log Q4, US 56-57-59).
 *
 * Fixed bottom-right floating button « 📲 Installer {nom_resto} » that
 * appears ONLY when ALL four conditions are met (see `decideA2hsButtonVisibility`):
 *   1. The `<PWAInstallProvider>` captured a `beforeinstallprompt` event
 *      (Android Chrome only — iOS never fires it, AC 5).
 *   2. The cart has at least one line (Q4: « après 1er ajout panier »).
 *   3. The PWA is NOT already running standalone (US 59).
 *   4. The backend `pushEnrollment.a2hsStatus` is NOT `"enrolled"` (AC 4 —
 *      « visite suivante après install → bouton n'apparaît plus »).
 *
 * Click flow (US 57):
 *   1. Call `prompt.prompt()` on the captured event → Android shows its
 *      native install sheet.
 *   2. Await `prompt.userChoice` → if `"accepted"`:
 *        - fire mutation `customer.pushEnrollment.recordA2hsAccepted` → backend
 *          flips `a2hsStatus = "enrolled"` (AC 3).
 *      if `"dismissed"`:
 *        - no mutation; the button still hides because the event is single-use
 *          (spec) — we always `clearPrompt()` after the resolve.
 *   3. `clearPrompt()` regardless of outcome → the captured event is one-shot
 *      per spec; trying to re-call `.prompt()` would throw.
 *
 * Secondary path (`appinstalled` window event — covers Chrome 3-dot menu
 * install): the provider exposes `installed = true` when the event fires; an
 * effect here fires the same mutation once (idempotent backend — re-flipping
 * to `"enrolled"` is a no-op for the gate logic, the historical audit row is
 * intentional).
 *
 * Styling: `fixed bottom-4 right-4 z-40` — above the cart drawer (z-30) but
 * below modals (z-50). The emoji + tenant name make the action self-evident
 * (« Installer Buns & Bao »); the green pill matches the brand language
 * (CTA across the PWA).
 *
 * Hydration discipline: `isStandalone` is read via `useSyncExternalStore` so
 * the SSR snapshot pins `false` (button considered for render) and the client
 * reads the real `matchMedia` on mount. Same pattern as the wallet-prompt
 * banner reading sessionStorage.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { decideA2hsButtonVisibility } from "@/lib/a2hs-install";
import { useCart } from "@/components/cart/cart-context";
import { usePWAInstall } from "./pwa-install-context";

const STANDALONE_MEDIA_QUERY = "(display-mode: standalone)";

/** Read whether the PWA is currently in installed standalone mode. */
function readIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia(STANDALONE_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

/** SSR snapshot — always false so SSR/client first paint agree. */
function getServerIsStandalone(): boolean {
  return false;
}

/**
 * Subscribe to `matchMedia` changes so a user installing via the browser
 * menu (which can flip standalone without our event listener firing first)
 * re-renders this component on the spot. The MediaQueryList `change` event
 * fires when the standalone state flips.
 */
function subscribeIsStandalone(notify: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let mql: MediaQueryList;
  try {
    mql = window.matchMedia(STANDALONE_MEDIA_QUERY);
  } catch {
    return () => {};
  }
  const onChange = (): void => notify();
  // Modern API (Safari 14+, all evergreen) — fall back to deprecated addListener
  // for older WebViews (defensive; the PWA targets modern browsers but the
  // listener API is a known compat seam).
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}

export type AndroidInstallButtonProps = {
  /** Resto id — wrapper arg for `customerMutation` + `getCurrentCustomer`. */
  tenantId: Id<"tenants">;
  /** Resto display name — interpolated into « Installer {nom_resto} ». */
  tenantName: string;
};

export function AndroidInstallButton({
  tenantId,
  tenantName,
}: AndroidInstallButtonProps): React.JSX.Element | null {
  const { prompt, clearPrompt, installed } = usePWAInstall();
  const { state } = useCart();
  const isStandalone = useSyncExternalStore<boolean>(
    subscribeIsStandalone,
    readIsStandalone,
    getServerIsStandalone,
  );

  const customer = useQuery(api.lib.customer.identity.getCurrentCustomer, {
    tenantId,
  });
  const recordA2hsAccepted = useMutation(
    api.lib.customer.pushEnrollment.recordA2hsAccepted,
  );

  // Secondary path — `appinstalled` window event (Chrome menu install). The
  // ref guards against double-fire across re-renders. We do NOT also guard
  // on `a2hsStatus === "enrolled"` because the mutation is idempotent on the
  // backend (re-flipping is a no-op), and the audit trail of the second row
  // is intentional documentation that this install path was used.
  const installedMutationFired = useRef(false);
  useEffect(() => {
    if (!installed) return;
    if (installedMutationFired.current) return;
    installedMutationFired.current = true;
    void recordA2hsAccepted({ tenantId }).catch(() => {
      // Best-effort signal — the backend will reconcile via the standalone
      // heuristic on the next visit. Don't surface to the user.
      installedMutationFired.current = false;
    });
  }, [installed, recordA2hsAccepted, tenantId]);

  const a2hsStatus = customer?.pushEnrollment?.a2hsStatus;
  const visibility = decideA2hsButtonVisibility({
    hasBeforeInstallPrompt: prompt !== null,
    cartItemCount: state.lines.length,
    isStandalone,
    a2hsStatus,
  });

  if (visibility.kind === "hidden") return null;

  const onClick = async (): Promise<void> => {
    if (prompt === null) return;
    try {
      // Spec: `.prompt()` resolves once the user interacts with the sheet.
      // The promise itself does NOT carry the choice — read `userChoice`.
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") {
        // Fire the backend signal — the Convex sub on `getCurrentCustomer`
        // will flip `a2hsStatus = "enrolled"` → the decision returns
        // `hidden / already-enrolled` → the button unmounts.
        await recordA2hsAccepted({ tenantId });
      }
    } catch {
      // Defensive — `.prompt()` can throw if called twice on the same event.
      // Best-effort; the button hides on the `clearPrompt()` below regardless.
    } finally {
      // The captured event is single-use (spec). Drop it so subsequent
      // renders hide the button via `no-prompt-captured`.
      clearPrompt();
    }
  };

  return (
    <button
      type="button"
      onClick={() => {
        void onClick();
      }}
      // Fixed bottom-right floating CTA. z-40 sits above the cart drawer
      // (z-30) but below blocking modals (z-50).
      className="fixed right-4 bottom-4 z-40 flex items-center gap-2 rounded-full bg-emerald-700 px-5 py-3 text-sm font-semibold text-white shadow-lg hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:outline-none"
      aria-label={`Installer ${tenantName} sur ton écran d'accueil`}
      data-testid="android-install-button"
    >
      <span aria-hidden="true">📲</span>
      <span>Installer {tenantName}</span>
    </button>
  );
}
