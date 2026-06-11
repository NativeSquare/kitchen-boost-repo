/**
 * PWA cart — `decideItemPrice` — PURE price decider for ONE item line, given
 * its base price, the SELECTED modifier price deltas, and a quantity. Written
 * BEFORE the implementation (TDD red).
 *
 * Mirrors the cart store's per-line formula
 * (`qty × (basePrice + Σ modifier priceDelta)`, see `computeCartTotals`) so the
 * `<ItemModal>` « Ajouter au panier » button can show a LIVE price that matches
 * what the cart will actually charge. Centimes integers throughout.
 */
import { describe, expect, it } from "vitest";
import { decideItemPrice } from "./decide-item-price";

describe("decideItemPrice", () => {
  it("returns the base price when there are no modifiers and qty 1", () => {
    expect(decideItemPrice(950, [], 1)).toBe(950);
  });

  it("adds a single modifier priceDelta to the base", () => {
    // 950 + 200 (Double) = 1150
    expect(decideItemPrice(950, [{ priceDeltaCentimes: 200 }], 1)).toBe(1150);
  });

  it("sums several modifier priceDeltas with the base", () => {
    // 950 + 200 + 100 + 0 = 1250
    expect(
      decideItemPrice(
        950,
        [
          { priceDeltaCentimes: 200 },
          { priceDeltaCentimes: 100 },
          { priceDeltaCentimes: 0 },
        ],
        1,
      ),
    ).toBe(1250);
  });

  it("multiplies (base + Σ delta) by qty when qty > 1", () => {
    // 2 × (950 + 200) = 2300
    expect(decideItemPrice(950, [{ priceDeltaCentimes: 200 }], 2)).toBe(2300);
  });

  it("returns 0 when qty is 0", () => {
    expect(decideItemPrice(950, [{ priceDeltaCentimes: 200 }], 0)).toBe(0);
  });

  it("returns the base × qty for an empty modifier list", () => {
    // 3 × 480 = 1440
    expect(decideItemPrice(480, [], 3)).toBe(1440);
  });
});
