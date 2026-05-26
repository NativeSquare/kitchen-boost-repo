import { describe, expect, it } from "vitest";
import {
  type MarketingChannel,
  CROSS_TENANT_CASCADE,
  TENANT_CASCADE,
  pickMarketingChannel,
} from "./marketingCascade";

/**
 * 2.7-D — the PURE marketing cascade, written BEFORE the module (TDD red).
 *
 * `pickMarketingChannel(scope, availability)` picks the SINGLE effective channel
 * a marketing campaign goes out on for one customer (PRD 80 §2 / notifications
 * CONTEXT "Cascade marketing"): not multi-channel — exactly one, the first the
 * customer is reachable on, with fallback down the preference order.
 *
 * Two cascades (PRD 80 §2 / Notes "2 cascades marketing distinctes"):
 *  - tenant       : Web Push > Wallet push > Email (PWA tenant first)
 *  - cross_tenant : Wallet push > Email (PWA tenant Web Push EXCLUDED by design —
 *    a web-push subscription is bound to one tenant origin, never cross-tenant).
 *
 * A channel the customer is `inactive`/not reachable on is skipped → falls through
 * to the next. Reachable on none → `null` (no send for this customer).
 */

const reachable = {
  webPush: true,
  walletPush: true,
  email: true,
};

describe("2.7-D pickMarketingChannel — tenant cascade (Web Push > Wallet > Email)", () => {
  it("prefers Web Push when the tenant customer is reachable on it", () => {
    expect(pickMarketingChannel("tenant", reachable)).toBe("web_push");
  });

  it("falls back to Wallet push when Web Push is unavailable", () => {
    expect(
      pickMarketingChannel("tenant", { ...reachable, webPush: false }),
    ).toBe("wallet_push");
  });

  it("falls back to Email when neither push channel is available", () => {
    expect(
      pickMarketingChannel("tenant", {
        webPush: false,
        walletPush: false,
        email: true,
      }),
    ).toBe("email");
  });

  it("returns null when the tenant customer is reachable on no channel", () => {
    expect(
      pickMarketingChannel("tenant", {
        webPush: false,
        walletPush: false,
        email: false,
      }),
    ).toBeNull();
  });
});

describe("2.7-D pickMarketingChannel — cross-tenant cascade (Wallet > Email, Web Push excluded)", () => {
  it("prefers Wallet push for a cross-tenant campaign", () => {
    expect(pickMarketingChannel("cross_tenant", reachable)).toBe("wallet_push");
  });

  it("NEVER uses Web Push cross-tenant even if the customer is web-push reachable", () => {
    expect(
      pickMarketingChannel("cross_tenant", {
        webPush: true,
        walletPush: false,
        email: true,
      }),
    ).toBe("email");
  });

  it("falls back to Email when Wallet is unavailable", () => {
    expect(
      pickMarketingChannel("cross_tenant", { ...reachable, walletPush: false }),
    ).toBe("email");
  });

  it("returns null when reachable on neither Wallet nor Email", () => {
    expect(
      pickMarketingChannel("cross_tenant", {
        webPush: true, // excluded by design — does not save the cross-tenant send
        walletPush: false,
        email: false,
      }),
    ).toBeNull();
  });
});

describe("2.7-D cascade orders are the documented preference orders", () => {
  it("tenant = web_push, wallet_push, email", () => {
    expect(TENANT_CASCADE).toEqual([
      "web_push",
      "wallet_push",
      "email",
    ] satisfies MarketingChannel[]);
  });

  it("cross_tenant = wallet_push, email (no web_push)", () => {
    expect(CROSS_TENANT_CASCADE).toEqual([
      "wallet_push",
      "email",
    ] satisfies MarketingChannel[]);
    expect(CROSS_TENANT_CASCADE).not.toContain("web_push");
  });
});
