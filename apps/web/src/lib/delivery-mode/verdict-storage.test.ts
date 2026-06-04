/**
 * PWA-S5 (#453) — pure shape-check encode/decode helpers for the cached
 * `DeliveryQuoteVerdict` persisted to localStorage by `<AddressFirstForm>`
 * (S3) and consumed by `<DeliveryModeProvider>` (S5).
 *
 * Why store the verdict in localStorage and not in a React Context props
 * chain : `/panier` is a stand-alone route (client-only, decisions-log
 * Q2), it is NOT a child of `<AddressFirstForm>`. The verdict produced at
 * S3 must survive the navigation. localStorage is the same persistence
 * medium as the cart (CONTEXT client-ordering « Cart » V1) and the same
 * trade-off applies: cross-tab stale is accepted, the verdict is a
 * pre-checkout buffer (re-captured by the latching mutation at payment,
 * cf. `recaptureQuoteAtPayment` in `lib/delivery/quote.ts`).
 *
 * Pure tests pin the defensive parsing — a corrupted / shape-mismatched
 * payload must NEVER crash the UI (the cart page renders C&C-default
 * instead, US-aligned with the « no S3 » deep-link case).
 *
 * Written BEFORE the implementation (TDD red).
 */
import { describe, expect, it } from "vitest";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import { decodeVerdict, encodeVerdict } from "./verdict-storage";

describe("encodeVerdict / decodeVerdict — round-trip", () => {
  it("encodes + decodes a deliverable verdict back to the same shape", () => {
    const v: DeliveryQuoteVerdict = {
      deliverable: true,
      fee: 295,
      eta: 25,
      quoteId: "q_abc",
    };
    const round = decodeVerdict(encodeVerdict(v));
    expect(round).toEqual(v);
  });

  it("encodes + decodes each non-deliverable reason", () => {
    for (const reason of ["hors_zone", "hors_horaire", "surge"] as const) {
      const v: DeliveryQuoteVerdict = { deliverable: false, reason };
      const round = decodeVerdict(encodeVerdict(v));
      expect(round).toEqual(v);
    }
  });
});

describe("decodeVerdict — defensive parsing", () => {
  it("returns null when the input is not valid JSON", () => {
    expect(decodeVerdict("not-json")).toBeNull();
  });

  it("returns null when the JSON is shape-mismatched (missing fields)", () => {
    expect(decodeVerdict(JSON.stringify({ deliverable: true }))).toBeNull();
  });

  it("returns null when the reason is not one of the 3 known values", () => {
    const bad = JSON.stringify({ deliverable: false, reason: "exploded" });
    expect(decodeVerdict(bad)).toBeNull();
  });

  it("returns null when the input is null/empty", () => {
    expect(decodeVerdict(null)).toBeNull();
    expect(decodeVerdict("")).toBeNull();
  });

  it("returns null when fee / eta / quoteId are wrong types", () => {
    const bad = JSON.stringify({
      deliverable: true,
      fee: "295",
      eta: 25,
      quoteId: "q1",
    });
    expect(decodeVerdict(bad)).toBeNull();
  });
});
