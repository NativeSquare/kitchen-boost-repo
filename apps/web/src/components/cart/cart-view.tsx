"use client";

/**
 * PWA-S5 (#453) — `<CartView>` : the body of `/panier` (PRD US 20-23,
 * CONTEXT client-ordering « Cart » / « Note resto »).
 *
 * Renders the list of cart lines (1 per item × modifier combination,
 * dedup pinned in `cart-store.test.ts`), an inline qty stepper + delete
 * per line, the Note resto textarea (200ch max, enforced both at the
 * input + at the reducer), and the totals row (`<CartTotals>`) that
 * couples the cart subtotal with the `<DeliveryModeContext>` (delivery
 * fee or 0 for C&C).
 *
 * The component is intentionally thin — every decision (dedup,
 * truncation, fee resolution, fee view) lives in the pure
 * `lib/cart-store` + `lib/delivery-mode` modules; this file only owns
 * the React IO.
 */
import { useCart } from "./cart-context";
import { useDeliveryMode } from "@/components/delivery-mode/delivery-mode-context";
import { decideCartTotals, type DeliveryFeeView } from "@/lib/delivery-mode";
import type { CartLine } from "@/lib/cart-store";

/** Note resto max length — kept in sync with the reducer truncation (200ch). */
const NOTE_MAX_LENGTH = 200;

/** FR currency formatter (same shape as `<MenuView>` and the toggle). */
function formatEur(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(centimes / 100);
}

export function CartView(): React.JSX.Element {
  const { state, totals, dispatch } = useCart();
  const { verdict, mode } = useDeliveryMode();

  const totalsRow = decideCartTotals({
    subtotalCentimes: totals.subtotalCentimes,
    mode,
    verdict,
  });

  if (state.lines.length === 0) {
    return (
      <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-8 text-center">
        <p className="text-base text-zinc-600">
          Ton panier est vide. Ajoute des plats depuis le menu pour commander.
        </p>
        <a
          href="/menu"
          className="self-center text-sm font-medium text-emerald-700 underline-offset-2 hover:underline"
        >
          ← Retour au menu
        </a>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ul aria-label="Lignes du panier" className="flex flex-col gap-3">
        {state.lines.map((line) => (
          <CartLineRow
            key={line.lineId}
            line={line}
            onUpdateQty={(qty) =>
              dispatch({ kind: "UPDATE_QTY", lineId: line.lineId, qty })
            }
            onRemove={() =>
              dispatch({ kind: "REMOVE_LINE", lineId: line.lineId })
            }
          />
        ))}
      </ul>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-zinc-700">
          Une note pour le resto ? — allergies, demandes spéciales
        </span>
        <textarea
          value={state.note}
          onChange={(e) => dispatch({ kind: "SET_NOTE", note: e.target.value })}
          maxLength={NOTE_MAX_LENGTH}
          rows={3}
          placeholder="Optionnel. Ex : « sans oignon, merci »"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-black placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          aria-describedby="cart-note-count"
        />
        <span
          id="cart-note-count"
          aria-live="polite"
          className="self-end text-xs text-zinc-500"
        >
          {state.note.length} / {NOTE_MAX_LENGTH}
        </span>
      </label>

      <CartTotals totals={totalsRow} />
    </div>
  );
}

function CartLineRow({
  line,
  onUpdateQty,
  onRemove,
}: {
  line: CartLine;
  onUpdateQty: (qty: number) => void;
  onRemove: () => void;
}): React.JSX.Element {
  // Per-line price = qty × (base + Σ modifier priceDelta) — same formula
  // as `computeCartTotals` in `cart-store.ts`, kept inline for the row
  // display so the user sees the rolling total per line.
  const modifierSum = line.modifiers.reduce(
    (acc, m) => acc + m.priceDeltaCentimes,
    0,
  );
  const linePrice = line.qty * (line.basePriceCentimes + modifierSum);

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-base font-medium text-black">{line.name}</span>
          {line.modifiers.length > 0 && (
            <span className="text-xs text-zinc-600">
              {line.modifiers
                .map((m) => `${m.groupName} : ${m.optionLabel}`)
                .join(" · ")}
            </span>
          )}
        </div>
        <span className="text-base font-medium text-black">
          {formatEur(linePrice)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div
          role="group"
          aria-label={`Quantité — ${line.name}`}
          className="flex items-center gap-2"
        >
          <button
            type="button"
            onClick={() => onUpdateQty(Math.max(1, line.qty - 1))}
            aria-label="Diminuer la quantité"
            className="h-8 w-8 rounded-full border border-zinc-300 text-base hover:bg-zinc-100"
          >
            −
          </button>
          <span aria-live="polite" className="w-6 text-center text-base">
            {line.qty}
          </span>
          <button
            type="button"
            onClick={() => onUpdateQty(line.qty + 1)}
            aria-label="Augmenter la quantité"
            className="h-8 w-8 rounded-full border border-zinc-300 text-base hover:bg-zinc-100"
          >
            +
          </button>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Supprimer ${line.name} du panier`}
          className="text-xs font-medium text-red-700 underline-offset-2 hover:underline"
        >
          Supprimer
        </button>
      </div>
    </li>
  );
}

function CartTotals({
  totals,
}: {
  totals: ReturnType<typeof decideCartTotals>;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white p-4">
      <Row label="Sous-total" value={formatEur(totals.subtotalCentimes)} />
      <DeliveryFeeRow view={totals.deliveryFeeView} />
      <div className="my-2 border-t border-zinc-200" />
      <Row label="Total" value={formatEur(totals.totalCentimes)} emphasis />
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={
          emphasis === true
            ? "text-base font-semibold text-black"
            : "text-sm text-zinc-700"
        }
      >
        {label}
      </span>
      <span
        className={
          emphasis === true
            ? "text-base font-semibold text-black"
            : "text-sm text-black"
        }
      >
        {value}
      </span>
    </div>
  );
}

function DeliveryFeeRow({
  view,
}: {
  view: DeliveryFeeView;
}): React.JSX.Element {
  switch (view.kind) {
    case "free-pickup":
      return <Row label="Retrait sur place" value="Gratuit" />;
    case "plain-fee":
      return (
        <Row label="Frais de livraison" value={formatEur(view.feeCentimes)} />
      );
    case "offered-by-resto":
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-zinc-700">Frais de livraison</span>
            <span className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500 line-through">
                {formatEur(view.grossFeeCentimes)}
              </span>
              <span className="font-medium text-black">
                {formatEur(view.clientFeeCentimes)}
              </span>
            </span>
          </div>
          <span className="self-end text-xs text-emerald-700">
            Offert par {view.restoName}
          </span>
        </div>
      );
    case "partial-absorption":
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm text-zinc-700">Frais de livraison</span>
            <span className="flex items-center gap-2 text-sm">
              <span className="text-zinc-500 line-through">
                {formatEur(view.grossFeeCentimes)}
              </span>
              <span className="font-medium text-black">
                {formatEur(view.clientFeeCentimes)}
              </span>
            </span>
          </div>
          <span className="self-end text-xs text-emerald-700">
            Offert par {view.restoName}
          </span>
        </div>
      );
    default: {
      const _exhaustive: never = view;
      throw new Error(
        `Unhandled delivery fee view kind: ${String((_exhaustive as { kind: string }).kind)}`,
      );
    }
  }
}
