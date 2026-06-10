"use client";

/**
 * PWA-S6 / S7 (#454 / #458) — `<CheckoutForm>` : the body of `/checkout`
 * (US 44-49, PRD §10 PWA Client + decisions-log Q3/Q6/Q7/Q8).
 *
 * Owns the React IO around the pure decisions of `lib/checkout-gate`
 * (S6) and `lib/stripe-payment` (S7):
 *  - `usePreloadedQuery(preloadedCustomer)` → reactive Convex sub on
 *    `customers.pushEnrollment` so a Wallet install / Web Push subscribe
 *    happening in another tab unlocks the "Payer X €" CTA without ANY
 *    reload (S6 #454).
 *  - `useCart()` → reads the localStorage-backed cart (S5). Empty cart
 *    on /checkout redirects back to /panier.
 *  - Form `<input>` controls pre-filled via `decideCheckoutPrefill`. The
 *    refs let the lazy-loaded `<StripePaymentLazy>` snapshot the live
 *    values at click-Payer (so a user editing post-render is reflected).
 *  - Two payment surfaces depending on the gate state:
 *    - gate DISABLED → render the « Payer » CTA that opens
 *      `<PushEnrollmentModal>` (S6a-c) — no Stripe code is loaded.
 *    - gate ACTIVE   → render `<StripePaymentLazy>` (next/dynamic) which
 *      mounts Stripe Elements + the saved-card / new-card branch (S7).
 *
 * Consent at click-Payer (ADR 0007) : the CGV/loyalty wording lives ABOVE
 * the button, ≥ 12 px (acceptance criterion #454 « Wording CGV visible et
 * lisible (≥ 12px) »). The button text IS the consent action — no
 * checkbox, no separate « J'accepte » step. The actual `recordConsentAtCheckout`
 * mutation is fired by `<StripePaymentSection>` (S7) at click-Payer, so
 * each successful payment re-stamps the then-active CGV hash (re-consent
 * par achat, ADR 0005).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useCart } from "@/components/cart/cart-context";
import { useDeliveryMode } from "@/components/delivery-mode/delivery-mode-context";
import { PushEnrollmentModal } from "@/components/checkout/push-enrollment-modal";
import {
  StripePaymentLazy,
  type CheckoutContactValues,
} from "@/components/checkout/stripe-payment";
import { decideCartTotals } from "@/lib/delivery-mode";
import {
  decideCheckoutPrefill,
  decideCheckoutRedirect,
  decidePaymentGate,
} from "@/lib/checkout-gate";

/** FR currency formatter (same shape as `<CartView>` and the toggle). */
function formatEur(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(centimes / 100);
}

export type CheckoutFormProps = {
  /** Resolved tenantId from `__Host-kb_tenant` (passed by the RSC parent). */
  tenantId: Id<"tenants">;
  /** Display name of the resto for the CGV wording — passed by the RSC parent. */
  restoName: string;
  /**
   * The `Preloaded<>` envelope produced by `preloadQuery(getCurrentCustomer)`
   * in the RSC parent. `usePreloadedQuery` hydrates it into a reactive sub —
   * subsequent realtime updates flow through automatically (Convex docs).
   */
  preloadedCustomer: Preloaded<
    typeof api.lib.customer.identity.getCurrentCustomer
  >;
};

export function CheckoutForm({
  tenantId,
  restoName,
  preloadedCustomer,
}: CheckoutFormProps): React.JSX.Element | null {
  const router = useRouter();

  // Hydrate the preloaded payload into a live Convex sub. Re-runs on every
  // `customers.pushEnrollment` flip — this is what unlocks the "Payer" CTA
  // in realtime when the user installs the Wallet pass / subscribes Web Push
  // from another tab / from an earlier modal.
  const customer = usePreloadedQuery(preloadedCustomer);

  const { state: cartState, totals } = useCart();
  const { verdict, mode } = useDeliveryMode();

  // Decide redirect on every render (the cart can be emptied from another
  // tab in private mode → we react). `useEffect` so the navigation happens
  // post-commit (Next 16 will scream if router.push runs during render).
  const redirect = decideCheckoutRedirect({
    cartLineCount: cartState.lines.length,
  });
  useEffect(() => {
    if (redirect.kind === "redirect") {
      router.replace(redirect.path);
    }
    // Both `kind` and `path` are part of the decision; including the whole
    // object would cause `useEffect` to re-fire on every render (new ref).
    // `kind` alone is sufficient — `path` is statically `"/panier"` for
    // every `redirect` branch (decideCheckoutRedirect contract).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redirect.kind, router]);

  const gate = decidePaymentGate(customer?.pushEnrollment);

  // PWA-S6a (#455) — the push enrollment modal opens when the user clicks
  // "Payer" with the gate disabled. The modal is *controlled* — we close it
  // automatically the moment the gate flips to `active` (Convex sub on
  // `customers.pushEnrollment` re-runs `decidePaymentGate`). Decisions-log
  // Q8 « modal close auto via Convex sub ». These hooks live BEFORE the
  // redirect early-return so the hook order stays stable across renders
  // (react-hooks/rules-of-hooks).
  const [modalRequested, setModalRequested] = useState(false);
  useEffect(() => {
    if (gate.kind === "active" && modalRequested) {
      setModalRequested(false);
    }
  }, [gate.kind, modalRequested]);

  // Refs to the three contact `<input>` so `<StripePaymentLazy>` can
  // snapshot the live values at click-Payer time (without forcing the
  // parent to lift state out of the uncontrolled inputs).
  const firstNameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const getContactValues = useCallback(
    (): CheckoutContactValues => ({
      firstName: firstNameRef.current?.value ?? "",
      email: emailRef.current?.value ?? "",
      phone: phoneRef.current?.value ?? "",
    }),
    [],
  );

  if (redirect.kind === "redirect") {
    // Render nothing while the navigation is en route — avoids a flash of
    // the empty checkout form before the redirect lands.
    return null;
  }

  const prefill = decideCheckoutPrefill(customer);
  const totalsRow = decideCartTotals({
    subtotalCentimes: totals.subtotalCentimes,
    mode,
    verdict,
  });

  const modalOpen = modalRequested && gate.kind !== "active";

  const onGateDisabledClick = (): void => {
    // Gate closed → open the enrollment modal (S6a). When the modal lands
    // and the user enrolls, the Convex sub re-runs `decidePaymentGate`
    // → `gate.kind` flips to "active" → the form switches to the
    // `<StripePaymentLazy>` branch automatically (US 27-38).
    setModalRequested(true);
  };

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        // Defensive : the form has no <button type="submit"> — the Payer CTA
        // is a plain <button type="button"> that runs the click handler.
        // Swallow any stray Enter-in-input submits.
        e.preventDefault();
      }}
    >
      <fieldset className="flex flex-col gap-4 rounded-lg border border-zinc-200 bg-white p-4">
        <legend className="px-1 text-sm font-medium text-zinc-700">
          Tes coordonnées
        </legend>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-600">Prénom</span>
          <input
            ref={firstNameRef}
            type="text"
            name="firstName"
            autoComplete="given-name"
            defaultValue={prefill.firstName}
            required
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-base text-black placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-600">Email</span>
          <input
            ref={emailRef}
            type="email"
            name="email"
            autoComplete="email"
            defaultValue={prefill.email}
            required
            inputMode="email"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-base text-black placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-zinc-600">Téléphone</span>
          <input
            ref={phoneRef}
            type="tel"
            name="phone"
            autoComplete="tel"
            defaultValue={prefill.phone}
            required
            inputMode="tel"
            placeholder="+33 6 12 34 56 78"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-base text-black placeholder:text-zinc-400 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
        </label>
      </fieldset>

      {/* CGV wording — consent par clic Payer (ADR 0007). Font-size 12px
          enforced by `text-xs` (Tailwind = 0.75rem = 12px at default 16px
          root). NOT a link, NOT clickable. */}
      <p className="text-xs leading-relaxed text-zinc-600">
        En cliquant sur Payer, tu acceptes les CGV de{" "}
        <strong className="text-zinc-700">{restoName}</strong> et le service de
        fidélité <strong className="text-zinc-700">KitchenBoost</strong>.
      </p>

      {gate.kind === "active" ? (
        // S7 (#458) — gate open → mount the lazy Stripe payment surface.
        // The acceptance criterion « Bundle Stripe lazy-loaded sur /checkout »
        // is satisfied because `<StripePaymentLazy>` is the ONLY entry
        // chain that imports `@stripe/*`, hidden behind `next/dynamic`
        // (`ssr: false`) — a customer who never reaches gate=active
        // (e.g. exits at /panier) never downloads the Stripe SDK.
        <StripePaymentLazy
          tenantId={tenantId}
          fiche={customer}
          customerAddress={customer?.address}
          customerLat={customer?.lat}
          customerLng={customer?.lng}
          getContactValues={getContactValues}
        />
      ) : (
        // S6 — gate disabled : surface the « Payer » CTA that opens the
        // enrollment modal. NO Stripe code is loaded in this branch (the
        // import lives inside `<StripePaymentLazy>`).
        <PayButton
          totalCentimes={totalsRow.totalCentimes}
          onPayClick={onGateDisabledClick}
        />
      )}

      <PushEnrollmentModal
        open={modalOpen}
        tenantId={tenantId}
        restoName={restoName}
      />
    </form>
  );
}

/**
 * The « Payer X € » CTA rendered in the GATE-DISABLED branch (S6a). A
 * click opens the `<PushEnrollmentModal>`; once the user enrolls a push
 * channel, the parent's Convex sub re-runs `decidePaymentGate`, the
 * branch switches to `<StripePaymentLazy>` (S7), and the CTA inside
 * `<StripePaymentSection>` takes over.
 *
 * Extracted so the JSX stays readable; `data-gate="disabled"` is kept as
 * a stable selector for the S6a/b/c E2E plan.
 */
function PayButton({
  totalCentimes,
  onPayClick,
}: {
  totalCentimes: number;
  onPayClick: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onPayClick}
      data-gate="disabled"
      className="rounded-lg bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800"
    >
      Payer {formatEur(totalCentimes)}
    </button>
  );
}
