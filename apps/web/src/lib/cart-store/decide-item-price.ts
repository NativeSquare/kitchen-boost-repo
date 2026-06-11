/**
 * PWA cart — `decideItemPrice` — PURE price decider for ONE item line.
 *
 * Returns `qty × (basePrice + Σ modifier priceDelta)` in centimes, mirroring
 * the per-line formula of `computeCartTotals` (see `cart-store.ts`). The
 * `<ItemModal>` « Ajouter au panier » button uses this so its label shows a
 * LIVE price that matches exactly what the cart will charge once the line is
 * added — base price alone is NOT enough (it ignores selected supplements).
 *
 * Centimes integers throughout; no rounding needed (all inputs are integers).
 */
export function decideItemPrice(
  basePriceCentimes: number,
  modifiers: ReadonlyArray<{ priceDeltaCentimes: number }>,
  qty: number,
): number {
  const modifierSum = modifiers.reduce(
    (acc, m) => acc + m.priceDeltaCentimes,
    0,
  );
  return qty * (basePriceCentimes + modifierSum);
}
