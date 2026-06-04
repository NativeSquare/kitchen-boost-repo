/**
 * PWA-S4 (#452) — `decideModifierValidation` — PURE function that derives the
 * UI gate state for an item modal: which modifier groups are not-yet-satisfied
 * (badge "À choisir") and whether "Ajouter au panier" should be disabled
 * (US 19). Written BEFORE the implementation (TDD red).
 *
 * Rules (CONTEXT client-ordering "Modifier", Uber Eats pattern):
 *  - A group with `minSelect == 0` is OPTIONAL — never blocks.
 *  - A group with `minSelect >= 1` is REQUIRED — blocks until the user has
 *    selected at least `minSelect` options from it.
 *  - The "Ajouter au panier" button is enabled iff EVERY required group is
 *    satisfied (set of unsatisfied groups is empty).
 *  - The schema invariant `maxSelect >= max(1, minSelect)` is enforced
 *    upstream (server-side), so this decision does NOT recheck it; it
 *    consumes already-validated groups.
 *
 * Why pure: keeps the modal a thin renderer (read state → render badges).
 * vitest pins every branch in node env.
 */
import { describe, expect, it } from "vitest";
import {
  type ModifierGroupView,
  type ModifierSelectionMap,
  decideModifierValidation,
} from "./decide-modifier-validation";

const REQUIRED_SAUCE: ModifierGroupView = {
  groupId: "grp_sauce",
  name: "Sauce",
  minSelect: 1,
  maxSelect: 1,
  options: [
    { label: "Ketchup", priceDeltaCentimes: 0 },
    { label: "Mayo", priceDeltaCentimes: 0 },
  ],
};

const OPTIONAL_EXTRA: ModifierGroupView = {
  groupId: "grp_extra",
  name: "Suppléments",
  minSelect: 0,
  maxSelect: 3,
  options: [
    { label: "Bacon", priceDeltaCentimes: 150 },
    { label: "Cheddar", priceDeltaCentimes: 100 },
  ],
};

const REQUIRED_AT_LEAST_TWO: ModifierGroupView = {
  groupId: "grp_garn",
  name: "Garnitures (au moins 2)",
  minSelect: 2,
  maxSelect: 4,
  options: [
    { label: "Tomate", priceDeltaCentimes: 0 },
    { label: "Salade", priceDeltaCentimes: 0 },
    { label: "Oignon", priceDeltaCentimes: 0 },
  ],
};

describe("decideModifierValidation — no required groups", () => {
  it("is satisfied immediately when every group is optional (minSelect = 0)", () => {
    const result = decideModifierValidation([OPTIONAL_EXTRA], {});
    expect(result.canAddToCart).toBe(true);
    expect(result.unsatisfiedGroupIds).toEqual([]);
  });
});

describe("decideModifierValidation — one required group not satisfied", () => {
  it("reports the group id in `unsatisfiedGroupIds` + disables add-to-cart", () => {
    const result = decideModifierValidation([REQUIRED_SAUCE], {});
    expect(result.canAddToCart).toBe(false);
    expect(result.unsatisfiedGroupIds).toEqual(["grp_sauce"]);
  });

  it("becomes satisfied when minSelect options are selected", () => {
    const selections: ModifierSelectionMap = {
      grp_sauce: ["Ketchup"],
    };
    const result = decideModifierValidation([REQUIRED_SAUCE], selections);
    expect(result.canAddToCart).toBe(true);
    expect(result.unsatisfiedGroupIds).toEqual([]);
  });
});

describe("decideModifierValidation — required with minSelect > 1", () => {
  it("requires AT LEAST minSelect options before becoming satisfied", () => {
    const oneSelection: ModifierSelectionMap = {
      grp_garn: ["Tomate"],
    };
    expect(
      decideModifierValidation([REQUIRED_AT_LEAST_TWO], oneSelection)
        .canAddToCart,
    ).toBe(false);

    const twoSelections: ModifierSelectionMap = {
      grp_garn: ["Tomate", "Salade"],
    };
    expect(
      decideModifierValidation([REQUIRED_AT_LEAST_TWO], twoSelections)
        .canAddToCart,
    ).toBe(true);
  });
});

describe("decideModifierValidation — mixed required + optional", () => {
  it("only the REQUIRED group's satisfaction blocks (optional unfilled does not)", () => {
    const result = decideModifierValidation([REQUIRED_SAUCE, OPTIONAL_EXTRA], {
      grp_sauce: ["Ketchup"],
    });
    expect(result.canAddToCart).toBe(true);
    expect(result.unsatisfiedGroupIds).toEqual([]);
  });

  it("multiple unsatisfied required groups are ALL surfaced (so badges render on each)", () => {
    const result = decideModifierValidation(
      [REQUIRED_SAUCE, REQUIRED_AT_LEAST_TWO],
      {},
    );
    expect(result.canAddToCart).toBe(false);
    expect(result.unsatisfiedGroupIds).toEqual(["grp_sauce", "grp_garn"]);
  });
});
