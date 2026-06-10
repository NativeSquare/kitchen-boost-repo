/**
 * PWA-S7 (#458) — pure decision that turns a re-captured Uber Direct verdict
 * (from the backend `recaptureQuoteAtPayment` action — already merged 2.6-B)
 * into the user-facing latching outcome (US 47, decisions-log Q7 « latching
 * anti-surge avant confirmPayment »).
 *
 * Why latch at all : the panier verdict is from the cart step (possibly
 * minutes ago); Uber Direct fees fluctuate with demand/surge. The PWA
 * re-runs the quote at click-Payer to catch a price drift BEFORE charging.
 * If the fee went UP → blocking confirm modal. If the resto closed between
 * cart and click → abort (we cannot create a delivery course on a closed
 * resto). If unchanged or lower → silent proceed.
 *
 * `DeliveryQuoteVerdict` is re-imported from `@/lib/address-first` (the
 * front-side mirror of the backend `lib/delivery/quote.deliveryQuoteVerdict`
 * shape, kept local on purpose — see `decide-address-first-action.ts`).
 *
 * Click & collect mode SHORT-CIRCUITS to `ok` without calling the action:
 * a C&C order has no delivery fee to surge (CONTEXT delivery « Frais
 * livraison = 0 ») so re-quoting is wasted work.
 */
import type { DeliveryQuoteVerdict } from "@/lib/address-first";
import type { DeliveryMode } from "@/lib/delivery-mode";

export type DecideLatchingOutcomeInput = {
  /** Currently-selected mode (from `useDeliveryMode().mode`). */
  mode: DeliveryMode;
  /**
   * The fee the user agreed to in the panier (from the cached
   * `DeliveryQuoteVerdict` written by `<AddressFirstForm>` at S3 submit;
   * `0` in click & collect mode).
   */
  cachedFeeCentimes: number;
  /**
   * The FRESH verdict from the latching action, `null` when the mode is
   * click & collect (no action call needed — the parent passes `null`).
   */
  freshVerdict: DeliveryQuoteVerdict | null;
};

/** The latching outcome — three mutually exclusive shapes. */
export type LatchingOutcome =
  | { kind: "ok" }
  | {
      kind: "confirm-surge";
      /** Cached fee the user agreed to (centimes). */
      fromCentimes: number;
      /** Fresh fee the user must now confirm (centimes). */
      toCentimes: number;
    }
  | {
      kind: "abort";
      /** Reason returned by the backend verdict. */
      reason: "hors_zone" | "hors_horaire" | "surge";
    };

/**
 * Decide the latching outcome for the click-Payer moment.
 *
 * Branches:
 *  - mode = `click_and_collect` → `ok` (no fee to latch, no action call);
 *  - fresh verdict not deliverable → `abort` with the verdict's reason;
 *  - fresh fee > cached fee → `confirm-surge` (modal blocking);
 *  - fresh fee ≤ cached fee → `ok` (the parent uses the fresh fee in the
 *    pricing snapshot, so a lower fee is silently applied — never an
 *    over-charge).
 */
export function decideLatchingOutcome(
  input: DecideLatchingOutcomeInput,
): LatchingOutcome {
  if (input.mode === "click_and_collect") {
    return { kind: "ok" };
  }
  if (input.freshVerdict === null) {
    // Defensive : the parent should always pass a verdict in delivery mode.
    // A `null` here would mean the parent forgot to call the action — fail
    // closed (abort) rather than silently charging the cached fee, which
    // is the very thing latching exists to prevent.
    return { kind: "abort", reason: "surge" };
  }
  if (!input.freshVerdict.deliverable) {
    return { kind: "abort", reason: input.freshVerdict.reason };
  }
  if (input.freshVerdict.fee > input.cachedFeeCentimes) {
    return {
      kind: "confirm-surge",
      fromCentimes: input.cachedFeeCentimes,
      toCentimes: input.freshVerdict.fee,
    };
  }
  return { kind: "ok" };
}
