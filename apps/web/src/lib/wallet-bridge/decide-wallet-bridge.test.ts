/**
 * PWA-S9b (#461) — `decideWalletBridgeInterception` — pure decision feeding
 * the PWA edge middleware (`apps/web/src/proxy.ts`) extension that intercepts
 * the `?wallet=<serialNumber>` deep-link query parameter embedded in the
 * Wallet pass back-of-pass URL (decisions-log Q5 « Bridge identité au tap
 * deep-link », US 39 / 40 / 41 / 42).
 *
 * Written BEFORE the implementation (TDD red).
 *
 * Branches we pin:
 *  1. URL has a valid `?wallet=<serial>` → INTERCEPT: return the serial + the
 *     clean URL string with the `wallet` query param stripped (and only that
 *     param — other params survive). The middleware then sets a short-lived
 *     `__Host-kb_wallet_bridge_pending` cookie and 307-redirects to the clean
 *     URL so the browser's address bar is cleaned (issue AC « URL `?wallet=`
 *     cleared après bridge »).
 *  2. URL has NO `wallet` param → PASSTHROUGH (no-op for the middleware).
 *  3. URL has `wallet=` but the value is empty / malformed (whitespace, too
 *     short, illegal chars) → PASSTHROUGH-AND-STRIP: still strip the param so
 *     the URL stays clean, but do NOT set the bridge cookie (no bridge to
 *     attempt — issue AC « Serial invalide / non-trouvé → graceful »).
 *  4. URL has multiple `wallet=` values → take the FIRST one (the only one
 *     that can plausibly come from a Wallet pass back-of-pass URL); strip
 *     them all from the clean URL.
 *
 * The decision is PURE (no Convex round-trip, no cookie IO) so vitest pins
 * every branch in node env without spinning up Next.js — same shape as
 * `decideTenantResolution` (#449) / `decideManifest` (#450).
 */
import { describe, expect, it } from "vitest";
import { decideWalletBridgeInterception } from "./decide-wallet-bridge";

describe("decideWalletBridgeInterception — happy path", () => {
  it("INTERCEPTS a well-formed `?wallet=<serial>` and returns the clean URL with the param stripped", () => {
    const verdict = decideWalletBridgeInterception({
      url: "https://bunsbao.kitchen-boost.com/?wallet=kb-serial-abcdef1234567890",
    });
    expect(verdict).toEqual({
      kind: "intercept",
      serial: "kb-serial-abcdef1234567890",
      cleanUrl: "https://bunsbao.kitchen-boost.com/",
    });
  });

  it("preserves other query params when stripping `wallet` (no collateral damage)", () => {
    const verdict = decideWalletBridgeInterception({
      url: "https://bunsbao.kitchen-boost.com/menu?wallet=kb-serial-abcdef1234567890&utm_source=apple_wallet",
    });
    expect(verdict.kind).toBe("intercept");
    if (verdict.kind !== "intercept") return;
    expect(verdict.serial).toBe("kb-serial-abcdef1234567890");
    expect(verdict.cleanUrl).toBe(
      "https://bunsbao.kitchen-boost.com/menu?utm_source=apple_wallet",
    );
  });

  it("keeps the path intact when intercepting on a deep route (e.g. /c/<orderId>)", () => {
    const verdict = decideWalletBridgeInterception({
      url: "https://bunsbao.kitchen-boost.com/c/order_abc?wallet=kb-serial-abcdef1234567890",
    });
    expect(verdict.kind).toBe("intercept");
    if (verdict.kind !== "intercept") return;
    expect(verdict.cleanUrl).toBe(
      "https://bunsbao.kitchen-boost.com/c/order_abc",
    );
  });

  it("takes the FIRST `wallet` value when several are present and strips them all", () => {
    const verdict = decideWalletBridgeInterception({
      url: "https://bunsbao.kitchen-boost.com/?wallet=kb-serial-abcdef1234567890&wallet=kb-serial-other999",
    });
    expect(verdict.kind).toBe("intercept");
    if (verdict.kind !== "intercept") return;
    expect(verdict.serial).toBe("kb-serial-abcdef1234567890");
    expect(verdict.cleanUrl).toBe("https://bunsbao.kitchen-boost.com/");
  });
});

describe("decideWalletBridgeInterception — passthrough", () => {
  it("returns `passthrough` when no `wallet` param is present", () => {
    const verdict = decideWalletBridgeInterception({
      url: "https://bunsbao.kitchen-boost.com/menu",
    });
    expect(verdict).toEqual({ kind: "passthrough" });
  });

  it("returns `passthrough` when only unrelated query params are present", () => {
    const verdict = decideWalletBridgeInterception({
      url: "https://bunsbao.kitchen-boost.com/menu?utm_source=apple_wallet&foo=bar",
    });
    expect(verdict).toEqual({ kind: "passthrough" });
  });
});

describe("decideWalletBridgeInterception — malformed serial (graceful)", () => {
  it("returns `strip-only` for an EMPTY `wallet=` value (still clean the URL)", () => {
    const verdict = decideWalletBridgeInterception({
      url: "https://bunsbao.kitchen-boost.com/?wallet=",
    });
    expect(verdict).toEqual({
      kind: "strip-only",
      cleanUrl: "https://bunsbao.kitchen-boost.com/",
    });
  });

  it("returns `strip-only` for a whitespace-only `wallet=` value", () => {
    const verdict = decideWalletBridgeInterception({
      url: "https://bunsbao.kitchen-boost.com/?wallet=%20%20%20",
    });
    expect(verdict.kind).toBe("strip-only");
  });

  it("returns `strip-only` for a too-short serial (below the min length floor)", () => {
    // Anything shorter than 8 chars cannot plausibly be a Wallet serial — we
    // strip it to keep the URL clean but never attempt a bridge with a value
    // a probing attacker could trivially enumerate.
    const verdict = decideWalletBridgeInterception({
      url: "https://bunsbao.kitchen-boost.com/?wallet=abc",
    });
    expect(verdict.kind).toBe("strip-only");
  });

  it("returns `strip-only` for a serial with disallowed characters (URL injection guard)", () => {
    // Wallet serials we mint are `[A-Za-z0-9_-]+`. A `/` or `?` smuggled in
    // through the query value would break URL semantics downstream — strip
    // and refuse to bridge.
    const verdict = decideWalletBridgeInterception({
      url: "https://bunsbao.kitchen-boost.com/?wallet=kb%2Fserial%3Fxxx",
    });
    expect(verdict.kind).toBe("strip-only");
  });

  it("returns `strip-only` for a serial above the max length ceiling (probe defence)", () => {
    // 256+ chars is not a real serial — pad with a hard upper bound so a
    // malicious URL cannot blow up the cookie / downstream Convex argument.
    const veryLong = "a".repeat(300);
    const verdict = decideWalletBridgeInterception({
      url: `https://bunsbao.kitchen-boost.com/?wallet=${veryLong}`,
    });
    expect(verdict.kind).toBe("strip-only");
  });
});
