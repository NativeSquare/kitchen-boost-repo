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
 * period. When the state flips back to open the suppression resets, so a LATER
 * closing re-shows the sheet (the customer is not permanently muted).
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Drawer,
  DrawerClose,
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
  const { isOpen, nextOpeningLabel, showClosedSheetNonce } = useServiceStatus();
  // Suppress the sheet for the CURRENT closed period only.
  const [dismissed, setDismissed] = useState(false);

  // Reset the suppression whenever the resto is open — a later closing re-shows
  // the sheet (one dismiss does not mute the customer forever).
  useEffect(() => {
    if (isOpen === true && dismissed) setDismissed(false);
  }, [isOpen, dismissed]);

  // A disabled-Livraison tap while closed bumps the nonce → un-dismiss so the
  // closed sheet re-opens (Feature B defers to the closed UX, never a dead tap).
  useEffect(() => {
    if (showClosedSheetNonce > 0) setDismissed(false);
  }, [showClosedSheetNonce]);

  // Render only when we KNOW the resto is closed (isOpen === false, not null/
  // loading) and the customer has not dismissed this closed period.
  if (isOpen !== false || dismissed) return null;

  const body = (
    <p className="text-sm text-zinc-700">
      Tu peux parcourir la carte en attendant. La commande rouvre à la
      réouverture du resto.
    </p>
  );
  // « Voir la carte » CTA — navigates (home → /menu) or just dismisses (already
  // on /menu). Dismissing unmounts the sheet (setDismissed → returns null), so
  // no Drawer/Dialog Close primitive is required on the desktop path.
  const browseCta =
    browseHref !== undefined ? (
      <Link
        href={browseHref}
        onClick={() => setDismissed(true)}
        className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-center text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        data-testid="closed-resto-browse"
      >
        Voir la carte
      </Link>
    ) : null;

  // MOBILE — Vaul bottom sheet (unchanged: this works, do not touch it).
  if (isMobile) {
    return (
      <Drawer
        open
        onOpenChange={(next) => {
          if (!next) setDismissed(true);
        }}
      >
        <DrawerContent data-testid="closed-resto-sheet" className="px-0">
          <DrawerHeader>
            <DrawerTitle>Resto fermé</DrawerTitle>
            <DrawerDescription>{nextOpeningLabel}</DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col gap-3 px-4 pb-4">{body}</div>

          <DrawerFooter>
            {browseCta ?? (
              <DrawerClose asChild>
                <button
                  type="button"
                  onClick={() => setDismissed(true)}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                  data-testid="closed-resto-dismiss"
                >
                  Voir la carte
                </button>
              </DrawerClose>
            )}
          </DrawerFooter>
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
        if (!next) setDismissed(true);
      }}
    >
      <DialogContent data-testid="closed-resto-sheet">
        <DialogHeader>
          <DialogTitle>Resto fermé</DialogTitle>
          <DialogDescription>{nextOpeningLabel}</DialogDescription>
        </DialogHeader>

        {body}

        <DialogFooter>
          {browseCta ?? (
            <button
              type="button"
              onClick={() => setDismissed(true)}
              className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              data-testid="closed-resto-dismiss"
            >
              Voir la carte
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
