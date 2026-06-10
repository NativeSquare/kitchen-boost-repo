/**
 * PWA-S7 (#458) — tests for the pure `decidePaymentBranch` decision.
 *
 * Branches the payment flow on the customer fiche's `savedPaymentMethodId`:
 *  - present → "saved-card" branch (tile « Payer avec ma carte enregistrée »
 *    + link « Utiliser une autre carte » — US 45).
 *  - absent  → "new-card" branch (Stripe Payment Element, US 46).
 *
 * The form may also force the new-card branch on user click of the
 * « Utiliser une autre carte » link (the parent component owns that toggle —
 * the decision here is the DEFAULT branch derived from the fiche).
 */
import { describe, expect, it } from "vitest";
import { decidePaymentBranch } from "./decide-payment-branch";

describe("decidePaymentBranch — branch on savedPaymentMethodId", () => {
  it("returns 'new-card' when the customer fiche is null (anonymous first visit)", () => {
    expect(decidePaymentBranch(null)).toEqual({ kind: "new-card" });
  });

  it("returns 'new-card' when the fiche has no savedPaymentMethodId", () => {
    expect(decidePaymentBranch({ savedPaymentMethodId: undefined })).toEqual({
      kind: "new-card",
    });
  });

  it("returns 'saved-card' when the fiche has a savedPaymentMethodId", () => {
    expect(
      decidePaymentBranch({ savedPaymentMethodId: "pm_test_123" }),
    ).toEqual({ kind: "saved-card" });
  });

  it("ignores a stripeCustomerId without a paymentMethod (Customer reused but card removed)", () => {
    expect(
      decidePaymentBranch({
        stripeCustomerId: "cus_test_123",
        savedPaymentMethodId: undefined,
      }),
    ).toEqual({ kind: "new-card" });
  });
});
