/**
 * PWA checkout — `decideContactFormValid` — pure validator for the three
 * contact fields (firstName / email / phone) of the `/checkout` form.
 *
 * Root-cause guard (user feedback) : the « Payer » CTA is a
 * `<button type="button">` driven by `onClick`, so the HTML `required`
 * attribute on the uncontrolled `<input>` is NEVER enforced — a customer
 * could proceed to pay with an empty form. This pure decision lets the
 * React form gate BOTH pay surfaces (push-modal CTA + Stripe pay CTA) on a
 * single, vitest-pinnable validity rule.
 *
 * Splitting the rule from the React IO mirrors the decision-module pattern
 * of the rest of `lib/checkout-gate` (node env, no DOM).
 */
import { describe, expect, it } from "vitest";
import { decideContactFormValid } from "./decide-contact-form-valid";

describe("decideContactFormValid", () => {
  const valid = {
    firstName: "Sophie",
    email: "sophie@example.com",
    phone: "+33612345678",
  };

  it("is valid when the three fields are filled and well-formed", () => {
    const result = decideContactFormValid(valid);
    expect(result.valid).toBe(true);
    expect(result.firstName).toBe(true);
    expect(result.email).toBe(true);
    expect(result.phone).toBe(true);
  });

  it("is invalid when firstName is empty", () => {
    const result = decideContactFormValid({ ...valid, firstName: "" });
    expect(result.valid).toBe(false);
    expect(result.firstName).toBe(false);
  });

  it("is invalid when firstName is whitespace-only", () => {
    const result = decideContactFormValid({ ...valid, firstName: "   " });
    expect(result.valid).toBe(false);
    expect(result.firstName).toBe(false);
  });

  it("is invalid when email is empty", () => {
    const result = decideContactFormValid({ ...valid, email: "" });
    expect(result.valid).toBe(false);
    expect(result.email).toBe(false);
  });

  it("is invalid when email is malformed (no @)", () => {
    const result = decideContactFormValid({
      ...valid,
      email: "sophie.example.com",
    });
    expect(result.valid).toBe(false);
    expect(result.email).toBe(false);
  });

  it("is invalid when email is malformed (no domain dot)", () => {
    const result = decideContactFormValid({
      ...valid,
      email: "sophie@example",
    });
    expect(result.valid).toBe(false);
    expect(result.email).toBe(false);
  });

  it("is invalid when email has whitespace inside", () => {
    const result = decideContactFormValid({
      ...valid,
      email: "soph ie@example.com",
    });
    expect(result.valid).toBe(false);
    expect(result.email).toBe(false);
  });

  it("accepts an email with surrounding whitespace (trimmed)", () => {
    const result = decideContactFormValid({
      ...valid,
      email: "  sophie@example.com  ",
    });
    expect(result.valid).toBe(true);
    expect(result.email).toBe(true);
  });

  it("is invalid when phone is empty", () => {
    const result = decideContactFormValid({ ...valid, phone: "" });
    expect(result.valid).toBe(false);
    expect(result.phone).toBe(false);
  });

  it("is invalid when phone is whitespace-only", () => {
    const result = decideContactFormValid({ ...valid, phone: "   " });
    expect(result.valid).toBe(false);
    expect(result.phone).toBe(false);
  });

  it("is invalid when phone is a too-short number", () => {
    const result = decideContactFormValid({ ...valid, phone: "06" });
    expect(result.valid).toBe(false);
    expect(result.phone).toBe(false);
  });

  it("is invalid when phone is junk digits (the Uber rejection case)", () => {
    // Real incident : a customer submitted `124304859385935`, the payment
    // went through, then Uber Direct rejected it post-payment with
    // `400 dropoff_phone_number: "not valid."`. This must now fail BEFORE
    // paying.
    const result = decideContactFormValid({
      ...valid,
      phone: "124304859385935",
    });
    expect(result.valid).toBe(false);
    expect(result.phone).toBe(false);
  });

  it("accepts a valid FR E.164 number", () => {
    const result = decideContactFormValid({
      ...valid,
      phone: "+33612345678",
    });
    expect(result.valid).toBe(true);
    expect(result.phone).toBe(true);
  });

  it("accepts a valid international (non-FR) E.164 number", () => {
    const result = decideContactFormValid({
      ...valid,
      // UK mobile in E.164.
      phone: "+447911123456",
    });
    expect(result.valid).toBe(true);
    expect(result.phone).toBe(true);
  });

  it("flags every field independently when all are blank", () => {
    const result = decideContactFormValid({
      firstName: "",
      email: "",
      phone: "",
    });
    expect(result).toEqual({
      valid: false,
      firstName: false,
      email: false,
      phone: false,
    });
  });

  it("never mutates the input (pure function)", () => {
    const frozen = Object.freeze({ ...valid });
    expect(() => decideContactFormValid(frozen)).not.toThrow();
  });
});
