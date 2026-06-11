/**
 * PWA — `<CartProvider>` rehydration core, exercised through its pure helper
 * `safeReadFromStorage` (same node-env, no-jsdom convention as the rest of the
 * PWA decision suite — see `checkout-gate/*.test.ts`).
 *
 * Regression context (« /checkout bounce to /panier with items in cart »):
 * the cart is localStorage-backed and rehydrates in a mount effect. The
 * `<CheckoutForm>` empty-cart → /panier redirect must wait for that effect
 * (gated on the context's `hydrated` flag) so a non-empty PERSISTED cart isn't
 * bounced. The two pieces that close the race are unit-pinned here + in
 * `checkout-gate/decide-checkout-redirect.test.ts`:
 *
 *   1. the redirect decision returns `wait` until `hydrated` (decision test),
 *   2. a persisted non-empty cart is read back as non-empty so that, once
 *      hydrated, the decision is `stay` not `redirect` (THIS file).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { safeReadFromStorage } from "./cart-context";
import { EMPTY_CART, type CartState } from "@/lib/cart-store";

const STORAGE_KEY = "kb-cart-v1";

/** Minimal in-memory localStorage stub for node env (no jsdom). */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      store.set(k, v);
    },
    removeItem: (k: string): void => {
      store.delete(k);
    },
    clear: (): void => {
      store.clear();
    },
  };
  // `safeReadFromStorage` guards on `typeof window === "undefined"`, so we must
  // expose BOTH `window` and `window.localStorage`.
  (globalThis as { window?: unknown }).window = { localStorage: fake };
  return store;
}

function uninstallLocalStorage(): void {
  delete (globalThis as { window?: unknown }).window;
}

const PERSISTED_NON_EMPTY: CartState = {
  lines: [
    {
      lineId: "item_1::",
      itemId: "item_1",
      name: "Smash Double",
      basePriceCentimes: 1290,
      photoUrl: null,
      modifiers: [],
      qty: 2,
    },
  ],
  note: "Sans oignon",
};

describe("safeReadFromStorage (cart rehydration source)", () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installLocalStorage();
  });

  afterEach(() => {
    uninstallLocalStorage();
  });

  it("reads a persisted NON-EMPTY cart back as non-empty (no false /panier bounce)", () => {
    // This is the exact data that, post-hydration, makes the checkout redirect
    // decision `stay` instead of bouncing to /panier. If this regressed, the
    // hydration gate would still hide the form forever.
    store.set(STORAGE_KEY, JSON.stringify(PERSISTED_NON_EMPTY));

    const read = safeReadFromStorage();

    expect(read.lines.length).toBe(1);
    expect(read.lines[0]?.qty).toBe(2);
    expect(read.note).toBe("Sans oignon");
  });

  it("returns EMPTY_CART when nothing is persisted (genuine empty cart → /panier)", () => {
    expect(safeReadFromStorage()).toEqual(EMPTY_CART);
  });

  it("falls back to EMPTY_CART on corrupted JSON (never throws)", () => {
    store.set(STORAGE_KEY, "{not-valid-json");
    expect(safeReadFromStorage()).toEqual(EMPTY_CART);
  });

  it("falls back to EMPTY_CART on a shape-invalid payload (defensive)", () => {
    store.set(STORAGE_KEY, JSON.stringify({ lines: "nope", note: 42 }));
    expect(safeReadFromStorage()).toEqual(EMPTY_CART);
  });

  it("returns EMPTY_CART when there is no window (SSR — hydrated stays false)", () => {
    uninstallLocalStorage();
    expect(safeReadFromStorage()).toEqual(EMPTY_CART);
    store = installLocalStorage(); // restore for afterEach symmetry
  });
});
