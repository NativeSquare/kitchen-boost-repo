"use client";

/**
 * PWA-S5 (#453) — `<DeliveryModeToggle>`: header-permanent toggle (US 24,
 * CONTEXT client-ordering « Mode toggle », decisions-log Q7).
 *
 * Two buttons, ALWAYS visible side-by-side : [🛵 Livraison · X €] [🚶
 * Retrait · Gratuit]. The current mode is filled-green; the other is
 * outlined-zinc. Switching is INSTANT (no async, no spinner) — Q7 « switch
 * sans re-quote, verdict cache 2 modes ».
 *
 * FEATURE B (#reusable delivery-address sheet) — a DISABLED « Livraison »
 * button is no longer a dead tap. Tapping it runs `decideDisabledDeliveryTap`
 * (pure) over the cached verdict × live open/closed state:
 *  - resto closed → defer to Feature A's closed sheet (no address quote when
 *    closed);
 *  - verdict null → open the reusable address sheet in PROMPT mode;
 *  - verdict hors_zone / surge → open it in EDIT mode, pre-filled with the
 *    current address.
 * On a deliverable replay the sheet adopts the fresh verdict (enable + select
 * Livraison) and closes — no page reload.
 */
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { decideDisabledDeliveryTap } from "@/lib/availability";
import { useServiceStatus } from "@/components/availability/service-status-context";
import { useDeliveryMode } from "./delivery-mode-context";
import {
  DeliveryAddressSheet,
  type DeliveryAddressSheetMode,
} from "./delivery-address-sheet";

/** FR currency formatter (same shape as `<MenuView>`). */
function formatEur(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(centimes / 100);
}

export type DeliveryModeToggleProps = {
  /** Resto id — needed by the reusable address sheet's quote chain (Feature B). */
  tenantId: Id<"tenants">;
};

export function DeliveryModeToggle({
  tenantId,
}: DeliveryModeToggleProps): React.JSX.Element {
  const { verdict, mode, setMode, deliveryDisabled, pickupDisabled } =
    useDeliveryMode();
  const { isOpen, requestShowClosedSheet } = useServiceStatus();

  // Current address for the EDIT-mode pre-fill (own fiche; null while anon).
  const customer = useQuery(api.lib.customer.identity.getCurrentCustomer, {
    tenantId,
  });
  const currentAddress = customer?.address;

  const [sheet, setSheet] = useState<DeliveryAddressSheetMode | null>(null);

  // Delivery fee label: gross fee from the cached verdict if deliverable,
  // else « — » (button is disabled anyway, but stays readable).
  const deliveryLabel =
    verdict !== null && verdict.deliverable ? formatEur(verdict.fee) : "—";

  const onDeliveryClick = (): void => {
    if (!deliveryDisabled) {
      setMode("delivery");
      return;
    }
    // Disabled tap — never a dead button. `isOpen === null` (still loading) is
    // treated as closed-ish: defer to the closed UX rather than quoting blindly.
    const action = decideDisabledDeliveryTap({
      verdict,
      isOpen: isOpen === true,
    });
    if (action === "closed-sheet") {
      requestShowClosedSheet();
    } else if (action === "address-prompt") {
      setSheet("prompt");
    } else if (action === "address-edit") {
      setSheet("edit");
    }
    // "none" → unreachable here (button enabled handled above).
  };

  return (
    <>
      <div
        role="group"
        aria-label="Mode de récupération de la commande"
        className="flex w-full gap-2"
      >
        <ModeButton
          active={mode === "delivery"}
          disabled={deliveryDisabled}
          onClick={onDeliveryClick}
          emoji="🛵"
          label="Livraison"
          priceLabel={deliveryLabel}
          ariaLabel={`Livraison · ${deliveryLabel}`}
        />
        <ModeButton
          active={mode === "click_and_collect"}
          disabled={pickupDisabled}
          onClick={() => setMode("click_and_collect")}
          emoji="🚶"
          label="Retrait"
          priceLabel="Gratuit"
          ariaLabel="Retrait sur place · Gratuit"
        />
      </div>

      {sheet !== null && (
        <DeliveryAddressSheet
          tenantId={tenantId}
          open
          mode={sheet}
          currentAddress={currentAddress}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  );
}

function ModeButton({
  active,
  disabled,
  onClick,
  emoji,
  label,
  priceLabel,
  ariaLabel,
}: {
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
  priceLabel: string;
  ariaLabel: string;
}): React.JSX.Element {
  // Style triangulation: 3 visual states (active / idle-enabled / disabled).
  const baseClass =
    "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
  const styleClass = disabled
    ? "cursor-pointer border border-zinc-200 bg-zinc-50 text-zinc-400"
    : active
      ? "border-2 border-emerald-700 bg-emerald-50 text-black"
      : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50";
  return (
    <button
      type="button"
      // Feature B: a disabled button still HANDLES the click (opens a sheet),
      // so the onClick is always wired; `aria-disabled` keeps the a11y signal.
      onClick={onClick}
      aria-pressed={active}
      aria-disabled={disabled}
      aria-label={ariaLabel}
      className={`${baseClass} ${styleClass}`}
    >
      <span aria-hidden="true">{emoji}</span>
      <span>{label}</span>
      <span className="text-xs text-zinc-600">· {priceLabel}</span>
    </button>
  );
}
