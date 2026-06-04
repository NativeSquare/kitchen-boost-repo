/**
 * PWA-S6 (#454) — pure decision returning the default values to inject
 * into the `/checkout` form (firstName / email / phone), given the
 * customer's preloaded fiche.
 *
 * Acceptance criterion (#454) : « Form pré-rempli si firstName/email/phone
 * capturés à un checkout précédent ». The fiche may be `null` (never
 * provisioned, e.g. private mode or first visit) or partially filled (S3
 * only stamped `address` + `lat` + `lng`; firstName/email/phone are
 * stamped at the FIRST `recordConsentAtCheckout` — S7 scope, see
 * `lib/customer/consent.ts`).
 *
 * `CustomerFicheSnapshot` mirrors the subset of `Doc<"customers">` the form
 * actually reads — kept local on purpose, so the front never imports the
 * Convex `Doc` shape (and the test stays decoupled from the backend module
 * graph).
 */

/**
 * Minimal shape of `customers` row the prefill needs. All fields are
 * optional (the fiche may not have them yet — Sophie has not paid for
 * anything from this resto on this device).
 */
export type CustomerFicheSnapshot = {
  firstName?: string;
  email?: string;
  phone?: string;
  // address / lat / lng / pushEnrollment are intentionally omitted — the
  // form does not pre-fill them (address lives on `/`, pushEnrollment is
  // for the gate not the form).
  address?: string;
};

/** Default values surfaced to the form's `defaultValue` props. */
export type CheckoutPrefillDefaults = {
  firstName: string;
  email: string;
  phone: string;
};

/**
 * Decide the prefill defaults for the checkout form. A `null` fiche (never
 * provisioned) collapses to all-empty defaults; a present fiche surfaces
 * whatever PII fields it has (each independently), defaulting to `""` when
 * absent so the `<input>` controls receive a non-undefined `defaultValue`.
 */
export function decideCheckoutPrefill(
  fiche: CustomerFicheSnapshot | null,
): CheckoutPrefillDefaults {
  if (fiche === null) {
    return { firstName: "", email: "", phone: "" };
  }
  return {
    firstName: fiche.firstName ?? "",
    email: fiche.email ?? "",
    phone: fiche.phone ?? "",
  };
}
