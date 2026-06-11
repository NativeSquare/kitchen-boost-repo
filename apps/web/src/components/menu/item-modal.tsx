"use client";

/**
 * PWA-S4 (#452) — `<ItemModal>` — Vaul bottom-sheet (mobile) / side-drawer
 * (desktop ≥ md) for one menu item (US 18, US 19 — modifier required gate +
 * « À choisir » badge, decisions-log Q2 a).
 *
 * IO contract:
 *  - `open` + `onClose` drive the Drawer (Vaul) primitive — the parent
 *    `<MenuView>` owns the URL sync (`?item=<id>`) so the back button
 *    closes the modal without losing scroll position.
 *  - Local state holds the modifier selections + qty; on submit, we
 *    `addLine(item, modifiers, qty)` via `useCart()` then close.
 *
 * Gate logic delegates entirely to `decideModifierValidation` (pure,
 * vitest-pinned in `lib/menu-filters`): every required group must reach
 * `minSelect`; on the unsatisfied required groups we render the « À
 * choisir » badge inline; « Ajouter au panier » is disabled.
 *
 * Single-select groups (`maxSelect === 1`) render as radio behaviour
 * (tap an option replaces); multi-select groups respect `maxSelect`
 * (tap once past the cap is ignored).
 */
import { useCallback, useMemo, useState } from "react";
import type {
  PublicMenuItem,
  PublicModifierGroup,
} from "@packages/backend/convex/lib/menu/catalog";
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
  decideModifierValidation,
  type ModifierSelectionMap,
} from "@/lib/menu-filters";
import type { CartModifierSelection } from "@/lib/cart-store";
import { decideItemPrice } from "@/lib/cart-store/decide-item-price";
import { useCart } from "@/components/cart/cart-context";

export type ItemModalProps = {
  /** The item the URL `?item=<id>` resolved to, or null when none / not found. */
  item: PublicMenuItem | null;
  open: boolean;
  onClose: () => void;
  formatEur: (centimes: number) => string;
};

export function ItemModal({
  item,
  open,
  onClose,
  formatEur,
}: ItemModalProps): React.JSX.Element | null {
  // Reset selections every time the open item changes (keyed render below).
  if (item === null) return null;

  return (
    <Drawer
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DrawerContent>
        <ItemModalBody
          key={item._id}
          item={item}
          onClose={onClose}
          formatEur={formatEur}
        />
      </DrawerContent>
    </Drawer>
  );
}

/**
 * Inner body — keyed on `item._id` so the modifier selections + qty reset
 * every time the user opens a different item.
 */
function ItemModalBody({
  item,
  onClose,
  formatEur,
}: {
  item: PublicMenuItem;
  onClose: () => void;
  formatEur: (centimes: number) => string;
}): React.JSX.Element {
  const { addLine } = useCart();
  const [selections, setSelections] = useState<ModifierSelectionMap>({});
  const [qty, setQty] = useState(1);

  const groupViews = useMemo(
    () =>
      item.modifierGroups.map((g) => ({
        groupId: g._id,
        name: g.name,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        options: g.options.map((o) => ({
          label: o.label,
          priceDeltaCentimes: o.priceDelta,
        })),
      })),
    [item],
  );

  const validation = useMemo(
    () => decideModifierValidation(groupViews, selections),
    [groupViews, selections],
  );

  const unsatisfied = new Set(validation.unsatisfiedGroupIds);

  const toggleOption = useCallback(
    (group: PublicModifierGroup, optionLabel: string) => {
      setSelections((current) => {
        const groupId = group._id;
        const currentForGroup = current[groupId] ?? [];
        const already = currentForGroup.includes(optionLabel);

        // Single-select group (radio behaviour): tap replaces, tap-again
        // unselects (lets the user clear an OPTIONAL single-select).
        if (group.maxSelect === 1) {
          if (already) {
            const { [groupId]: _drop, ...rest } = current;
            return rest;
          }
          return { ...current, [groupId]: [optionLabel] };
        }

        // Multi-select group: tap toggles within `maxSelect` cap.
        if (already) {
          const next = currentForGroup.filter((l) => l !== optionLabel);
          return { ...current, [groupId]: next };
        }
        if (currentForGroup.length >= group.maxSelect) {
          // Cap reached — ignore (no toast V1, the radio-like visual is enough).
          return current;
        }
        return { ...current, [groupId]: [...currentForGroup, optionLabel] };
      });
    },
    [],
  );

  // Flatten the current selections into the `CartModifierSelection[]` the cart
  // expects. Reused both to add the line AND to compute the LIVE button price
  // (so the label reflects selected supplements, not just the base price).
  const selectedModifiers = useMemo<CartModifierSelection[]>(() => {
    const flat: CartModifierSelection[] = [];
    for (const group of item.modifierGroups) {
      const selectedLabels = selections[group._id] ?? [];
      for (const option of group.options) {
        if (selectedLabels.includes(option.label)) {
          flat.push({
            groupId: group._id,
            groupName: group.name,
            optionLabel: option.label,
            priceDeltaCentimes: option.priceDelta,
          });
        }
      }
    }
    return flat;
  }, [item, selections]);

  // Live price for the « Ajouter au panier » label: qty × (base + Σ deltas),
  // matching exactly what the cart will charge for this line.
  const livePriceCentimes = decideItemPrice(
    item.basePrice,
    selectedModifiers,
    qty,
  );

  const onAddToCart = useCallback(() => {
    addLine(
      {
        itemId: item._id,
        name: item.name,
        basePriceCentimes: item.basePrice,
        photoUrl: item.photoUrl,
      },
      selectedModifiers,
      qty,
    );
    onClose();
  }, [item, selectedModifiers, qty, addLine, onClose]);

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{item.name}</DrawerTitle>
        {item.description.length > 0 && (
          <DrawerDescription>{item.description}</DrawerDescription>
        )}
      </DrawerHeader>

      <div className="flex flex-col gap-6 px-4 pb-4">
        {item.allergens.length > 0 && (
          <p className="text-xs text-zinc-500">
            Allergènes : {item.allergens.join(", ")}
          </p>
        )}

        {item.modifierGroups.map((group) => {
          const selected = selections[group._id] ?? [];
          const isUnsatisfied = unsatisfied.has(group._id);
          const headerLabel =
            group.minSelect === 0
              ? `${group.name} (facultatif)`
              : group.minSelect === group.maxSelect
                ? `${group.name} (à choisir : ${group.minSelect})`
                : `${group.name} (au moins ${group.minSelect})`;
          return (
            <fieldset key={group._id} className="flex flex-col gap-2">
              <legend className="flex items-center gap-2 text-sm font-medium text-black">
                <span>{headerLabel}</span>
                {isUnsatisfied && (
                  <span
                    role="status"
                    aria-label="Choix obligatoire non satisfait"
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
                  >
                    À choisir
                  </span>
                )}
              </legend>
              <div className="flex flex-col gap-1">
                {group.options.map((option) => {
                  const isSelected = selected.includes(option.label);
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() => toggleOption(group, option.label)}
                      aria-pressed={isSelected}
                      className={
                        isSelected
                          ? "flex items-center justify-between rounded-md border-2 border-emerald-600 bg-emerald-50 px-3 py-2 text-left text-sm text-black"
                          : "flex items-center justify-between rounded-md border border-zinc-300 px-3 py-2 text-left text-sm text-zinc-700 hover:bg-zinc-50"
                      }
                    >
                      <span>{option.label}</span>
                      {option.priceDelta > 0 && (
                        <span className="text-xs text-zinc-600">
                          +{formatEur(option.priceDelta)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}

        <QuantityStepper qty={qty} onChange={setQty} />
      </div>

      <DrawerFooter>
        <button
          type="button"
          onClick={onAddToCart}
          disabled={!validation.canAddToCart}
          className={
            validation.canAddToCart
              ? "rounded-lg bg-emerald-700 px-4 py-3 text-base font-medium text-white hover:bg-emerald-800"
              : "cursor-not-allowed rounded-lg bg-zinc-300 px-4 py-3 text-base font-medium text-zinc-600"
          }
        >
          {validation.canAddToCart
            ? `Ajouter au panier · ${formatEur(livePriceCentimes)}`
            : "Sélectionne les options obligatoires"}
        </button>
        <DrawerClose
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-100"
          type="button"
        >
          Fermer
        </DrawerClose>
      </DrawerFooter>
    </>
  );
}

function QuantityStepper({
  qty,
  onChange,
}: {
  qty: number;
  onChange: (qty: number) => void;
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium text-black">Quantité</span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, qty - 1))}
          aria-label="Diminuer la quantité"
          className="h-9 w-9 rounded-full border border-zinc-300 text-base hover:bg-zinc-100"
        >
          −
        </button>
        <span aria-live="polite" className="w-6 text-center text-base">
          {qty}
        </span>
        <button
          type="button"
          onClick={() => onChange(qty + 1)}
          aria-label="Augmenter la quantité"
          className="h-9 w-9 rounded-full border border-zinc-300 text-base hover:bg-zinc-100"
        >
          +
        </button>
      </div>
    </div>
  );
}
