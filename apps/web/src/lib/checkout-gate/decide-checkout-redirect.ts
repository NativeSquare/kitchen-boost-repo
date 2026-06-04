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

/** The input the decision needs — just the cart line count for now. */
export type CheckoutRedirectInput = {
  cartLineCount: number;
};

/** The action the calling component should perform. */
export type CheckoutRedirectAction =
  | { kind: "stay" }
  | { kind: "redirect"; path: "/panier" };

/**
 * Decide the redirect for `/checkout`. `cartLineCount <= 0` redirects to
 * /panier; any positive count stays.
 *
 * Negative counts are treated like 0 (defensive: pure functions don't throw
 * on numerical edge cases, and « redirect to /panier on bogus state » is
 * the safe choice — never render the checkout form against a corrupted
 * cart count).
 */
export function decideCheckoutRedirect(
  input: CheckoutRedirectInput,
): CheckoutRedirectAction {
  if (input.cartLineCount <= 0) {
    return { kind: "redirect", path: "/panier" };
  }
  return { kind: "stay" };
}
