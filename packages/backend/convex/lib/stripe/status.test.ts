import { describe, expect, it } from "vitest";
import { mapStripeAccountToStatus } from "./status";

/**
 * 2.5-A — PURE Stripe account → tenant status mapping (PRD 30 §1/§2). Written
 * BEFORE the implementation (TDD red). The three target statuses are
 * `pending` / `ready` / `disabled`; the load-bearing invariant (issue #35 / PRD
 * 30 §1) is that a REJECTED / disabled KYC NEVER maps to `ready`.
 */
describe("2.5-A mapStripeAccountToStatus — account.updated → tenant stripeStatus", () => {
  it("maps a fully onboarded account (charges + payouts enabled) to ready", () => {
    expect(
      mapStripeAccountToStatus({
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { disabled_reason: null },
      }),
    ).toBe("ready");
  });

  it("maps a brand-new account (nothing enabled, no disabled reason) to pending", () => {
    expect(
      mapStripeAccountToStatus({
        charges_enabled: false,
        payouts_enabled: false,
      }),
    ).toBe("pending");
  });

  it("maps a partially-onboarded account (charges only, no payouts) to pending", () => {
    expect(
      mapStripeAccountToStatus({
        charges_enabled: true,
        payouts_enabled: false,
      }),
    ).toBe("pending");
  });

  it("maps a disabled/rejected account (disabled_reason set) to disabled", () => {
    expect(
      mapStripeAccountToStatus({
        charges_enabled: false,
        payouts_enabled: false,
        requirements: { disabled_reason: "rejected.fraud" },
      }),
    ).toBe("disabled");
  });

  it("a REJECTED KYC never maps to ready even if charges were briefly enabled", () => {
    // The rejected-KYC guard is checked FIRST: a disabled_reason wins over any
    // momentarily-enabled flags (PRD 30 §1 — un KYC rejected n'amène jamais ready).
    expect(
      mapStripeAccountToStatus({
        charges_enabled: true,
        payouts_enabled: true,
        requirements: { disabled_reason: "requirements.past_due" },
      }),
    ).toBe("disabled");
  });

  it("treats absent flags as not-enabled (defensive → pending)", () => {
    expect(mapStripeAccountToStatus({})).toBe("pending");
  });
});
