"use client";

/**
 * PWA-S5 (#453) — `<DeliveryModeToggle>`: header-permanent toggle (US 24,
 * CONTEXT client-ordering « Mode toggle », decisions-log Q7).
 *
 * Two buttons, ALWAYS visible side-by-side : [🛵 Livraison · X €] [🚶
 * Retrait · Gratuit]. The current mode is filled-green; the other is
 * outlined-zinc.
 *
 * Livraison-when-disabled (feedback fix): a disabled Livraison button is NOT
 * always a dead button. `decideLivraisonTap(verdict)` distinguishes:
 *   - `null` verdict (address unknown — deep-link in a fresh tab) → tapping
 *     Livraison OPENS the `<DeliveryAddressSheet>` so the customer can enter an
 *     address and unlock delivery (no reload).
 *   - refusal verdict (hors_zone / hors_horaire / surge) → the address was
 *     already quoted and delivery is genuinely unavailable → inert (no sheet).
 *   - deliverable verdict → the button is enabled, normal mode switch.
 *
 * The sheet needs a `tenantId` to run the chain; when the provider has none
 * (degraded state, cookie missing) we keep the inert disabled button.
 *
 * Switching modes is INSTANT (no async) — Q7 « switch sans re-quote ».
 */
import { useState } from "react";
import { useDeliveryMode } from "./delivery-mode-context";
import { decideLivraisonTap } from "@/lib/delivery-mode/decide-livraison-tap";
import { DeliveryAddressSheet } from "./delivery-address-sheet";

/** FR currency formatter (same shape as `<MenuView>`). */
function formatEur(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(centimes / 100);
}

export function DeliveryModeToggle(): React.JSX.Element {
  const { verdict, mode, setMode, deliveryDisabled, pickupDisabled, tenantId } =
    useDeliveryMode();
  const [addressSheetOpen, setAddressSheetOpen] = useState(false);

  // Delivery fee label: gross fee from the cached verdict if deliverable,
  // else « — » (button is disabled anyway, but stays readable).
  const deliveryLabel =
    verdict !== null && verdict.deliverable ? formatEur(verdict.fee) : "—";

  // What should tapping Livraison do? `open-address-sheet` (null verdict) makes
  // the button ACTIONABLE-while-disabled — but only when we have a tenantId to
  // drive the chain.
  const tap = decideLivraisonTap(verdict);
  const canOpenSheet =
    tap.kind === "open-address-sheet" && tenantId !== undefined;

  // The Livraison button is rendered as a non-dead button when it can open the
  // sheet, even though `deliveryDisabled` is true. Otherwise honour the
  // decision's disabled flag.
  const livraisonInert = deliveryDisabled && !canOpenSheet;

  const onLivraisonClick = (): void => {
    if (canOpenSheet) {
      setAddressSheetOpen(true);
      return;
    }
    if (!deliveryDisabled) {
      setMode("delivery");
    }
    // refusal verdict → noop (inert).
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
          inert={livraisonInert}
          onClick={onLivraisonClick}
          emoji="🛵"
          label="Livraison"
          priceLabel={deliveryLabel}
          ariaLabel={`Livraison · ${deliveryLabel}`}
        />
        <ModeButton
          active={mode === "click_and_collect"}
          inert={pickupDisabled}
          onClick={() => setMode("click_and_collect")}
          emoji="🚶"
          label="Retrait"
          priceLabel="Gratuit"
          ariaLabel="Retrait sur place · Gratuit"
        />
      </div>

      {/* Reusable address sheet — only mounted/openable when we have a tenantId
          to run the chain (degraded state keeps the inert disabled button). */}
      {tenantId !== undefined && (
        <DeliveryAddressSheet
          open={addressSheetOpen}
          onOpenChange={setAddressSheetOpen}
          tenantId={tenantId}
        />
      )}
    </>
  );
}

function ModeButton({
  active,
  inert,
  onClick,
  emoji,
  label,
  priceLabel,
  ariaLabel,
}: {
  active: boolean;
  /**
   * True iff the button is a DEAD disabled button (greyed, click no-op). A
   * disabled-but-actionable Livraison (opens the address sheet) is NOT inert —
   * it stays clickable so it isn't a dead end.
   */
  inert: boolean;
  onClick: () => void;
  emoji: string;
  label: string;
  priceLabel: string;
  ariaLabel: string;
}): React.JSX.Element {
  // Style triangulation: 3 visual states (active / idle-enabled / disabled).
  const baseClass =
    "flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors";
  const styleClass = inert
    ? "cursor-not-allowed border border-zinc-200 bg-zinc-50 text-zinc-400"
    : active
      ? "border-2 border-emerald-700 bg-emerald-50 text-black"
      : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50";
  return (
    <button
      type="button"
      onClick={inert ? undefined : onClick}
      aria-pressed={active}
      aria-disabled={inert}
      aria-label={ariaLabel}
      className={`${baseClass} ${styleClass}`}
    >
      <span aria-hidden="true">{emoji}</span>
      <span>{label}</span>
      <span className="text-xs text-zinc-600">· {priceLabel}</span>
    </button>
  );
}
