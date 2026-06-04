/**
 * PWA-S5 (#453) — pure decision that derives the user-visible cart totals
 * (CONTEXT client-ordering « Mode toggle » / CONTEXT pricing « Affichage
 * prix livraison » / decisions-log Q7).
 *
 * Inputs are kept narrow (subtotal already computed by `cart-store`, mode
 * already chosen by the toggle, verdict already cached, optional pricing
 * absorption from a future S6 wiring) so the function is trivially
 * unit-tested in node env and side-effect free.
 *
 * Why the FORWARD-COMPAT `pricingAbsorption` parameter is here NOW even
 * though S5 does not yet call the pricing engine at cart time : the
 * runtime customer counters #16 needed by `lib/pricing/evaluate` are not
 * yet wired (see the runtime note in `evaluate.ts`), so V1 baseline shows
 * the gross fee plain. Pinning the « offered-by-resto » / « partial » VIEW
 * shapes here lets S6 (checkout) wire the eval call without changing any
 * cart-totals contract — only the optional parameter starts being passed.
 */
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import type { DeliveryMode } from "./decide-initial-mode";

/**
 * Pricing engine absorption that S6 will produce by calling
 * `api.lib.pricing.evaluate` at cart time. Mirrors the engine's output
 * (`fraisLivraisonClientCents`, `fraisLivraisonRestoCents`, gross =
 * client + resto). `restoName` is the tenant's display name for the
 * « Offert par {resto} » wording (CONTEXT pricing « jamais de mention
 * KitchenBoost » — always the resto's name).
 */
export type PricingAbsorption = {
  grossFeeCentimes: number;
  clientFeeCentimes: number;
  restoAbsorbedCentimes: number;
  restoName: string;
};

/** How the delivery-fee row should render (3 mutually exclusive shapes). */
export type DeliveryFeeView =
  | { kind: "free-pickup" }
  | { kind: "plain-fee"; feeCentimes: number }
  | {
      kind: "offered-by-resto";
      grossFeeCentimes: number;
      clientFeeCentimes: 0;
      restoName: string;
    }
  | {
      kind: "partial-absorption";
      grossFeeCentimes: number;
      clientFeeCentimes: number;
      restoName: string;
    };

/** The cart totals row + fee view the `<CartTotals>` component consumes. */
export type CartTotals = {
  subtotalCentimes: number;
  deliveryFeeCentimes: number;
  totalCentimes: number;
  deliveryFeeView: DeliveryFeeView;
};

export type DecideCartTotalsInput = {
  subtotalCentimes: number;
  mode: DeliveryMode;
  verdict: DeliveryQuoteVerdict | null;
  /** Optional, supplied by S6 once pricing engine is runtime-wired. */
  pricingAbsorption?: PricingAbsorption;
};

/** Decide the cart totals + fee view. */
export function decideCartTotals(input: DecideCartTotalsInput): CartTotals {
  // Click & collect = 0 fee, no pricing engine effect (CONTEXT delivery
  // « Frais livraison = 0 »). The absorption parameter is intentionally
  // ignored here so a tenant rule that absorbs delivery does not show a
  // misleading « Offert par {resto} » on a pickup order.
  if (input.mode === "click_and_collect") {
    return {
      subtotalCentimes: input.subtotalCentimes,
      deliveryFeeCentimes: 0,
      totalCentimes: input.subtotalCentimes,
      deliveryFeeView: { kind: "free-pickup" },
    };
  }

  // Delivery mode — fee resolution order:
  // 1) pricing absorption (S6 wiring) wins iff present;
  // 2) else the gross fee from the verdict;
  // 3) else 0 (defensive — should not happen if `<DeliveryModeProvider>`
  //    enforced the toggle's `deliveryDisabled` flag, but stays safe).
  if (input.pricingAbsorption !== undefined) {
    const { pricingAbsorption: pa } = input;
    if (pa.restoAbsorbedCentimes === pa.grossFeeCentimes) {
      return {
        subtotalCentimes: input.subtotalCentimes,
        deliveryFeeCentimes: 0,
        totalCentimes: input.subtotalCentimes,
        deliveryFeeView: {
          kind: "offered-by-resto",
          grossFeeCentimes: pa.grossFeeCentimes,
          clientFeeCentimes: 0,
          restoName: pa.restoName,
        },
      };
    }
    if (pa.restoAbsorbedCentimes > 0) {
      return {
        subtotalCentimes: input.subtotalCentimes,
        deliveryFeeCentimes: pa.clientFeeCentimes,
        totalCentimes: input.subtotalCentimes + pa.clientFeeCentimes,
        deliveryFeeView: {
          kind: "partial-absorption",
          grossFeeCentimes: pa.grossFeeCentimes,
          clientFeeCentimes: pa.clientFeeCentimes,
          restoName: pa.restoName,
        },
      };
    }
    // No absorption — fall through to the plain-fee path with the engine
    // gross (which equals the verdict fee unless one of them drifted; the
    // latching `recaptureQuoteAtPayment` at payment is the safety net).
    return {
      subtotalCentimes: input.subtotalCentimes,
      deliveryFeeCentimes: pa.grossFeeCentimes,
      totalCentimes: input.subtotalCentimes + pa.grossFeeCentimes,
      deliveryFeeView: { kind: "plain-fee", feeCentimes: pa.grossFeeCentimes },
    };
  }

  const fee =
    input.verdict !== null && input.verdict.deliverable ? input.verdict.fee : 0;
  return {
    subtotalCentimes: input.subtotalCentimes,
    deliveryFeeCentimes: fee,
    totalCentimes: input.subtotalCentimes + fee,
    deliveryFeeView: { kind: "plain-fee", feeCentimes: fee },
  };
}
