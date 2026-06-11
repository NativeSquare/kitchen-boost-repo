/**
 * PWA cart UX fix — `cartLineModifierLabels` — PURE helper turning a cart
 * line's selected modifiers into a list of concise chip labels rendered
 * under the item name in `<CartView>` so two same-item / different-modifier
 * lines (e.g. « Smash Burger · Fromage » vs « Smash Burger · Bacon ») are
 * unmistakable at a glance.
 *
 * Written BEFORE the implementation (TDD red). The helper owns the label
 * shape ONLY — the React layer owns the chip markup.
 */
import { describe, expect, it } from "vitest";
import type { CartModifierSelection } from "./cart-store";
import { cartLineModifierLabels } from "./cart-line-modifiers-label";

const FROMAGE: CartModifierSelection = {
  groupId: "grp_supp",
  groupName: "Suppléments",
  optionLabel: "Fromage",
  priceDeltaCentimes: 100,
};
const BACON: CartModifierSelection = {
  groupId: "grp_supp",
  groupName: "Suppléments",
  optionLabel: "Bacon",
  priceDeltaCentimes: 150,
};
const SAIGNANT: CartModifierSelection = {
  groupId: "grp_cuisson",
  groupName: "Cuisson",
  optionLabel: "Saignant",
  priceDeltaCentimes: 0,
};

describe("cartLineModifierLabels", () => {
  it("returns an empty array when there are no modifiers", () => {
    expect(cartLineModifierLabels([])).toEqual([]);
  });

  it("returns one concise label per selected option (option label only)", () => {
    expect(cartLineModifierLabels([FROMAGE])).toEqual(["Fromage"]);
  });

  it("keeps two same-item different-modifier selections distinguishable", () => {
    expect(cartLineModifierLabels([FROMAGE])).toEqual(["Fromage"]);
    expect(cartLineModifierLabels([BACON])).toEqual(["Bacon"]);
  });

  it("preserves the selection order for multiple modifiers", () => {
    expect(cartLineModifierLabels([SAIGNANT, FROMAGE, BACON])).toEqual([
      "Saignant",
      "Fromage",
      "Bacon",
    ]);
  });

  it("trims surrounding whitespace and drops blank option labels", () => {
    expect(
      cartLineModifierLabels([
        { ...FROMAGE, optionLabel: "  Fromage  " },
        { ...BACON, optionLabel: "   " },
      ]),
    ).toEqual(["Fromage"]);
  });
});
