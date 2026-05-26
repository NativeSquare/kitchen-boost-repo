import { describe, expect, it } from "vitest";
import { APPLICATION_FEE_AMOUNT_TTC, APPLICATION_FEE_AMOUNT_HT } from "./fees";

/**
 * 2.5-B — the IMMUTABLE KB commission constants (PRD 30 §2 / Q30-Q1 + Q30-Q7,
 * payment CONTEXT). Written BEFORE the implementation (TDD red).
 *
 * V1 = a single fixed `application_fee_amount` for EVERY tenant — there is no
 * per-tenant config path (Q30-Q1 acté). The Stripe field is in centimes TTC
 * (240 = 2,40 € = 2 € HT + 20 % TVA); the DB stores the HT amount (200 cts) for
 * CGI-compliant reporting (Q30-Q7). These facts are documented, not invented.
 */
describe("2.5-B application fee constants — immutable V1", () => {
  it("the Stripe application_fee_amount is 240 cts TTC", () => {
    expect(APPLICATION_FEE_AMOUNT_TTC).toBe(240);
  });

  it("the DB-stored commission is 200 cts HT (2,40 TTC = 2,00 HT + 20% TVA)", () => {
    expect(APPLICATION_FEE_AMOUNT_HT).toBe(200);
    // TTC = HT × 1.20 (20 % TVA) → 200 × 1.2 = 240.
    expect(Math.round(APPLICATION_FEE_AMOUNT_HT * 1.2)).toBe(
      APPLICATION_FEE_AMOUNT_TTC,
    );
  });
});
