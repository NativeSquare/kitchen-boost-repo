/**
 * PWA-S7 (#458) — tests for the pure `derivePricingSnapshot` helper.
 *
 * Builds the `pricingSnapshot` payload the backend `createPaymentIntent` /
 * `payWithSavedCard` actions consume (see `packages/backend/convex/table/
 * orders.ts` `pricingSnapshot` validator). The fields are in CENTIMES, with
 * the invariant `subtotal + deliveryFee = total` (the IMMUTABLE KB
 * commission of 240 cts TTC is added BACKEND-SIDE by the actions; it is NOT
 * part of this snapshot).
 *
 * The snapshot is built from:
 *  - the cart subtotal (already computed by `cart-store`);
 *  - the FRESH delivery fee from the latched verdict (anti-surge — the
 *    panier verdict is NEVER used here, otherwise a stale fee would charge).
 */
import { describe, expect, it } from "vitest";
import { derivePricingSnapshot } from "./derive-pricing-snapshot";

describe("derivePricingSnapshot — delivery mode", () => {
  it("uses the FRESH fee from the latched verdict (anti-surge)", () => {
    expect(
      derivePricingSnapshot({
        mode: "delivery",
        subtotalCentimes: 2500,
        latchedFeeCentimes: 590,
      }),
    ).toEqual({
      subtotal: 2500,
      deliveryFee: 590,
      total: 3090,
    });
  });

  it("derives the total as subtotal + deliveryFee verbatim (no rounding, no fee here)", () => {
    expect(
      derivePricingSnapshot({
        mode: "delivery",
        subtotalCentimes: 1990,
        latchedFeeCentimes: 350,
      }),
    ).toEqual({
      subtotal: 1990,
      deliveryFee: 350,
      total: 2340,
    });
  });
});

describe("derivePricingSnapshot — click & collect", () => {
  it("zeros the delivery fee regardless of any latched value (no fee in C&C)", () => {
    expect(
      derivePricingSnapshot({
        mode: "click_and_collect",
        subtotalCentimes: 1500,
        latchedFeeCentimes: 999, // ignored
      }),
    ).toEqual({
      subtotal: 1500,
      deliveryFee: 0,
      total: 1500,
    });
  });
});
