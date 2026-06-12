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
 *  - phone     : a real, dialable number per `isValidPhoneNumber`
 *    (libphonenumber-js). The `<PhoneInput>` control feeds this an E.164
 *    string (e.g. `+33612345678`), so the number's country is unambiguous.
 *    This replaces the old "≥ 6 digits" heuristic that let junk like
 *    `124304859385935` through — that number passed the heuristic, the
 *    payment went through, then Uber Direct's Create Delivery rejected it
 *    post-payment (`400 dropoff_phone_number: "not valid."`) and the order
 *    auto-aborted + auto-refunded. Gating on `isValidPhoneNumber` means a
 *    customer can only pay with a number Uber will accept.
 *
 * `libphonenumber-js` is pure (no DOM / Node) so importing it keeps this
 * module unit-testable in the vitest node env, like the rest of
 * `lib/checkout-gate`.
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
  // The `<PhoneInput>` feeds an E.164 string (or "" when cleared). Empty /
  // whitespace short-circuits to `false` before hitting libphonenumber-js,
  // which otherwise just returns false anyway — the early return keeps the
  // intent obvious.
  const phoneRaw = values.phone.trim();
  const phone = phoneRaw.length > 0 && isValidPhoneNumber(phoneRaw);
  return {
    valid: firstName && email && phone,
    firstName,
    email,
    phone,
  };
}
