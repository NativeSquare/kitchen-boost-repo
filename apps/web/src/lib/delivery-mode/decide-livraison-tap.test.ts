/**
 * Tests for the pure `decideLivraisonTap` predicate (the root-cause fix for the
 * « dead disabled Livraison button » feedback).
 *
 * Pinned distinction (the crux of the feature):
 *  - null verdict (address unknown) → OPEN the address sheet (invite).
 *  - refusal verdict (resto closed / out of zone) → noop (genuinely unavailable).
 *  - deliverable verdict → normal mode switch.
 *
 * Written BEFORE the implementation (TDD red). Pure node env, no DOM.
 */
import { describe, expect, it } from "vitest";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import { decideLivraisonTap } from "./decide-livraison-tap";

describe("decideLivraisonTap", () => {
  it("null verdict (deep-link, address unknown) → open-address-sheet", () => {
    expect(decideLivraisonTap(null)).toEqual({ kind: "open-address-sheet" });
  });

  it("deliverable verdict → switch-mode (button is enabled, nominal click)", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: true,
      fee: 295,
      eta: 25,
      quoteId: "q1",
    };
    expect(decideLivraisonTap(verdict)).toEqual({ kind: "switch-mode" });
  });

  it("hors_horaire refusal → noop (resto closed, re-entering address won't help)", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "hors_horaire",
    };
    expect(decideLivraisonTap(verdict)).toEqual({ kind: "noop" });
  });

  it("hors_zone refusal → noop (address already quoted, out of zone)", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "hors_zone",
    };
    expect(decideLivraisonTap(verdict)).toEqual({ kind: "noop" });
  });

  it("surge refusal → noop (the address-first Retry path owns the re-quote)", () => {
    const verdict: DeliveryQuoteVerdict = {
      deliverable: false,
      reason: "surge",
    };
    expect(decideLivraisonTap(verdict)).toEqual({ kind: "noop" });
  });
});
