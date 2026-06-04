/**
 * PWA-S6 (#454) — `checkout-gate` module API.
 *
 * Pure decisions consumed by the `<CheckoutForm>` (S6) and a future push
 * enrollment modal (S6a #455 / S6b #456 / S6c #457):
 *
 *  - `decidePaymentGate` — given the customer's `pushEnrollment.{wallet,
 *    webPush, a2hs}Status` snapshot, returns whether the "Payer X €" CTA is
 *    `active` (≥ 1 channel enrolled, Q8 + CONTEXT customer-data) or
 *    `disabled` (no channel enrolled). Re-runs in realtime via the Convex
 *    sub on `getCurrentCustomer` so the button auto-unlocks the moment a
 *    Wallet pass / Web Push subscription / A2HS install flips a status.
 *
 *  - `decideCheckoutRedirect` — given the cart line count, decides whether
 *    `/checkout` stays on the page or sends Sophie back to `/panier`
 *    (empty cart → /panier where the « Ton panier est vide » empty state
 *    already lives in `<CartView>` S5).
 *
 *  - `decideCheckoutPrefill` — given the preloaded customer fiche, returns
 *    the firstName / email / phone defaults for the form `<input>` controls
 *    (acceptance criterion #454 « form pré-rempli si captured at a previous
 *    checkout »).
 *
 * Splitting the decisions from the React IO keeps every branch
 * vitest-pinnable in node env, mirroring the `decideAddressFirstAction` /
 * `decideManifest` / `decideTenantResolution` pattern of the previous PWA
 * slices.
 */
export {
  type CheckoutPrefillDefaults,
  type CustomerFicheSnapshot,
  decideCheckoutPrefill,
} from "./decide-prefill";
export {
  type CheckoutRedirectAction,
  type CheckoutRedirectInput,
  decideCheckoutRedirect,
} from "./decide-checkout-redirect";
export {
  type EnrolledChannel,
  type PaymentGateDisabledReason,
  type PaymentGateState,
  type PushChannelStatus,
  type PushEnrollmentSnapshot,
  decidePaymentGate,
} from "./decide-payment-gate";
