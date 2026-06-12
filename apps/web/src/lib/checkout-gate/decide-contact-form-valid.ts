/**
 * PWA checkout — pure validator for the three contact fields
 * (firstName / email / phone) of the `/checkout` form.
 *
 * Root-cause guard (user feedback) : the « Payer » CTA is a
 * `<button type="button">` driven by `onClick`, NOT a form submit, so the
 * HTML `required` attribute on the (previously uncontrolled) `<input>` was
 * NEVER enforced — a customer could proceed to pay with an empty form. The
 * form now threads its live values through this single decision so BOTH pay
 * surfaces (the gate-disabled push-modal CTA AND the gate-active Stripe pay
 * CTA) can disable themselves on the SAME validity rule.
 *
 * V1 rules (kept simple + sensible, decision-module pattern of the rest of
 * `lib/checkout-gate`) :
 *  - firstName : non-empty after trim.
 *  - email     : basic `x@y.z` pattern after trim (one `@`, a dot in the
 *    domain, no whitespace). Not RFC-5322 — just enough to stop an obviously
 *    broken / empty address reaching Stripe.
 *  - phone     : non-empty after trim with at least 6 digits (ignores
 *    spaces / `+` / dashes so `+33 6 12 34 56 78` passes).
 */

import { isValidPhoneNumber } from "libphonenumber-js";

/** Live contact-field values snapshotted from the form `<input>` controls. */
export type ContactFormValues = {
  firstName: string;
  email: string;
  phone: string;
};

/**
 * Validity verdict. `valid` is the AND of the three per-field flags; the
 * per-field flags let the form surface a hint next to the offending input
 * without re-deriving the rule.
 */
export type ContactFormValidity = {
  valid: boolean;
  firstName: boolean;
  email: boolean;
  phone: boolean;
};

/**
 * Basic email shape: one run of non-space/non-@ chars, an `@`, a domain
 * with at least one dot, and a TLD of 2+ chars. Deliberately permissive —
 * the goal is to reject empty / obviously-malformed input, not to police
 * deliverability.
 */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Decide the validity of the checkout contact form. Pure: trims locally,
 * never mutates the input.
 */
export function decideContactFormValid(
  values: ContactFormValues,
): ContactFormValidity {
  const firstName = values.firstName.trim().length > 0;
  const email = EMAIL_RE.test(values.email.trim());
  // A REAL phone validation (libphonenumber-js) — not a digit count. The field
  // emits E.164 (`<PhoneInput>`), and Uber Direct's Create Delivery rejects an
  // invalid `dropoff_phone_number` POST-payment (→ auto-abort + refund). Gating
  // « Payer » on `isValidPhoneNumber` stops a bad number ever reaching payment.
  // `isValidPhoneNumber` returns false for empty / malformed input, so no extra
  // emptiness guard is needed.
  const phone = isValidPhoneNumber(values.phone.trim());
  return {
    valid: firstName && email && phone,
    firstName,
    email,
    phone,
  };
}
