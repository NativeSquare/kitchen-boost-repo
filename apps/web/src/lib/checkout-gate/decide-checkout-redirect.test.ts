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
  it("redirects to /panier when the cart has 0 lines (hydrated)", () => {
    const action = decideCheckoutRedirect({ cartLineCount: 0, hydrated: true });
    expect(action.kind).toBe("redirect");
    if (action.kind !== "redirect") throw new Error("unreachable");
    expect(action.path).toBe("/panier");
  });

  it("stays on the page when the cart has 1+ line(s) (hydrated)", () => {
    expect(
      decideCheckoutRedirect({ cartLineCount: 1, hydrated: true }).kind,
    ).toBe("stay");
    expect(
      decideCheckoutRedirect({ cartLineCount: 5, hydrated: true }).kind,
    ).toBe("stay");
  });

  it("treats a negative count defensively as 0 (no crash on bogus input)", () => {
    // Pure functions should never throw on numerical edge values — the cart
    // store should never produce a negative count, but if it did, behaving
    // like « empty cart » is the safe choice (redirect, do NOT render the
    // checkout form against a bogus state).
    expect(
      decideCheckoutRedirect({ cartLineCount: -1, hydrated: true }).kind,
    ).toBe("redirect");
  });

  // ── Hydration-race regression (false /panier bounce) ──────────────────
  // The cart is localStorage-backed and rehydrates in a mount effect that
  // runs AFTER the child <CheckoutForm> redirect effect (React fires child
  // effects before parent effects). On a fresh /checkout load the form would
  // momentarily see 0 lines even though localStorage HAS items → it bounced
  // to /panier. The fix gates the decision behind `hydrated`: until the cart
  // has read localStorage we must neither redirect nor render the form.
  describe("hydration gate (no false /panier bounce)", () => {
    it("returns `wait` (never redirect) while the cart is NOT hydrated, even with 0 lines", () => {
      // 0 lines pre-hydration is the EXACT race that caused the bug: the
      // store starts EMPTY before localStorage is read. We must NOT redirect.
      const action = decideCheckoutRedirect({
        cartLineCount: 0,
        hydrated: false,
      });
      expect(action.kind).toBe("wait");
    });

    it("returns `wait` while not hydrated regardless of the (stale) line count", () => {
      expect(
        decideCheckoutRedirect({ cartLineCount: 3, hydrated: false }).kind,
      ).toBe("wait");
      expect(
        decideCheckoutRedirect({ cartLineCount: -1, hydrated: false }).kind,
      ).toBe("wait");
    });

    it("once hydrated, a non-empty cart STAYS (no bounce) — the bug is closed", () => {
      expect(
        decideCheckoutRedirect({ cartLineCount: 2, hydrated: true }).kind,
      ).toBe("stay");
    });

    it("once hydrated, a genuinely empty cart still redirects to /panier", () => {
      const action = decideCheckoutRedirect({
        cartLineCount: 0,
        hydrated: true,
      });
      expect(action.kind).toBe("redirect");
      if (action.kind !== "redirect") throw new Error("unreachable");
      expect(action.path).toBe("/panier");
    });
  });
});
