/**
 * PWA-S4 (#452) — `cart-store` — pure reducer + types for the cart state
 * (CONTEXT client-ordering "Cart" / "Note resto"). The `<CartContext>`
 * wraps this with React state + localStorage IO; this module is the
 * persistence-agnostic core unit-tested in `cart-store.test.ts`.
 *
 * Dedup rule V1 (CONTEXT « Cart » example: « Smash Double - Ketchup × 1 et
 * Smash Double - Mayo × 1 = 2 lignes ») : 1 row per (itemId × modifier
 * selection set). Two `ADD_LINE` actions with the same item AND the same set
 * of modifier options (order-insensitive) increment the existing line's qty;
 * a different option set creates a fresh line.
 *
 * Note resto V1: single textarea at cart level, max 200 chars (CONTEXT
 * « Note resto »). Truncation enforced here so the persistence layer never
 * receives a > 200 char value, even if the input layer is bypassed.
 *
 * Totals V1: subtotal only — delivery fee is computed by the toggle layer
 * (S5) from the cached delivery quote, not part of cart state.
 */

/** Subset of `PublicMenuItem` cart lines need. */
export type CartItemView = {
  itemId: string;
  name: string;
  basePriceCentimes: number;
  photoUrl: string | null;
};

/** One selected modifier option attached to a cart line. */
export type CartModifierSelection = {
  groupId: string;
  groupName: string;
  optionLabel: string;
  priceDeltaCentimes: number;
};

/** One cart line — unique by `lineId` (derived from item + modifier-set key). */
export type CartLine = {
  /** Stable id = `${itemId}::${modifierSelectionKey(modifiers)}`. */
  lineId: string;
  itemId: string;
  name: string;
  basePriceCentimes: number;
  photoUrl: string | null;
  modifiers: ReadonlyArray<CartModifierSelection>;
  qty: number;
};

/** Full cart state — lines (ordered by first-add) + Note resto + max-200ch enforced. */
export type CartState = {
  lines: ReadonlyArray<CartLine>;
  /** Note resto (CONTEXT client-ordering) — single textarea, 200ch max V1. */
  note: string;
};

/** Reducer action set. */
export type CartAction =
  | {
      kind: "ADD_LINE";
      item: CartItemView;
      modifiers: ReadonlyArray<CartModifierSelection>;
      qty: number;
    }
  | { kind: "UPDATE_QTY"; lineId: string; qty: number }
  | { kind: "REMOVE_LINE"; lineId: string }
  | { kind: "SET_NOTE"; note: string }
  | { kind: "CLEAR" };

/** Initial empty state. */
export const EMPTY_CART: CartState = { lines: [], note: "" };

/** Note resto max length (CONTEXT « Note resto » V1). */
const NOTE_MAX_LENGTH = 200;

/**
 * Build a deterministic key from a modifier selection set. Two equivalent
 * sets (same options, any order) produce the same key — the dedup
 * mechanism for `ADD_LINE`. The key is a sorted, joined string of
 * `${groupId}:${optionLabel}` segments.
 */
export function modifierSelectionKey(
  modifiers: ReadonlyArray<CartModifierSelection>,
): string {
  return [...modifiers]
    .map((m) => `${m.groupId}:${m.optionLabel}`)
    .sort()
    .join("|");
}

function lineIdOf(
  itemId: string,
  modifiers: ReadonlyArray<CartModifierSelection>,
): string {
  return `${itemId}::${modifierSelectionKey(modifiers)}`;
}

/** Reducer — pure. */
export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.kind) {
    case "ADD_LINE": {
      const lineId = lineIdOf(action.item.itemId, action.modifiers);
      const existing = state.lines.find((l) => l.lineId === lineId);
      if (existing !== undefined) {
        return {
          ...state,
          lines: state.lines.map((l) =>
            l.lineId === lineId ? { ...l, qty: l.qty + action.qty } : l,
          ),
        };
      }
      const fresh: CartLine = {
        lineId,
        itemId: action.item.itemId,
        name: action.item.name,
        basePriceCentimes: action.item.basePriceCentimes,
        photoUrl: action.item.photoUrl,
        modifiers: [...action.modifiers],
        qty: action.qty,
      };
      return { ...state, lines: [...state.lines, fresh] };
    }
    case "UPDATE_QTY": {
      if (action.qty <= 0) {
        return {
          ...state,
          lines: state.lines.filter((l) => l.lineId !== action.lineId),
        };
      }
      return {
        ...state,
        lines: state.lines.map((l) =>
          l.lineId === action.lineId ? { ...l, qty: action.qty } : l,
        ),
      };
    }
    case "REMOVE_LINE": {
      return {
        ...state,
        lines: state.lines.filter((l) => l.lineId !== action.lineId),
      };
    }
    case "SET_NOTE": {
      const truncated = action.note.slice(0, NOTE_MAX_LENGTH);
      return { ...state, note: truncated };
    }
    case "CLEAR": {
      return EMPTY_CART;
    }
    default: {
      const _exhaustive: never = action;
      throw new Error(
        `Unhandled cart action: ${String((_exhaustive as { kind: string }).kind)}`,
      );
    }
  }
}

/** Totals derived from cart state — pure. */
export type CartTotals = {
  subtotalCentimes: number;
  itemCount: number;
};

export function computeCartTotals(state: CartState): CartTotals {
  let subtotal = 0;
  let itemCount = 0;
  for (const line of state.lines) {
    const modifierSum = line.modifiers.reduce(
      (acc, m) => acc + m.priceDeltaCentimes,
      0,
    );
    subtotal += line.qty * (line.basePriceCentimes + modifierSum);
    itemCount += line.qty;
  }
  return { subtotalCentimes: subtotal, itemCount };
}
