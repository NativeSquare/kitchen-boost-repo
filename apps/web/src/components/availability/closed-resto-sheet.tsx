"use client";

/**
 * FEATURE A (#closed-resto UX) — `<ClosedRestoSheet>`: the Uber-Eats-style
 * « Resto fermé » bottom sheet shown at LOAD when the resto is closed, BEFORE
 * (and instead of) the address-first form — a delivery quote is pointless when
 * closed (bypass-address-when-closed decision).
 *
 * Reuses the shared Drawer wrapper (bottom-sheet mobile / side-drawer desktop).
 * It is DISMISSABLE so the customer can still BROWSE the menu read-only
 * (ordering/checkout stays blocked by the `isOpenNow` / `hors_horaire` gate — the
 * safety net is left in place). Stale-tab (A.5): the open/closed state comes from
 * `<ServiceStatusProvider>` (Convex sub + ~30s wall-clock interval), so:
 *  - flip open→closed mid-browse → the sheet appears on its own;
 *  - flip closed→open → the sheet dismisses on its own.
 *
 * Dismiss discipline: a manual dismiss only suppresses the CURRENT closed
 * period, persisted in sessionStorage so it survives the home→/menu navigation
 * triggered by « Voir la carte » (otherwise the sheet would immediately re-show
 * on the destination page). When the state flips back to open the suppression
 * resets (sessionStorage cleared), so a LATER closing re-shows the sheet (the
 * customer is not permanently muted).
 *
 * « Voir la carte » navigates PROGRAMMATICALLY (`router.push`) for the home page
 * (`browseHref`): a plain `<Link onClick={dismiss}>` aborted its own navigation,
 * because `dismiss()` unmounts the sheet (and the link) in the same tick before
 * Next's client nav fires.
 */
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { useServiceStatus } from "./service-status-context";

/**
 * sessionStorage flag for « dismissed for the current closed period ». Persisted
 * (not just component state) so it survives the home→/menu navigation triggered
 * by « Voir la carte » — otherwise the sheet would re-show on the destination
 * page. Cleared when the resto flips back open. sessionStorage is per-tab, so a
 * fresh tab/session re-shows the sheet (intended).
 */
const CLOSED_DISMISS_KEY = "kb_closed_resto_dismissed_v1";

function readClosedDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(CLOSED_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeClosedDismissed(value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (value) window.sessionStorage.setItem(CLOSED_DISMISS_KEY, "1");
    else window.sessionStorage.removeItem(CLOSED_DISMISS_KEY);
  } catch {
    // Private mode / quota — non-fatal (degrades to per-render state).
  }
}

export type ClosedRestoSheetProps = {
  /**
   * Where « Voir la carte » should take the customer. On the address-first home
   * page the menu lives at `/menu` (closed ⇒ BYPASS the address form, browse the
   * menu instead). On `/menu` itself the menu is already underneath, so the CTA
   * just dismisses (no `browseHref`).
   */
  browseHref?: string;
};

export function ClosedRestoSheet({
  browseHref,
}: ClosedRestoSheetProps = {}): React.JSX.Element | null {
  const isMobile = useIsMobile();
  const router = useRouter();
  const { isOpen, nextOpeningLabel, showClosedSheetNonce } = useServiceStatus();
  // Suppress the sheet for the CURRENT closed period only, persisted in
  // sessionStorage so it survives the home→/menu navigation (« Voir la carte »).
  const [dismissed, setDismissed] = useState(false);

  // Hydrate the dismissal from sessionStorage on mount (covers the destination
  // page after « Voir la carte » navigated here within the same closed period).
  useEffect(() => {
    setDismissed(readClosedDismissed());
  }, []);

  const dismiss = useCallback(() => {
    writeClosedDismissed(true);
    setDismissed(true);
  }, []);

  // Reset the suppression whenever the resto is open — a later closing re-shows
  // the sheet (one dismiss does not mute the customer forever).
  useEffect(() => {
    if (isOpen === true) {
      writeClosedDismissed(false);
      setDismissed((prev) => (prev ? false : prev));
    }
  }, [isOpen]);

  // A disabled-Livraison tap while closed bumps the nonce → un-dismiss so the
  // closed sheet re-opens (Feature B defers to the closed UX, never a dead tap).
  useEffect(() => {
    if (showClosedSheetNonce > 0) {
      writeClosedDismissed(false);
      setDismissed(false);
    }
  }, [showClosedSheetNonce]);

  // « Voir la carte »: navigate to the menu (home page) or just reveal it
  // (already on /menu). Dismiss first so the destination page does not re-show.
  const onBrowse = useCallback(() => {
    dismiss();
    if (browseHref !== undefined) router.push(browseHref);
  }, [dismiss, browseHref, router]);

  // Render only when we KNOW the resto is closed (isOpen === false, not null/
  // loading) and the customer has not dismissed this closed period.
  if (isOpen !== false || dismissed) return null;

  const body = (
    <p className="text-sm text-zinc-700">
      Tu peux parcourir la carte en attendant. La commande rouvre à la
      réouverture du resto.
    </p>
  );
  // Single « Voir la carte » CTA wired to onBrowse (navigate from home → /menu,
  // or just reveal the menu already underneath). Same button on both platforms.
  const browseButton = (
    <button
      type="button"
      onClick={onBrowse}
      className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50"
      data-testid="closed-resto-browse"
    >
      Voir la carte
    </button>
  );

  // MOBILE — Vaul bottom sheet.
  if (isMobile) {
    return (
      <Drawer
        open
        onOpenChange={(next) => {
          if (!next) dismiss();
        }}
      >
        <DrawerContent data-testid="closed-resto-sheet" className="px-0">
          <DrawerHeader>
            <DrawerTitle>Resto fermé</DrawerTitle>
            <DrawerDescription>{nextOpeningLabel}</DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col gap-3 px-4 pb-4">{body}</div>

          <DrawerFooter>{browseButton}</DrawerFooter>
        </DrawerContent>
      </Drawer>
    );
  }

  // DESKTOP — centered Radix Dialog (a bottom drawer renders full-width on wide
  // viewports). Informational only, so no input/dropdown concerns.
  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) dismiss();
      }}
    >
      <DialogContent data-testid="closed-resto-sheet">
        <DialogHeader>
          <DialogTitle>Resto fermé</DialogTitle>
          <DialogDescription>{nextOpeningLabel}</DialogDescription>
        </DialogHeader>

        {body}

        <DialogFooter>{browseButton}</DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
