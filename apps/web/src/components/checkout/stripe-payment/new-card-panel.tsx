"use client";

/**
 * PWA-S7 (#458) — `<NewCardPanel>` — the new-card branch (US 46): Stripe
 * Payment Element on the resto's CONNECTED account.
 *
 * Renders inside the `<StripeElementsProvider>` (deferred-intent mode), so
 * `<PaymentElement>` auto-shows the available wallet buttons (Apple Pay,
 * Google Pay) + the card form (acceptance criterion #458 « Apple Pay
 * button visible iOS »). The actual confirm flow is owned by the parent
 * `<StripePaymentSection>` — this panel just renders the Element.
 *
 * ── « Sauvegarder ma carte » — DELIBERATELY NOT RENDERED V1 ─────────────
 * The PRD US 46 mentions a « Sauvegarder ma carte » checkbox; the issue
 * description lists it in « What to build ». It is NOT rendered in this
 * slice because the cross-resto save mechanism (which is the whole VALUE
 * of the saved-card UX, ADR-aligned, payment CONTEXT « Stripe Customer
 * cross-tenant ») requires a PLATFORM-level Stripe Elements instance to
 * collect a PaymentMethod attachable to the platform Customer — and the
 * backend `saveCard` action (2.5-D, `packages/backend/convex/lib/stripe/
 * savedCard.ts`) EXPECTS exactly that platform PM.
 *
 * S7 (this slice) charges on the CONNECTED account (direct charge,
 * `Stripe-Account: acct_resto`) — the PaymentMethod created here belongs
 * to the connected account and CANNOT be re-cloned to other restos. So
 * surfacing a checkbox here would either:
 *  (a) silently save same-resto-only — breaking the « mes prochaines
 *      commandes » promise across restos;
 *  (b) save nothing — silently lie to the user.
 *
 * Both options violate the « no shortcut fixes » project rule. The
 * checkbox lands in a follow-up slice that:
 *  - adds `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` usage WITHOUT
 *    `stripeAccount` for a second platform-context Elements instance;
 *  - branches the new-card flow into « one-shot » vs « collect + save »
 *    paths (the save path mounts platform Elements, calls
 *    `stripe.createPaymentMethod({ elements })`, persists via the
 *    already-merged `saveCard` mutation, then proceeds with
 *    `payWithSavedCard`);
 *  - SoT-side, the consumption path is already complete here through
 *    `<SavedCardPanel>` — a customer who acquired a saved card by any
 *    means (e.g. a future « save » slice OR a manual ops seed) sees it
 *    pre-selected as the tile.
 *
 * Tracking: docs/contexts/payment/CONTEXT.md + parent issue #458
 * follow-up note in the PR body.
 */
import { PaymentElement } from "@stripe/react-stripe-js";

export function NewCardPanel(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4">
      <PaymentElement
        options={{
          layout: { type: "tabs", defaultCollapsed: false },
          // Apple Pay / Google Pay are auto-included via
          // `automatic_payment_methods` (backend `createPaymentIntent`),
          // mirrored client-side here by the default `paymentMethodOrder`
          // (the Payment Element promotes the available wallet at the top
          // when the device supports it).
        }}
      />
    </div>
  );
}
