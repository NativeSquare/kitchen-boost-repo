/**
 * PWA-S6 (#454) — `decideCheckoutRedirect` — pure decision returning whether
 * `/checkout` should stay on the page or redirect back to `/panier`.
 *
 * Acceptance criterion (#454) : « Visite /checkout sans cmd dans panier →
 * redirect /panier ». An empty cart on /checkout makes no sense (nothing to
 * pay) so we send the user back to /panier where the « Ton panier est vide »
 * empty state already lives (`<CartView>` S5).
 *
 * Splitting the redirect rule from the React IO lets vitest pin every branch
 * in node env — mirrors the rest of the PWA decision modules.
 */
import { describe, expect, it } from "vitest";
import { decideCheckoutRedirect } from "./decide-checkout-redirect";

describe("decideCheckoutRedirect", () => {
  it("redirects to /panier when the cart has 0 lines", () => {
    const action = decideCheckoutRedirect({ cartLineCount: 0 });
    expect(action.kind).toBe("redirect");
    if (action.kind !== "redirect") throw new Error("unreachable");
    expect(action.path).toBe("/panier");
  });

  it("stays on the page when the cart has 1+ line(s)", () => {
    expect(decideCheckoutRedirect({ cartLineCount: 1 }).kind).toBe("stay");
    expect(decideCheckoutRedirect({ cartLineCount: 5 }).kind).toBe("stay");
  });

  it("treats a negative count defensively as 0 (no crash on bogus input)", () => {
    // Pure functions should never throw on numerical edge values — the cart
    // store should never produce a negative count, but if it did, behaving
    // like « empty cart » is the safe choice (redirect, do NOT render the
    // checkout form against a bogus state).
    expect(decideCheckoutRedirect({ cartLineCount: -1 }).kind).toBe("redirect");
  });
});
