/**
 * PWA-S4 (#452) — `cart-store` module API.
 *
 * Pure reducer + types consumed by the React `<CartContext>` (S4) and later
 * the `<CartView>` of S5. Splitting the reducer from the IO (localStorage,
 * cross-tab sync) keeps the dedup + truncation rules vitest-pinnable in
 * node env.
 */
export {
  EMPTY_CART,
  cartReducer,
  computeCartTotals,
  modifierSelectionKey,
  type CartAction,
  type CartItemView,
  type CartLine,
  type CartModifierSelection,
  type CartState,
  type CartTotals,
} from "./cart-store";
