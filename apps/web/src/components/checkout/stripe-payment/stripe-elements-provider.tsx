"use client";

/**
 * PWA-S7 (#458) — `<StripeElementsProvider>` — wraps the Payment Element
 * with `loadStripe(NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, { stripeAccount })`
 * and the deferred-intent `<Elements options={{ mode: "payment", ... }}>`
 * shape (US 46 + decisions-log Q6).
 *
 * Direct charge contract (payment CONTEXT): the resto is merchant of
 * record, the front MUST init Stripe.js with the resto's connected
 * account id so the Payment Element renders the resto's Apple Pay /
 * Google Pay configuration (and a future Stripe Connect-aware webhook
 * routes correctly).
 *
 * Deferred-intent mode (Stripe Elements docs « Accept a payment, deferred
 * intent ») — we mount Elements with `mode: "payment"` + `amount` +
 * `currency`; the actual PaymentIntent is created server-side at the
 * « Payer » click (mutation `api.lib.stripe.paymentIntent.createPaymentIntent`
 * — 2.5-B). The `clientSecret` is then passed to
 * `stripe.confirmPayment({ elements, clientSecret, confirmParams })` —
 * Stripe handles 3DS / redirect / Apple Pay sheet transparently
 * (acceptance criterion #458 « 3DS handle par SDK sans code custom »).
 *
 * `loadStripe` is called HERE (a child of the lazy-imported wrapper),
 * NOT at module top-level — the import side of `next/dynamic` already
 * keeps the Stripe SDK out of /menu / /panier bundles (acceptance
 * criterion #458 « Bundle Stripe lazy-loaded sur /checkout »). Memoised
 * on `stripeAccount` so a resto switch (which would never happen V1, a
 * tenant is host-scoped) doesn't re-fetch the same SDK.
 */
import { useMemo, type ReactNode } from "react";
import { Elements } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

/** Module-level cache so a re-render of the parent doesn't refetch the SDK. */
const stripeByAccount = new Map<string, Promise<Stripe | null>>();

function getOrLoadStripe(
  publishableKey: string,
  stripeAccount: string,
): Promise<Stripe | null> {
  const key = `${publishableKey}::${stripeAccount}`;
  const existing = stripeByAccount.get(key);
  if (existing !== undefined) return existing;
  const promise = loadStripe(publishableKey, { stripeAccount });
  stripeByAccount.set(key, promise);
  return promise;
}

export type StripeElementsProviderProps = {
  /** Publishable key (`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — pk_test_… / pk_live_…). */
  publishableKey: string;
  /** Resto's connected account id (`acct_…`) — direct charge contract. */
  stripeAccount: string;
  /** Total amount in centimes to display in the Payment Element preview. */
  amountCentimes: number;
  /** ISO currency code (V1 = "eur"). */
  currency: "eur";
  /** Optional account country for Apple/Google Pay localization (defaults to `"FR"`). */
  country?: "FR";
  children: ReactNode;
};

export function StripeElementsProvider({
  publishableKey,
  stripeAccount,
  amountCentimes,
  currency,
  country = "FR",
  children,
}: StripeElementsProviderProps): React.JSX.Element {
  // Promise is module-cached so a parent re-render does not re-load the
  // SDK; the `useMemo` is for the React reference stability that Elements
  // requires (a fresh promise each render would re-mount the iframe).
  const stripePromise = useMemo(
    () => getOrLoadStripe(publishableKey, stripeAccount),
    [publishableKey, stripeAccount],
  );
  return (
    <Elements
      stripe={stripePromise}
      options={{
        mode: "payment",
        amount: amountCentimes,
        currency,
        // The deferred-intent Payment Element auto-shows Apple Pay /
        // Google Pay (US 46) when the browser supports them — no manual
        // <PaymentRequestButtonElement> needed. Default automatic
        // payment-method creation: `confirmPayment({ elements,
        // clientSecret })` creates the PM + confirms in ONE Stripe call.
        appearance: { theme: "stripe" },
        // Localised wording (FR — V1 PWA is fr-only, ADR « PWA mobile
        // first FR » / out-of-scope multi-langue V3).
        locale: "fr",
        loader: "auto",
      }}
      // Re-mount on amount change so the deferred-intent preview reflects
      // a fresh latched fee (e.g. user re-toggles to C&C and back).
      key={`${stripeAccount}::${amountCentimes}::${currency}::${country}`}
    >
      {children}
    </Elements>
  );
}
