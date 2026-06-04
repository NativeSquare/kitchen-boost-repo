/**
 * PWA-S5 (#453) — pure decision that maps the cached delivery quote
 * `verdict` (the one S3 obtained at address-first) onto the initial state
 * of the `<DeliveryModeToggle>` (CONTEXT client-ordering « Mode toggle »
 * / decisions-log Q7).
 *
 * Branch spec (issue #453 + PRD US 24/25/26) :
 *  - `deliverable: true` → mode = "delivery", livraison enabled, C&C enabled
 *  - `hors_zone` → mode = "click_and_collect", livraison DISABLED (grisée),
 *    C&C enabled (the only option left, US 5)
 *  - `hors_horaire` → mode = "click_and_collect" (default placeholder), the
 *    TWO modes disabled (resto fermé, no pre-ordering V1 — US 6)
 *  - `surge` → mode = "click_and_collect", livraison disabled (surge bloque
 *    delivery), C&C enabled (Khan can still serve pickups)
 *  - `null` (verdict missing — user landed on /panier without going through
 *    S3) → mode = "click_and_collect", livraison DISABLED, C&C enabled
 *    (safe default; the address-first flow is mandatory but we never crash
 *    if the user deep-links into /panier without it)
 *
 * Written BEFORE the implementation (TDD red). Pure node env, no DOM.
 */
import { describe, expect, it } from "vitest";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import { decideInitialMode } from "./decide-initial-mode";

describe("decideInitialMode", () => {
  it("deliverable verdict → mode 'delivery', both modes enabled", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: true,
      fee: 295,
      eta: 25,
      quoteId: "q1",
    };
    const res = decideInitialMode(verdict);
    expect(res.initialMode).toBe("delivery");
    expect(res.deliveryDisabled).toBe(false);
    expect(res.pickupDisabled).toBe(false);
  });

  it("hors_zone verdict → mode 'click_and_collect', livraison grisée (US 26)", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "hors_zone",
    };
    const res = decideInitialMode(verdict);
    expect(res.initialMode).toBe("click_and_collect");
    expect(res.deliveryDisabled).toBe(true);
    expect(res.pickupDisabled).toBe(false);
  });

  it("hors_horaire verdict → 2 modes disabled (resto fermé, no pre-order V1)", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "hors_horaire",
    };
    const res = decideInitialMode(verdict);
    expect(res.deliveryDisabled).toBe(true);
    expect(res.pickupDisabled).toBe(true);
  });

  it("surge verdict → mode 'click_and_collect', delivery disabled, pickup OK", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "surge",
    };
    const res = decideInitialMode(verdict);
    expect(res.initialMode).toBe("click_and_collect");
    expect(res.deliveryDisabled).toBe(true);
    expect(res.pickupDisabled).toBe(false);
  });

  it("null verdict (deep-link into /panier) → safe default C&C, livraison off", () => {
    const res = decideInitialMode(null);
    expect(res.initialMode).toBe("click_and_collect");
    expect(res.deliveryDisabled).toBe(true);
    expect(res.pickupDisabled).toBe(false);
  });
});
