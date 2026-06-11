/**
 * Tests for the pure `deliveryModeReducer` — focus on the new `ADOPT_VERDICT`
 * transition that lets the `<DeliveryAddressSheet>` flip the toggle at runtime
 * (no page reload) after the customer enters a deliverable address.
 *
 * The reducer is pure (no localStorage IO — that lives in the provider's
 * `adoptVerdict` callback), so it runs in node env like every other apps/web
 * unit test.
 */
import { describe, expect, it } from "vitest";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import {
  deliveryModeReducer,
  INITIAL_STATE,
  type DeliveryModeState,
} from "./delivery-mode-context";

const DELIVERABLE: DeliveryQuoteVerdict = {
  deliverable: true,
  fee: 295,
  eta: 25,
  quoteId: "q1",
};

describe("deliveryModeReducer — ADOPT_VERDICT", () => {
  it("from the null-verdict initial state, adopting a deliverable verdict enables Livraison + selects it", () => {
    // This is the exact feedback scenario: fresh tab, deliveryDisabled, the
    // sheet captures a deliverable address and pushes the verdict in.
    expect(INITIAL_STATE.verdict).toBeNull();
    expect(INITIAL_STATE.decision.deliveryDisabled).toBe(true);
    expect(INITIAL_STATE.mode).toBe("click_and_collect");

    const next = deliveryModeReducer(INITIAL_STATE, {
      kind: "ADOPT_VERDICT",
      verdict: DELIVERABLE,
    });

    expect(next.verdict).toEqual(DELIVERABLE);
    expect(next.decision.deliveryDisabled).toBe(false);
    // Toggle flips to delivery automatically — the customer just asked for it.
    expect(next.mode).toBe("delivery");
  });

  it("adopting a hors_zone verdict keeps Livraison disabled + falls back to C&C", () => {
    const next = deliveryModeReducer(INITIAL_STATE, {
      kind: "ADOPT_VERDICT",
      verdict: { deliverable: false, reason: "hors_zone" },
    });
    expect(next.decision.deliveryDisabled).toBe(true);
    expect(next.decision.pickupDisabled).toBe(false);
    expect(next.mode).toBe("click_and_collect");
  });

  it("ADOPT_VERDICT produces the same decision shape as REHYDRATE for the same verdict", () => {
    const adopted = deliveryModeReducer(INITIAL_STATE, {
      kind: "ADOPT_VERDICT",
      verdict: DELIVERABLE,
    });
    const rehydrated = deliveryModeReducer(INITIAL_STATE, {
      kind: "REHYDRATE",
      verdict: DELIVERABLE,
    });
    expect(adopted).toEqual(rehydrated);
  });

  it("SET_MODE still only changes the mode, leaving the verdict + decision intact", () => {
    const withVerdict: DeliveryModeState = deliveryModeReducer(INITIAL_STATE, {
      kind: "ADOPT_VERDICT",
      verdict: DELIVERABLE,
    });
    const switched = deliveryModeReducer(withVerdict, {
      kind: "SET_MODE",
      mode: "click_and_collect",
    });
    expect(switched.mode).toBe("click_and_collect");
    expect(switched.verdict).toEqual(DELIVERABLE);
    expect(switched.decision).toEqual(withVerdict.decision);
  });
});
