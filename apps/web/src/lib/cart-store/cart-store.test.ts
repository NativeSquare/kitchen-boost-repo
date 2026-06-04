/**
 * PWA-S4 (#452) — `cart-store` — PURE reducer + types for the cart state
 * machine the `<CartContext>` will host. Written BEFORE the implementation
 * (TDD red).
 *
 * Cart contract (CONTEXT client-ordering "Cart") :
 *  - 1 row per (item × modifiers) combination (V1 dedup, NOT aggregated by
 *    item alone — kitchen reads unambiguous instructions).
 *  - Two identical (item + same modifier option set) adds INCREMENT the qty;
 *    different modifier option sets ⇒ TWO rows.
 *  - `note` is a SINGLE textarea at cart level (NOT per item), max 200 chars
 *    enforced here (truncated; the form layer also enforces in the input).
 *  - Totals are computed: `subtotalCentimes = sum(qty × (basePrice + sum(modifier priceDelta)))`.
 *    NO delivery fee in the cart totals — that lives in the toggle layer S5.
 *
 * Why pure: the reducer is the persistence-agnostic core; the `<CartContext>`
 * wraps it with localStorage IO. Pure tests pin the dedup + truncation rules
 * deterministically.
 */
import { describe, expect, it } from "vitest";
import {
  type CartAction,
  type CartState,
  EMPTY_CART,
  cartReducer,
  computeCartTotals,
  modifierSelectionKey,
} from "./cart-store";

const ITEM_BURGER = {
  itemId: "itm_burger",
  name: "Smash Burger",
  basePriceCentimes: 950, // 9.50 €
  photoUrl: null,
};
const ITEM_BAO = {
  itemId: "itm_bao",
  name: "Bao Porc",
  basePriceCentimes: 480,
  photoUrl: null,
};

const MOD_KETCHUP = {
  groupId: "grp_sauce",
  groupName: "Sauce",
  optionLabel: "Ketchup",
  priceDeltaCentimes: 0,
};
const MOD_MAYO = {
  groupId: "grp_sauce",
  groupName: "Sauce",
  optionLabel: "Mayo",
  priceDeltaCentimes: 0,
};
const MOD_DOUBLE = {
  groupId: "grp_size",
  groupName: "Taille",
  optionLabel: "Double",
  priceDeltaCentimes: 200,
};

describe("EMPTY_CART", () => {
  it("starts with no items and no note", () => {
    expect(EMPTY_CART.lines).toEqual([]);
    expect(EMPTY_CART.note).toBe("");
  });
});

describe("modifierSelectionKey — deterministic regardless of selection order", () => {
  it("returns the same key for the same options in different orders", () => {
    const k1 = modifierSelectionKey([MOD_KETCHUP, MOD_DOUBLE]);
    const k2 = modifierSelectionKey([MOD_DOUBLE, MOD_KETCHUP]);
    expect(k1).toBe(k2);
  });

  it("returns a different key when the option set differs", () => {
    const k1 = modifierSelectionKey([MOD_KETCHUP]);
    const k2 = modifierSelectionKey([MOD_MAYO]);
    expect(k1).not.toBe(k2);
  });
});

describe("cartReducer — ADD_LINE", () => {
  it("adds a fresh line when the (item × modifiers) combo is new", () => {
    const action: CartAction = {
      kind: "ADD_LINE",
      item: ITEM_BURGER,
      modifiers: [MOD_KETCHUP],
      qty: 1,
    };
    const next = cartReducer(EMPTY_CART, action);
    expect(next.lines).toHaveLength(1);
    expect(next.lines[0]?.qty).toBe(1);
    expect(next.lines[0]?.itemId).toBe("itm_burger");
    expect(next.lines[0]?.modifiers).toEqual([MOD_KETCHUP]);
  });

  it("INCREMENTS qty when the same (item × same modifier set) is re-added (CONTEXT 'Cart' dedup)", () => {
    let s: CartState = EMPTY_CART;
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BURGER,
      modifiers: [MOD_KETCHUP],
      qty: 1,
    });
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BURGER,
      modifiers: [MOD_KETCHUP],
      qty: 1,
    });
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.qty).toBe(2);
  });

  it("creates a SECOND line when the same item is added with a DIFFERENT modifier set (CONTEXT 'Cart' example: Ketchup × 1 + Mayo × 1)", () => {
    let s: CartState = EMPTY_CART;
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BURGER,
      modifiers: [MOD_KETCHUP],
      qty: 1,
    });
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BURGER,
      modifiers: [MOD_MAYO],
      qty: 1,
    });
    expect(s.lines).toHaveLength(2);
    expect(s.lines.map((l) => l.modifiers[0]?.optionLabel)).toEqual([
      "Ketchup",
      "Mayo",
    ]);
  });
});

describe("cartReducer — UPDATE_QTY", () => {
  it("updates the qty of an existing line", () => {
    let s: CartState = EMPTY_CART;
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BURGER,
      modifiers: [MOD_KETCHUP],
      qty: 1,
    });
    const lineId = s.lines[0]?.lineId;
    if (lineId === undefined) throw new Error("unreachable");
    s = cartReducer(s, { kind: "UPDATE_QTY", lineId, qty: 3 });
    expect(s.lines[0]?.qty).toBe(3);
  });

  it("REMOVES the line when qty drops to 0 (no orphan 0-qty rows)", () => {
    let s: CartState = EMPTY_CART;
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BURGER,
      modifiers: [MOD_KETCHUP],
      qty: 2,
    });
    const lineId = s.lines[0]?.lineId;
    if (lineId === undefined) throw new Error("unreachable");
    s = cartReducer(s, { kind: "UPDATE_QTY", lineId, qty: 0 });
    expect(s.lines).toHaveLength(0);
  });
});

describe("cartReducer — REMOVE_LINE", () => {
  it("drops the targeted line, keeps siblings", () => {
    let s: CartState = EMPTY_CART;
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BURGER,
      modifiers: [MOD_KETCHUP],
      qty: 1,
    });
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BAO,
      modifiers: [],
      qty: 1,
    });
    const burgerId = s.lines[0]?.lineId;
    if (burgerId === undefined) throw new Error("unreachable");
    s = cartReducer(s, { kind: "REMOVE_LINE", lineId: burgerId });
    expect(s.lines).toHaveLength(1);
    expect(s.lines[0]?.itemId).toBe("itm_bao");
  });
});

describe("cartReducer — SET_NOTE", () => {
  it("persists the note text", () => {
    const s = cartReducer(EMPTY_CART, {
      kind: "SET_NOTE",
      note: "Sans oignon merci",
    });
    expect(s.note).toBe("Sans oignon merci");
  });

  it("TRUNCATES the note at 200 chars (CONTEXT 'Note resto' V1 max)", () => {
    const long = "a".repeat(250);
    const s = cartReducer(EMPTY_CART, { kind: "SET_NOTE", note: long });
    expect(s.note).toHaveLength(200);
  });
});

describe("cartReducer — CLEAR", () => {
  it("resets state to empty", () => {
    let s: CartState = EMPTY_CART;
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BURGER,
      modifiers: [MOD_KETCHUP],
      qty: 1,
    });
    s = cartReducer(s, { kind: "SET_NOTE", note: "test" });
    s = cartReducer(s, { kind: "CLEAR" });
    expect(s).toEqual(EMPTY_CART);
  });
});

describe("computeCartTotals — subtotal aggregation", () => {
  it("sums qty × (basePrice + Σ modifier priceDelta) per line", () => {
    let s: CartState = EMPTY_CART;
    // 2 × (950 + 200 [Double] + 0 [Ketchup]) = 2300
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BURGER,
      modifiers: [MOD_DOUBLE, MOD_KETCHUP],
      qty: 2,
    });
    // 1 × 480 = 480
    s = cartReducer(s, {
      kind: "ADD_LINE",
      item: ITEM_BAO,
      modifiers: [],
      qty: 1,
    });
    const totals = computeCartTotals(s);
    expect(totals.subtotalCentimes).toBe(2300 + 480);
    expect(totals.itemCount).toBe(3);
  });

  it("returns zero for an empty cart", () => {
    const totals = computeCartTotals(EMPTY_CART);
    expect(totals.subtotalCentimes).toBe(0);
    expect(totals.itemCount).toBe(0);
  });
});
