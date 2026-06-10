"use client";

/**
 * PWA-S7 (#458) — `<StripePaymentImpl>` — the concrete implementation
 * imported BEHIND `next/dynamic` by `<StripePaymentLazy>`.
 *
 * Responsibilities:
 *  - Read the tenant's `stripeAccountId` + `stripeStatus` via the
 *    customer-scoped `api.lib.tenants.payment.forCheckout` query (Convex
 *    sub — reactive flip when the resto completes onboarding).
 *  - Read `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` from `process.env` (must be
 *    inlined at build time — required by Next 16 Edge contract for any
 *    `NEXT_PUBLIC_*` value).
 *  - Decide whether to mount Stripe Elements (`stripeStatus === "ready"`
 *    + key present + accountId present) OR to render a degraded
 *    « Paiement indisponible » panel (the backend `assertOwnPendingOrder`
 *    would refuse the PaymentIntent anyway — we short-circuit here for UX).
 *  - Mount `<StripeElementsProvider>` + `<StripePaymentSection>`.
 *
 * This is the ONLY component that loads `@stripe/react-stripe-js` /
 * `@stripe/stripe-js` — every parent reaches it through
 * `<StripePaymentLazy>` (a `next/dynamic` boundary with `ssr: false`),
 * so the Stripe SDK ships in a SEPARATE chunk that is fetched ONLY when
 * `/checkout` mounts (acceptance criterion #458 lazy load).
 */
import { useQuery } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useCart } from "@/components/cart/cart-context";
import { useDeliveryMode } from "@/components/delivery-mode/delivery-mode-context";
import { decideCartTotals } from "@/lib/delivery-mode";
import type { SavedCardFicheSnapshot } from "@/lib/stripe-payment";
import { StripeElementsProvider } from "./stripe-elements-provider";
import {
  StripePaymentSection,
  type CheckoutContactValues,
} from "./stripe-payment-section";

export type StripePaymentImplProps = {
  tenantId: Id<"tenants">;
  /** Saved-card snapshot from the preloaded customer fiche (drives the branch). */
  fiche: SavedCardFicheSnapshot | null;
  /** Customer's stamped address (S3, needed for latching `recaptureQuoteAtPayment`). */
  customerAddress: string | undefined;
  customerLat: number | undefined;
  customerLng: number | undefined;
  /** Reads the live `<input>` form values at click-Payer time. */
  getContactValues: () => CheckoutContactValues;
};

export function StripePaymentImpl({
  tenantId,
  fiche,
  customerAddress,
  customerLat,
  customerLng,
  getContactValues,
}: StripePaymentImplProps): React.JSX.Element {
  // Customer-scoped sub on the tenant's Stripe context. Reactive: a
  // resto completing onboarding while the customer is on /checkout will
  // re-render this component without a reload.
  const paymentContext = useQuery(api.lib.tenants.payment.forCheckout, {
    tenantId,
  });

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

  // Compute the displayed amount for the Payment Element preview.
  const { totals } = useCart();
  const { mode, verdict } = useDeliveryMode();
  const totalsRow = decideCartTotals({
    subtotalCentimes: totals.subtotalCentimes,
    mode,
    verdict,
  });

  if (paymentContext === undefined) {
    // Sub still loading — render the same skeleton the lazy wrapper does.
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-6 text-sm text-zinc-600">
        Chargement du paiement…
      </div>
    );
  }
  if (
    publishableKey === undefined ||
    publishableKey.length === 0 ||
    paymentContext.stripeAccountId === null ||
    paymentContext.stripeStatus !== "ready"
  ) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-300 bg-red-50 px-3 py-3 text-sm text-red-900"
      >
        Le resto n&apos;accepte pas encore les paiements en ligne. Reviens plus
        tard ou contacte-le directement.
      </div>
    );
  }

  return (
    <StripeElementsProvider
      publishableKey={publishableKey}
      stripeAccount={paymentContext.stripeAccountId}
      amountCentimes={totalsRow.totalCentimes}
      currency="eur"
    >
      <StripePaymentSection
        tenantId={tenantId}
        fiche={fiche}
        customerAddress={customerAddress}
        customerLat={customerLat}
        customerLng={customerLng}
        getContactValues={getContactValues}
      />
    </StripeElementsProvider>
  );
}
