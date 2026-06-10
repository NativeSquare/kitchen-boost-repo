"use client";

/**
 * PWA-S7 (#458) — `<StripePaymentLazy>` — `next/dynamic` wrapper that
 * KEEPS the Stripe SDK out of any bundle except `/checkout` (acceptance
 * criterion #458 « Bundle Stripe lazy-loaded sur /checkout (DevTools
 * Network : stripe.js n'apparaît pas sur /menu) »).
 *
 * Why a separate file: `next/dynamic` with `ssr: false` MUST be called
 * inside a Client Component (`apps/web/src/app/checkout/page.tsx` is RSC);
 * routing it through `<CheckoutForm>` (which is already a Client
 * Component) keeps the Stripe imports OUT of the RSC graph + OUT of the
 * `/checkout` initial HTML payload (Stripe.js only loads on actual
 * mount, after the user reaches the form). The deep chain
 * `<CheckoutForm>` → `<StripePaymentLazy>` → `<StripePaymentImpl>` →
 * `@stripe/react-stripe-js` is the boundary the bundler splits on.
 */
import dynamic from "next/dynamic";

export const StripePaymentLazy = dynamic(
  () =>
    import("./stripe-payment-impl").then((m) => ({
      default: m.StripePaymentImpl,
    })),
  {
    // Stripe Elements is browser-only (touches `window`/`document` at
    // load). `ssr: false` keeps it out of the SSR bundle entirely.
    ssr: false,
    loading: () => (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        Chargement du paiement…
      </div>
    ),
  },
);
