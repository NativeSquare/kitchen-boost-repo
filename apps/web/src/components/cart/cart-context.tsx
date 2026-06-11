"use client";

/**
 * PWA-S4 (#452) — `<CartContext>` React context that wraps the pure
 * `cartReducer` with React state + `localStorage` IO (CONTEXT
 * client-ordering « Cart » / decisions-log Q2).
 *
 * The reducer + types live in `@/lib/cart-store` and are unit-tested in
 * node env (dedup item×modifiers, note 200ch truncation, totals). This
 * component layer adds:
 *  - React state via `useReducer(cartReducer, EMPTY_CART)`,
 *  - localStorage rehydration on mount (key `kb-cart-v1`),
 *  - localStorage persistence on every state change (debounced via
 *    `useEffect`, NO cross-tab sync V1 — that's an accepted trade-off
 *    documented in PRD §10 Trade-offs « /panier perdu si l'utilisateur
 *    change de device, juste un buffer pré-checkout »).
 *
 * S5 will consume this context from `/panier` to render the actual cart
 * UI; S4 only initialises it so the Add-to-cart button on the item modal
 * has somewhere to dispatch.
 *
 * The provider is scoped under each tenant's PWA shell (rendered in
 * `app/menu/page.tsx` for S4) — the `__Host-kb_tenant` cookie + the
 * localStorage key bind the cart to ONE tenant via the page life-cycle;
 * cross-tenant cart isolation is structural (each tenant = its own host
 * = its own localStorage origin, ADR 0008).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useState,
  type Dispatch,
  type ReactNode,
} from "react";
import {
  EMPTY_CART,
  cartReducer,
  computeCartTotals,
  type CartAction,
  type CartItemView,
  type CartModifierSelection,
  type CartState,
  type CartTotals,
} from "@/lib/cart-store";

const STORAGE_KEY = "kb-cart-v1";

type CartContextValue = {
  state: CartState;
  totals: CartTotals;
  dispatch: Dispatch<CartAction>;
  /**
   * `false` on the server + the very first client render, flipped to `true`
   * once the mount effect has read `localStorage` (whether the stored cart
   * was empty or not — hydration means « we've read storage », NOT « the cart
   * is non-empty »). Consumers that gate navigation on the cart contents
   * (e.g. `<CheckoutForm>`'s empty-cart → /panier redirect) MUST wait for
   * `hydrated === true` before deciding, otherwise they race the rehydration
   * effect and bounce a non-empty persisted cart back to /panier.
   */
  hydrated: boolean;
  /** Sugar: dispatch ADD_LINE; the most common cart action. */
  addLine: (
    item: CartItemView,
    modifiers: ReadonlyArray<CartModifierSelection>,
    qty: number,
  ) => void;
};

const CartCtx = createContext<CartContextValue | null>(null);

/**
 * Defensive rehydrate: shape-check the JSON before trusting it.
 *
 * Exported (not just an internal helper) so the rehydration contract — « a
 * persisted non-empty cart is read back as non-empty » — is vitest-pinnable
 * in node env alongside the rest of the cart decisions. This is the source
 * the mount effect replays into the reducer.
 */
export function safeReadFromStorage(): CartState {
  if (typeof window === "undefined") return EMPTY_CART;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return EMPTY_CART;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "lines" in parsed &&
      Array.isArray((parsed as { lines: unknown }).lines) &&
      "note" in parsed &&
      typeof (parsed as { note: unknown }).note === "string"
    ) {
      return parsed as CartState;
    }
    return EMPTY_CART;
  } catch {
    // Corrupted JSON / quota / privacy mode → fall back to empty (NOT throw).
    return EMPTY_CART;
  }
}

export function CartProvider({
  children,
}: {
  children: ReactNode;
}): React.JSX.Element {
  // We initialise EMPTY then rehydrate on mount so SSR + first paint match
  // (localStorage isn't readable server-side; hydration mismatch would
  // throw a warning if we initialised from a non-deterministic source).
  const [state, dispatch] = useReducer(cartReducer, EMPTY_CART);

  // `false` until the mount effect has read localStorage. Stays `false` on the
  // server + first client render so SSR markup matches (localStorage isn't
  // readable server-side) — no hydration mismatch. Consumers gate navigation
  // on this so they never decide the empty-cart redirect against the
  // pre-rehydration EMPTY state (the false /panier-bounce race).
  const [hydrated, setHydrated] = useState(false);

  // Rehydrate once on mount.
  useEffect(() => {
    const stored = safeReadFromStorage();
    // Flag hydration as DONE regardless of whether the stored cart had items —
    // « hydrated » means « we've read storage », not « the cart is non-empty ».
    // Set it even on the empty-cart early-return below so a genuinely empty
    // cart still unblocks the consumer's (correct) redirect to /panier.
    setHydrated(true);
    if (stored.lines.length === 0 && stored.note === "") return;
    // Replace state with the persisted one — we don't have a REPLACE action
    // in the reducer (deliberately minimal); we re-add each line in order
    // and set the note. Done client-side once on mount, after the SSR
    // paint, so there's no hydration mismatch.
    for (const line of stored.lines) {
      dispatch({
        kind: "ADD_LINE",
        item: {
          itemId: line.itemId,
          name: line.name,
          basePriceCentimes: line.basePriceCentimes,
          photoUrl: line.photoUrl,
        },
        modifiers: line.modifiers,
        qty: line.qty,
      });
    }
    if (stored.note.length > 0) {
      dispatch({ kind: "SET_NOTE", note: stored.note });
    }
  }, []);

  // Persist on every change.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Quota / privacy mode → swallow (the cart is a buffer, not a SoT).
    }
  }, [state]);

  const totals = computeCartTotals(state);

  const addLine = useCallback(
    (
      item: CartItemView,
      modifiers: ReadonlyArray<CartModifierSelection>,
      qty: number,
    ) => {
      dispatch({ kind: "ADD_LINE", item, modifiers, qty });
    },
    [],
  );

  return (
    <CartCtx.Provider value={{ state, totals, dispatch, addLine, hydrated }}>
      {children}
    </CartCtx.Provider>
  );
}

/** Hook accessor — throws when called outside the provider. */
export function useCart(): CartContextValue {
  const ctx = useContext(CartCtx);
  if (ctx === null) {
    throw new Error("useCart() must be called inside <CartProvider>");
  }
  return ctx;
}
