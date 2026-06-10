/**
 * PWA-S7 (#458) — `stripe-payment` UI module API.
 *
 * The PARENT `<CheckoutForm>` imports `<StripePaymentLazy>` ONLY — the
 * `next/dynamic` boundary ensures the Stripe SDK ships in a SEPARATE
 * chunk fetched only when `/checkout` mounts (acceptance criterion #458
 * lazy load).
 */
export { type CheckoutContactValues } from "./stripe-payment-section";
export { StripePaymentLazy } from "./stripe-payment-lazy";
