/**
 * PWA-S12 (#464) — Tests for the pure Convex Auth cookie naming helper used
 * by `/api/signout/route.ts`.
 *
 * The names MUST stay in lock-step with `@convex-dev/auth/dist/nextjs/server/
 * cookies.js` — a name drift after a SDK bump would leave a stale session
 * cookie behind a successful « Ce n'est pas moi → » disown. These tests pin
 * the production naming + the localhost branch + the regex shape.
 */
import { describe, expect, it } from "vitest";
import {
  CONVEX_AUTH_COOKIE_BASE_NAMES,
  convexAuthCookieNames,
  isLocalHost,
} from "./convex-auth-cookies";

describe("Convex Auth cookie naming (SDK lock-step)", () => {
  it("pins the three SDK cookie base names (drift detection on SDK bumps)", () => {
    // If a SDK bump renames any of these, this assertion fails — forcing
    // the deletion list to be updated at the same time as the SDK pin.
    expect(CONVEX_AUTH_COOKIE_BASE_NAMES).toEqual([
      "__convexAuthJWT",
      "__convexAuthRefreshToken",
      "__convexAuthOAuthVerifier",
    ]);
  });

  describe("isLocalHost", () => {
    it("matches `localhost:<port>` (SDK convention — explicit port required)", () => {
      expect(isLocalHost("localhost:3000")).toBe(true);
      expect(isLocalHost("localhost:8080")).toBe(true);
    });

    it("matches `127.0.0.1:<port>`", () => {
      expect(isLocalHost("127.0.0.1:3000")).toBe(true);
    });

    it("does NOT match a bare `localhost` (no port — the SDK regex requires `:\\d+`)", () => {
      // Mirrors `/(localhost|127\.0\.0\.1):\d+/`. If we broaden this here
      // without the SDK doing the same, we'd issue deletions for a name
      // the SDK never set, and the prod cookie would survive.
      expect(isLocalHost("localhost")).toBe(false);
    });

    it("does NOT match an arbitrary production host", () => {
      expect(isLocalHost("artisan.kitchen-boost.com")).toBe(false);
      expect(isLocalHost("kitchen-boost.com")).toBe(false);
    });

    it("does NOT match a null host (defensive — request without `Host` header)", () => {
      expect(isLocalHost(null)).toBe(false);
    });
  });

  describe("convexAuthCookieNames", () => {
    it("returns the THREE `__Host-` prefixed names on a production host", () => {
      // Pinned literal — the `__Host-` prefix is what the browser enforces:
      // `Secure`, no `Domain`, `Path=/`. Without it the deletion targets a
      // cookie the SDK never set on this host.
      expect(convexAuthCookieNames("artisan.kitchen-boost.com")).toEqual([
        "__Host-__convexAuthJWT",
        "__Host-__convexAuthRefreshToken",
        "__Host-__convexAuthOAuthVerifier",
      ]);
    });

    it("returns the THREE bare names on localhost (Safari `http://localhost` carve-out)", () => {
      // Safari refuses `Secure` cookies on http:// — including localhost.
      // The SDK skips the `__Host-` prefix there (which requires `Secure`),
      // so the disown must too.
      expect(convexAuthCookieNames("localhost:3000")).toEqual([
        "__convexAuthJWT",
        "__convexAuthRefreshToken",
        "__convexAuthOAuthVerifier",
      ]);
    });

    it("falls back to the `__Host-` branch when the `Host` header is missing", () => {
      // Defensive : a request without a `Host` header is a misconfigured
      // proxy, not a localhost dev session. Better to issue the
      // prod-shaped deletion (no-op on dev anyway than the inverse, which
      // would leak the prod cookie).
      expect(convexAuthCookieNames(null)).toEqual([
        "__Host-__convexAuthJWT",
        "__Host-__convexAuthRefreshToken",
        "__Host-__convexAuthOAuthVerifier",
      ]);
    });
  });
});
