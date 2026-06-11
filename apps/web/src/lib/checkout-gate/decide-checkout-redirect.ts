/**
 * PWA-S6 (#454) — pure decision returning whether `/checkout` should stay
 * on the page or redirect back to `/panier`.
 *
 * Acceptance criterion (#454) : « Visite /checkout sans cmd dans panier →
 * redirect /panier ». An empty cart on /checkout makes no sense (nothing to
 * pay) so the user is sent back to /panier where the « Ton panier est vide »
 * empty state already lives (`<CartView>` S5).
 *
 * Pure on purpose : the cart is owned by `<CartContext>` (localStorage,
 * client-side) and the navigation IO lives in the client component. This
 * function just answers « given a line count, what should happen? ».
 */

/**
 * The input the decision needs : the cart line count AND whether the cart
 * context has finished reading `localStorage`.
 *
 * `hydrated` closes the false-/panier-bounce race (issue: « /checkout bounce
 * to /panier with items in cart »). The cart is localStorage-backed and the
 * `<CartProvider>` rehydration runs in a mount effect that fires AFTER the
 * child `<CheckoutForm>` redirect effect (React commits child effects before
 * parent effects). On a fresh `/checkout` load the form would briefly read 0
 * lines even though localStorage HAS items → redirect to /panier. Until the
 * cart has read storage we must hold the decision (`wait`), never redirect.
 */
export type CheckoutRedirectInput = {
  cartLineCount: number;
  /** `true` once `<CartProvider>` has read localStorage (empty or not). */
  hydrated: boolean;
};

/**
 * The action the calling component should perform.
 *
 * `wait` = the cart hasn't hydrated yet : render nothing, do NOT redirect and
 * do NOT flash the form (we don't yet know if the persisted cart has items).
 */
export type CheckoutRedirectAction =
  | { kind: "wait" }
  | { kind: "stay" }
  | { kind: "redirect"; path: "/panier" };

/**
 * Decide the redirect for `/checkout`.
 *
 *  - not hydrated yet → `wait` (the localStorage cart is unknown; holding
 *    avoids the false bounce to /panier on a fresh load with persisted items),
 *  - hydrated + `cartLineCount <= 0` → redirect to /panier,
 *  - hydrated + positive count → stay.
 *
 * Negative counts are treated like 0 (defensive: pure functions don't throw
 * on numerical edge cases, and « redirect to /panier on bogus state » is
 * the safe choice — never render the checkout form against a corrupted
 * cart count).
 */
export function decideCheckoutRedirect(
  input: CheckoutRedirectInput,
): CheckoutRedirectAction {
  if (!input.hydrated) {
    return { kind: "wait" };
  }
  if (input.cartLineCount <= 0) {
    return { kind: "redirect", path: "/panier" };
  }
  return { kind: "stay" };
}
