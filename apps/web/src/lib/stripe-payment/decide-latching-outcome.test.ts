/**
 * PWA-S7 (#458) — tests for the pure `decideLatchingOutcome` decision
 * (US 47, decisions-log Q7 « latching anti-surge avant confirmPayment »).
 *
 * At click-Payer the front re-runs `recaptureQuoteAtPayment` (already merged
 * 2.6-B) to catch a surge/stale fee. This pure decision turns the FRESH
 * verdict + the CACHED fee (from the panier verdict, US 23) into one of:
 *  - `ok`            → proceed straight to payment;
 *  - `confirm-surge` → modal `<LatchingConfirmModal>` blocking, user can OK
 *                      (proceed with the higher fee) or cancel (abort);
 *  - `abort`         → terminal — the resto closed / quote unavailable / out
 *                      of zone between cart and Payer; we cannot charge.
 *
 * Only DELIVERY mode is latched: a click & collect order has no fee to surge
 * (CONTEXT delivery « Frais livraison = 0 »), so the decision short-circuits
 * to `ok` without calling the action at all.
 */
import { describe, expect, it } from "vitest";
import { decideLatchingOutcome } from "./decide-latching-outcome";

describe("decideLatchingOutcome — click & collect short-circuit", () => {
  it("returns 'ok' on click & collect regardless of any verdict (no fee to latch)", () => {
    expect(
      decideLatchingOutcome({
        mode: "click_and_collect",
        cachedFeeCentimes: 0,
        freshVerdict: null,
      }),
    ).toEqual({ kind: "ok" });
  });
});

describe("decideLatchingOutcome — delivery mode, fresh verdict deliverable", () => {
  it("returns 'ok' when the fresh fee equals the cached fee", () => {
    expect(
      decideLatchingOutcome({
        mode: "delivery",
        cachedFeeCentimes: 350,
        freshVerdict: {
          deliverable: true,
          fee: 350,
          eta: 1700,
          quoteId: "qt_2",
        },
      }),
    ).toEqual({ kind: "ok" });
  });

  it("returns 'ok' when the fresh fee is LOWER than the cached fee (no surcharge → silent)", () => {
    // Decisions-log Q7 explicit : « si fee monte → modal », not « si fee
    // change ». A lower fee is a happy event — we silently apply it (the
    // pricing snapshot is built from the FRESH verdict so the customer is
    // not over-charged).
    expect(
      decideLatchingOutcome({
        mode: "delivery",
        cachedFeeCentimes: 500,
        freshVerdict: {
          deliverable: true,
          fee: 300,
          eta: 1700,
          quoteId: "qt_3",
        },
      }),
    ).toEqual({ kind: "ok" });
  });

  it("returns 'confirm-surge' carrying both fees when the fresh fee is HIGHER", () => {
    expect(
      decideLatchingOutcome({
        mode: "delivery",
        cachedFeeCentimes: 350,
        freshVerdict: {
          deliverable: true,
          fee: 590,
          eta: 1700,
          quoteId: "qt_surge",
        },
      }),
    ).toEqual({
      kind: "confirm-surge",
      fromCentimes: 350,
      toCentimes: 590,
    });
  });
});

describe("decideLatchingOutcome — delivery mode, fresh verdict NOT deliverable", () => {
  it("returns 'abort' on hors_horaire (resto closed between cart and Payer)", () => {
    expect(
      decideLatchingOutcome({
        mode: "delivery",
        cachedFeeCentimes: 350,
        freshVerdict: { deliverable: false, reason: "hors_horaire" },
      }),
    ).toEqual({ kind: "abort", reason: "hors_horaire" });
  });

  it("returns 'abort' on surge with no fee (Uber out of capacity)", () => {
    expect(
      decideLatchingOutcome({
        mode: "delivery",
        cachedFeeCentimes: 350,
        freshVerdict: { deliverable: false, reason: "surge" },
      }),
    ).toEqual({ kind: "abort", reason: "surge" });
  });

  it("returns 'abort' on hors_zone (address normalised differently / changed)", () => {
    expect(
      decideLatchingOutcome({
        mode: "delivery",
        cachedFeeCentimes: 350,
        freshVerdict: { deliverable: false, reason: "hors_zone" },
      }),
    ).toEqual({ kind: "abort", reason: "hors_zone" });
  });
});
