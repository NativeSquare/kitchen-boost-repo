/**
 * PWA-S7 (#458) — `stripe-payment` module API.
 *
 * Pure decisions consumed by the `<CheckoutForm>` (S7) Stripe payment flow
 * (US 45-49, decisions-log Q6/Q7):
 *
 *  - `decidePaymentBranch` — given the preloaded customer fiche, returns
 *    whether the form should render the « saved-card » tile (the customer
 *    has a `savedPaymentMethodId` from a previous KB resto, cross-tenant
 *    via Stripe Customer at platform level) or the « new-card » Stripe
 *    Payment Element (US 45 / 46).
 *
 *  - `decideLatchingOutcome` — given the FRESH verdict from
 *    `recaptureQuoteAtPayment` + the cached panier fee, returns whether
 *    the form should proceed straight to payment (`ok`), surface a
 *    blocking confirm modal because the fee rose (`confirm-surge`), or
 *    abort the payment because the resto closed / went out of zone
 *    between cart and Payer (`abort`). Q7 « latching anti-surge avant
 *    confirmPayment ».
 *
 *  - `decideRetryAction` — given the count of failed Stripe attempts so
 *    far, returns whether the form should surface an inline retry banner
 *    (≤ 2 attempts) or escalate to a fatal toast + Sentry log
 *    (3rd attempt — US 48 acceptance criterion).
 *
 *  - `derivePricingSnapshot` — pure helper building the `pricingSnapshot`
 *    payload the backend `createPaymentIntent` / `payWithSavedCard`
 *    actions consume; uses the FRESH latched fee (not the cached panier
 *    fee) to never under/over-charge.
 *
 * Splitting the decisions from the React IO keeps every branch
 * vitest-pinnable in node env, mirroring the `decideAddressFirstAction` /
 * `decideManifest` / `decidePaymentGate` pattern of the previous PWA slices.
 */
export {
  type PaymentBranch,
  type SavedCardFicheSnapshot,
  decidePaymentBranch,
} from "./decide-payment-branch";
export {
  type DecideLatchingOutcomeInput,
  type LatchingOutcome,
  decideLatchingOutcome,
} from "./decide-latching-outcome";
export {
  INLINE_RETRY_THRESHOLD,
  type RetryAction,
  decideRetryAction,
} from "./decide-retry-action";
export {
  type DerivePricingSnapshotInput,
  type PricingSnapshotPayload,
  derivePricingSnapshot,
} from "./derive-pricing-snapshot";
export { type SentryContext, captureException } from "./sentry-shim";
