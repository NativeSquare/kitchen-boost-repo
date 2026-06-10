/**
 * PWA-S7 (#458) — pure helper building the `pricingSnapshot` payload the
 * backend `createPaymentIntent` / `payWithSavedCard` actions consume
 * (validator: `packages/backend/convex/table/orders.ts pricingSnapshot`).
 *
 * Three CENTIMES fields, with invariant `subtotal + deliveryFee = total`:
 *  - `subtotal` — sum of cart line items;
 *  - `deliveryFee` — CLIENT share of the delivery fee (Pricing engine
 *    absorption is a V2 wiring — V1 baseline = gross fee verbatim, per
 *    `decide-cart-totals.ts` head comment); zero in click & collect;
 *  - `total` — subtotal + deliveryFee.
 *
 * The KB application fee (240 cts TTC, ADR `APPLICATION_FEE_AMOUNT_TTC`)
 * is added BACKEND-SIDE by the actions — it is NOT part of this snapshot,
 * the customer is NEVER charged for it (intrinsic to direct charge, the
 * resto is merchant of record).
 *
 * The `deliveryFee` field MUST come from the FRESH latched verdict (the
 * one returned by `recaptureQuoteAtPayment`), not the cached panier
 * verdict — otherwise a stale fee would land in the snapshot and we would
 * either over-charge (if it dropped) or under-charge (if it rose silently,
 * which the `decide-latching-outcome.ts` flow forbids). The parent passes
 * `latchedFeeCentimes` derived from the FRESH verdict.
 */
import type { DeliveryMode } from "@/lib/delivery-mode";

export type DerivePricingSnapshotInput = {
  mode: DeliveryMode;
  subtotalCentimes: number;
  /**
   * The FRESH delivery fee (from the latched verdict). Ignored in click &
   * collect mode (the snapshot's `deliveryFee` is forced to 0).
   */
  latchedFeeCentimes: number;
};

/** Mirror of backend `pricingSnapshot` validator (cents). */
export type PricingSnapshotPayload = {
  subtotal: number;
  deliveryFee: number;
  total: number;
};

export function derivePricingSnapshot(
  input: DerivePricingSnapshotInput,
): PricingSnapshotPayload {
  const deliveryFee =
    input.mode === "click_and_collect" ? 0 : input.latchedFeeCentimes;
  return {
    subtotal: input.subtotalCentimes,
    deliveryFee,
    total: input.subtotalCentimes + deliveryFee,
  };
}
