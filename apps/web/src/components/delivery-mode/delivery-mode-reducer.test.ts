/**
 * FEATURE B (#reusable delivery-address sheet) — the delivery-mode reducer,
 * extracted from `<DeliveryModeProvider>` so the new `ADOPT_VERDICT` transition
 * is vitest-pinned (pure, node env). Written BEFORE the implementation (TDD red).
 *
 * `ADOPT_VERDICT` is dispatched when the reusable address sheet replays the
 * address→quote chain and gets a FRESH `deliverable` verdict: the new verdict
 * must REPLACE the cached one, the toggle enablement must be recomputed from it,
 * and Livraison must become the selected mode — all without a page reload.
 */
import { describe, expect, it } from "vitest";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import { INITIAL_STATE, reducer, type State } from "./delivery-mode-reducer";

const DELIVERABLE: DeliveryQuoteVerdict = {
  deliverable: true,
  fee: 295,
  eta: 20,
  quoteId: "q-fresh",
};
const HORS_ZONE: DeliveryQuoteVerdict = {
  deliverable: false,
  reason: "hors_zone",
};

describe("delivery-mode reducer", () => {
  it("INITIAL_STATE is the no-verdict safe default (C&C, livraison disabled)", () => {
    expect(INITIAL_STATE.verdict).toBeNull();
    expect(INITIAL_STATE.mode).toBe("click_and_collect");
    expect(INITIAL_STATE.decision.deliveryDisabled).toBe(true);
    expect(INITIAL_STATE.decision.pickupDisabled).toBe(false);
  });

  it("REHYDRATE applies the verdict-implied initial mode + enablement", () => {
    const next = reducer(INITIAL_STATE, {
      kind: "REHYDRATE",
      verdict: DELIVERABLE,
    });
    expect(next.verdict).toEqual(DELIVERABLE);
    expect(next.mode).toBe("delivery");
    expect(next.decision.deliveryDisabled).toBe(false);
  });

  it("SET_MODE only changes the live mode, leaving verdict + decision intact", () => {
    const start: State = reducer(INITIAL_STATE, {
      kind: "REHYDRATE",
      verdict: DELIVERABLE,
    });
    const next = reducer(start, {
      kind: "SET_MODE",
      mode: "click_and_collect",
    });
    expect(next.mode).toBe("click_and_collect");
    expect(next.verdict).toEqual(DELIVERABLE);
    expect(next.decision).toEqual(start.decision);
  });

  it("ADOPT_VERDICT replaces a hors_zone verdict with a fresh deliverable one and selects Livraison", () => {
    // Start from a hors_zone state (Livraison disabled, C&C selected).
    const horsZoneState = reducer(INITIAL_STATE, {
      kind: "REHYDRATE",
      verdict: HORS_ZONE,
    });
    expect(horsZoneState.decision.deliveryDisabled).toBe(true);

    // The sheet replays the chain → deliverable. Adopt it.
    const next = reducer(horsZoneState, {
      kind: "ADOPT_VERDICT",
      verdict: DELIVERABLE,
    });
    expect(next.verdict).toEqual(DELIVERABLE);
    expect(next.decision.deliveryDisabled).toBe(false);
    expect(next.decision.pickupDisabled).toBe(false);
    // Livraison is selected (the user just proved a deliverable address).
    expect(next.mode).toBe("delivery");
  });

  it("ADOPT_VERDICT from a NULL verdict (fresh-tab deep-link) enables + selects Livraison", () => {
    const next = reducer(INITIAL_STATE, {
      kind: "ADOPT_VERDICT",
      verdict: DELIVERABLE,
    });
    expect(next.verdict).toEqual(DELIVERABLE);
    expect(next.mode).toBe("delivery");
    expect(next.decision.deliveryDisabled).toBe(false);
  });
});
