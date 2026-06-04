/**
 * PWA-S5 (#453) — pure decision that derives the user-visible cart totals
 * (sous-total, frais livraison, total, displayed view of the delivery fee)
 * from the cart subtotal, the current delivery mode, and the cached
 * delivery verdict (CONTEXT client-ordering « Mode toggle » / decisions
 * Q7 « switch sans re-quote, verdict cache 2 modes »).
 *
 * The toggle switches between two precomputed prices — no re-quote, no
 * spinner réseau (US 25). Click & collect = 0 (CONTEXT delivery « Frais
 * livraison = 0 »); delivery = gross fee from the verdict.
 *
 * « Offert par {resto} » (CONTEXT pricing « Affichage prix livraison ») —
 * the absorbed view is rendered iff the pricing engine produced a non-zero
 * resto-absorbed amount; in S5 we wire the SHAPE but accept that V1 cart
 * does NOT yet call the pricing engine (the customer counters #16 are not
 * runtime-wired yet, cf. `lib/pricing/evaluate.ts` runtime note). The
 * decision therefore takes an OPTIONAL `pricingAbsorption` parameter that
 * S6 / a later wiring slice can populate; today it stays undefined and
 * the gross fee is shown plain. The contract is pinned now so S6 only
 * wires the call site.
 *
 * Written BEFORE the implementation (TDD red).
 */
import { describe, expect, it } from "vitest";
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import { decideCartTotals } from "./decide-cart-totals";

const DELIVERABLE: DeliveryQuoteVerdict = {
  deliverable: true,
  fee: 295,
  eta: 25,
  quoteId: "q1",
};

describe("decideCartTotals — click_and_collect mode (frais livraison = 0)", () => {
  it("returns subtotal as total, fee 0, no 'Offert par' line", () => {
    const t = decideCartTotals({
      subtotalCentimes: 1500,
      mode: "click_and_collect",
      verdict: DELIVERABLE,
    });
    expect(t.subtotalCentimes).toBe(1500);
    expect(t.deliveryFeeCentimes).toBe(0);
    expect(t.totalCentimes).toBe(1500);
    expect(t.deliveryFeeView.kind).toBe("free-pickup");
  });

  it("same shape when verdict is null (user landed on /panier without S3)", () => {
    const t = decideCartTotals({
      subtotalCentimes: 800,
      mode: "click_and_collect",
      verdict: null,
    });
    expect(t.deliveryFeeCentimes).toBe(0);
    expect(t.totalCentimes).toBe(800);
    expect(t.deliveryFeeView.kind).toBe("free-pickup");
  });
});

describe("decideCartTotals — delivery mode without pricing absorption (V1 baseline)", () => {
  it("adds the gross delivery fee from the verdict to the subtotal", () => {
    const t = decideCartTotals({
      subtotalCentimes: 1500,
      mode: "delivery",
      verdict: DELIVERABLE,
    });
    expect(t.subtotalCentimes).toBe(1500);
    expect(t.deliveryFeeCentimes).toBe(295);
    expect(t.totalCentimes).toBe(1500 + 295);
    expect(t.deliveryFeeView.kind).toBe("plain-fee");
    if (t.deliveryFeeView.kind === "plain-fee") {
      expect(t.deliveryFeeView.feeCentimes).toBe(295);
    }
  });

  it("delivery mode with NO verdict cached → fee 0, view 'plain-fee' 0 (toggle should not have allowed this UI but stays safe)", () => {
    const t = decideCartTotals({
      subtotalCentimes: 1500,
      mode: "delivery",
      verdict: null,
    });
    expect(t.deliveryFeeCentimes).toBe(0);
    expect(t.totalCentimes).toBe(1500);
  });
});

describe("decideCartTotals — delivery mode WITH pricing engine absorption (forward-compat for S6)", () => {
  it("100% absorbed (livraison_offerte_resto) → 'offered-by-resto' view + total = subtotal", () => {
    const t = decideCartTotals({
      subtotalCentimes: 2500,
      mode: "delivery",
      verdict: DELIVERABLE,
      pricingAbsorption: {
        grossFeeCentimes: 295,
        clientFeeCentimes: 0,
        restoAbsorbedCentimes: 295,
        restoName: "Buns & Bao",
      },
    });
    expect(t.deliveryFeeCentimes).toBe(0);
    expect(t.totalCentimes).toBe(2500);
    expect(t.deliveryFeeView.kind).toBe("offered-by-resto");
    if (t.deliveryFeeView.kind === "offered-by-resto") {
      expect(t.deliveryFeeView.grossFeeCentimes).toBe(295);
      expect(t.deliveryFeeView.clientFeeCentimes).toBe(0);
      expect(t.deliveryFeeView.restoName).toBe("Buns & Bao");
    }
  });

  it("partial absorption (-1 € resto) → 'partial-absorption' view, total uses client fee", () => {
    const t = decideCartTotals({
      subtotalCentimes: 2500,
      mode: "delivery",
      verdict: DELIVERABLE,
      pricingAbsorption: {
        grossFeeCentimes: 295,
        clientFeeCentimes: 195,
        restoAbsorbedCentimes: 100,
        restoName: "Buns & Bao",
      },
    });
    expect(t.deliveryFeeCentimes).toBe(195);
    expect(t.totalCentimes).toBe(2500 + 195);
    expect(t.deliveryFeeView.kind).toBe("partial-absorption");
  });

  it("absorption present but client mode is C&C → still free-pickup (absorption only matters in delivery mode)", () => {
    const t = decideCartTotals({
      subtotalCentimes: 2500,
      mode: "click_and_collect",
      verdict: DELIVERABLE,
      pricingAbsorption: {
        grossFeeCentimes: 295,
        clientFeeCentimes: 0,
        restoAbsorbedCentimes: 295,
        restoName: "Buns & Bao",
      },
    });
    expect(t.deliveryFeeView.kind).toBe("free-pickup");
    expect(t.totalCentimes).toBe(2500);
  });
});
