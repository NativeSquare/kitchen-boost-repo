"use client";

/**
 * FEATURE B (#reusable delivery-address sheet) — `<DeliveryAddressSheet>`: the
 * bottom sheet a DISABLED « Livraison » tap opens so the button is NEVER a dead
 * tap (issue spec). Reuses the SAME Drawer wrapper as the menu modal / iOS A2HS
 * sheet, and the SAME address→quote chain + Places widget the full-page
 * `<AddressFirstForm>` uses (via the shared hooks).
 *
 * Two entry modes (decided by `decideDisabledDeliveryTap`, passed in as `mode`):
 *  - `prompt` — verdict unknown (fresh-tab deep-link): « Renseigne ton adresse
 *    de livraison ». Empty input.
 *  - `edit`   — verdict known but not deliverable (hors_zone / surge): « Modifie
 *    ton adresse de livraison ». Input PRE-FILLED with the current address.
 *
 * On submit it replays the chain. On a `deliverable` verdict → `adoptVerdict`
 * (delivery-mode context: enable + select Livraison, persist) and close — NO
 * page reload. On a refusal verdict → show the reason INSIDE the sheet and keep
 * it open so the customer can try another address.
 *
 * RESPONSIVE wrapper: a bottom-anchored Vaul Drawer is right on MOBILE but on
 * desktop it renders full-width at the viewport bottom, where the Google Places
 * dropdown gets clipped off-screen (unusable). So the SAME inner content is
 * wrapped in a Vaul Drawer on mobile (`useIsMobile()`, breakpoint 768 — the
 * mobile path is byte-for-byte unchanged: it works, do not touch it) and in a
 * centered Radix Dialog on desktop (room below the field for the dropdown).
 */
import { useEffect } from "react";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { DeliveryQuoteReason } from "@/lib/address-first";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePlacesAutocomplete } from "@/components/address-first/use-places-autocomplete";
import { useAddressQuoteChain } from "@/components/address-first/use-address-quote-chain";
import { useDeliveryMode } from "./delivery-mode-context";

/** The sheet's copy mode (prompt = unknown address, edit = known-but-refused). */
export type DeliveryAddressSheetMode = "prompt" | "edit";

/** Reason copy shown INSIDE the sheet when a replay is refused (try again). */
const REASON_COPY: Record<DeliveryQuoteReason, string> = {
  hors_zone:
    "Cette adresse est trop éloignée pour la livraison. Essaie une autre adresse, ou passe en retrait sur place.",
  hors_horaire:
    "Le resto est fermé pour le moment. Reviens à l'ouverture pour te faire livrer.",
  surge:
    "Livraison momentanément indisponible. Réessaie dans quelques minutes.",
};

const SPINNER_LABEL = "On vérifie la livraison…";

export type DeliveryAddressSheetProps = {
  tenantId: Id<"tenants">;
  /** Controlled open state (the toggle owns it). */
  open: boolean;
  /** Dismiss handler (swipe / overlay / Esc / successful adopt). */
  onClose: () => void;
  /** Copy + pre-fill mode (from `decideDisabledDeliveryTap`). */
  mode: DeliveryAddressSheetMode;
  /** Current address to pre-fill in `edit` mode (from the cached fiche). */
  currentAddress?: string;
};

export function DeliveryAddressSheet({
  tenantId,
  open,
  onClose,
  mode,
  currentAddress,
}: DeliveryAddressSheetProps): React.JSX.Element {
  const isMobile = useIsMobile();
  const { adoptVerdict } = useDeliveryMode();
  const { state, submit, setError } = useAddressQuoteChain({ tenantId });
  const { containerRef } = usePlacesAutocomplete({
    initialAddress: mode === "edit" ? currentAddress : undefined,
    onSelectionPicked: submit,
    onError: setError,
  });

  // On a DELIVERABLE replay → adopt the fresh verdict (enable + select Livraison,
  // persist) and close. A refusal verdict keeps the sheet open with its message.
  useEffect(() => {
    if (state.kind !== "verdict") return;
    if (state.verdict.deliverable) {
      adoptVerdict(state.verdict);
      onClose();
    }
  }, [state, adoptVerdict, onClose]);

  const refusal =
    state.kind === "verdict" && !state.verdict.deliverable
      ? state.verdict.reason
      : null;

  const title =
    mode === "edit"
      ? "Modifie ton adresse de livraison"
      : "Renseigne ton adresse de livraison";
  const description =
    mode === "edit"
      ? "On revérifie si on peut te livrer à la nouvelle adresse."
      : "On vérifie si on peut te livrer chez toi.";

  // Shared inner fields (Places input + replay states). Identical in both the
  // mobile Drawer and the desktop Dialog — only the surrounding chrome differs.
  const fields = (
    <>
      <label className="flex flex-col gap-2 text-left">
        <span className="text-sm font-medium text-zinc-700">
          Ton adresse de livraison
        </span>
        {/* `data-vaul-no-drag`: the Google `PlaceAutocompleteElement` is a
            custom web component, NOT a native <input>, so Vaul's drag-to-
            dismiss does not recognise it and swallows the touch — the field
            never focuses on mobile. Marking the container makes Vaul skip
            drag for touches starting here (it walks `closest('[data-vaul-no-
            drag]')` from the shadow-retargeted host), so the field is tappable
            while the rest of the sheet can still be swiped to dismiss. Harmless
            in the desktop Dialog (no Vaul). */}
        <div
          ref={containerRef}
          data-vaul-no-drag
          className="w-full"
          aria-label="Adresse de livraison"
        />
      </label>

      {state.kind === "loading" && (
        <p role="status" aria-live="polite" className="text-sm text-zinc-600">
          {SPINNER_LABEL}
        </p>
      )}

      {refusal !== null && (
        <p
          role="status"
          aria-live="polite"
          className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-black"
        >
          {REASON_COPY[refusal]}
        </p>
      )}

      {state.kind === "error" && (
        <p role="alert" className="text-sm text-red-700">
          {state.message}
        </p>
      )}
    </>
  );

  // MOBILE — Vaul bottom sheet (unchanged: this works, do not touch it).
  if (isMobile) {
    return (
      <Drawer
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <DrawerContent data-testid="delivery-address-sheet" className="px-0">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          <div className="flex flex-col gap-4 px-4 pb-6">{fields}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  // DESKTOP — centered Radix Dialog: a bottom drawer would clip the Google
  // dropdown off-screen on wide viewports. The Dialog is centered with room
  // below the field for the suggestions.
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent data-testid="delivery-address-sheet">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">{fields}</div>
      </DialogContent>
    </Dialog>
  );
}
