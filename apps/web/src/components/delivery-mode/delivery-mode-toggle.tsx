"use client";

/**
 * PWA-S5 (#453) — `<DeliveryModeToggle>`: header-permanent toggle (US 24,
 * CONTEXT client-ordering « Mode toggle », decisions-log Q7).
 *
 * Two buttons, ALWAYS visible side-by-side : [🛵 Livraison · X €] [🚶
 * Retrait · Gratuit]. The current mode is filled-green; the other is
 * outlined-zinc. A disabled mode (per `<DeliveryModeContext>`'s decision)
 * renders greyed + `aria-disabled` + click no-op.
 *
 * Switching is INSTANT (no async, no spinner) — Q7 « switch sans
 * re-quote, verdict cache 2 modes »: clicking the other button just
 * updates the in-memory mode, which triggers a `<CartTotals>` re-render
 * with the precomputed fee for that mode.
 */
import { useDeliveryMode } from "./delivery-mode-context";

/** FR currency formatter (same shape as `<MenuView>`). */
function formatEur(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(centimes / 100);
}

export function DeliveryModeToggle(): React.JSX.Element {
  const { verdict, mode, setMode, deliveryDisabled, pickupDisabled } =
    useDeliveryMode();

  // Delivery fee label: gross fee from the cached verdict if deliverable,
  // else « — » (button is disabled anyway, but stays readable).
  const deliveryLabel =
    verdict !== null && verdict.deliverable ? formatEur(verdict.fee) : "—";

  return (
    <div
      role="group"
      aria-label="Mode de récupération de la commande"
      className="flex w-full gap-2"
    >
      <ModeButton
        active={mode === "delivery"}
        disabled={deliveryDisabled}
        onClick={() => setMode("delivery")}
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
    ? "cursor-not-allowed border border-zinc-200 bg-zinc-50 text-zinc-400"
    : active
      ? "border-2 border-emerald-700 bg-emerald-50 text-black"
      : "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50";
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
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
