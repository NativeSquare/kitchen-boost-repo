/**
 * PWA-S6 (#454) — `decideCheckoutPrefill` — pure decision returning the
 * default values to inject into the `/checkout` form (firstName / email /
 * phone), given the customer's preloaded fiche.
 *
 * Acceptance criterion (#454) : « Form pré-rempli si firstName/email/phone
 * capturés à un checkout précédent ». The fiche may be `null` (never
 * provisioned, e.g. private mode or first visit) or partially filled
 * (S3 only stamped `address` + `lat` + `lng`; firstName/email/phone are
 * stamped at the FIRST `recordConsentAtCheckout` — S7 scope, see
 * `lib/customer/consent.ts`).
 *
 * Splitting the prefill rule from the React form lets vitest pin every
 * branch in node env, mirroring the decision-module pattern used by the
 * previous PWA slices.
 */
import { describe, expect, it } from "vitest";
import {
  type CustomerFicheSnapshot,
  decideCheckoutPrefill,
} from "./decide-prefill";

describe("decideCheckoutPrefill", () => {
  it("returns all-empty defaults when the fiche is null (never provisioned)", () => {
    const defaults = decideCheckoutPrefill(null);
    expect(defaults).toEqual({ firstName: "", email: "", phone: "" });
  });

  it("returns all-empty defaults when the fiche has none of the 3 PII fields", () => {
    const fiche: CustomerFicheSnapshot = { address: "1 rue de Paris, Paris" };
    expect(decideCheckoutPrefill(fiche)).toEqual({
      firstName: "",
      email: "",
      phone: "",
    });
  });

  it("returns the 3 PII fields when the fiche has them all", () => {
    const fiche: CustomerFicheSnapshot = {
      firstName: "Sophie",
      email: "sophie@example.com",
      phone: "+33612345678",
    };
    expect(decideCheckoutPrefill(fiche)).toEqual({
      firstName: "Sophie",
      email: "sophie@example.com",
      phone: "+33612345678",
    });
  });

  it("returns only the fields that are present (partial fiche)", () => {
    // Plausible mid-state: the customer started a checkout that crashed, so
    // only firstName + email made it to the fiche.
    const fiche: CustomerFicheSnapshot = {
      firstName: "Sophie",
      email: "sophie@example.com",
    };
    expect(decideCheckoutPrefill(fiche)).toEqual({
      firstName: "Sophie",
      email: "sophie@example.com",
      phone: "",
    });
  });

  it("never mutates the input fiche (pure function)", () => {
    const fiche: CustomerFicheSnapshot = {
      firstName: "Sophie",
      email: "sophie@example.com",
    };
    const frozen = Object.freeze({ ...fiche });
    expect(() => decideCheckoutPrefill(frozen)).not.toThrow();
  });
});
