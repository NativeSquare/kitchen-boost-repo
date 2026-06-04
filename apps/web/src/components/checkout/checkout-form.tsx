"use client";

/**
 * PWA-S6 (#454) — `<CheckoutForm>` : the body of `/checkout` (US 44, PRD
 * §10 PWA Client + decisions-log Q3/Q8).
 *
 * Owns the React IO around the pure decisions of `lib/checkout-gate`:
 *  - `usePreloadedQuery(preloadedCustomer)` → reactive Convex sub on
 *    `customers.pushEnrollment` so a Wallet install / Web Push subscribe
 *    happening in another tab / from the address-first soft prompt 5 min
 *    earlier unlocks the "Payer X €" button without ANY reload (acceptance
 *    criterion #454 « install Wallet pendant client sur page → bouton se
 *    débloque sans reload »). The RSC parent (`app/checkout/page.tsx`)
 *    seeds this sub via `preloadQuery` so the gate is evaluated on the SSR
 *    pass too (no FOUC, no "active → disabled" flash on mount).
 *  - `useCart()` → reads the localStorage-backed cart (S5). Empty cart
 *    on /checkout has no business case → redirect to /panier where the
 *    « Ton panier est vide » empty state lives (decided by
 *    `decideCheckoutRedirect`).
 *  - Form `<input>` controls pre-filled via `decideCheckoutPrefill`.
 *  - "Payer X €" CTA is the pure decision `decidePaymentGate` reading the
 *    live `pushEnrollment` snapshot. S6 stub : click logs to console and
 *    surfaces a "Coming next: modal push enrollment (S6a)" placeholder —
 *    the actual modal lives in #455 / #456 / #457 and the Stripe payment
 *    in #458 / S7.
 *
 * Consent at click-Payer (ADR 0007) : the CGV/loyalty wording lives ABOVE
 * the button, ≥ 12 px (acceptance criterion #454 « Wording CGV visible et
 * lisible (≥ 12px) »). The button text IS the consent action — no
 * checkbox, no separate « J'accepte » step.
 */
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePreloadedQuery, type Preloaded } from "convex/react";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useCart } from "@/components/cart/cart-context";
import { useDeliveryMode } from "@/components/delivery-mode/delivery-mode-context";
import { PushEnrollmentModal } from "@/components/checkout/push-enrollment-modal";
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

  const onPayClick = (): void => {
    if (gate.kind !== "active") {
      // Gate closed → open the enrollment modal (S6a). The CTA `disabled`
      // attribute keeps a keyboard user from reaching here on a `disabled`
      // gate, but we double-check defensively so a future ref-driven click
      // still routes correctly.
      setModalRequested(true);
      return;
    }
    // S6 stub — the actual Stripe payment lands in S7 (#458). Logging here
    // makes it easy to confirm in the E2E plan that the gate enabled the
    // click (vs the button being disabled — onClick wouldn't fire then).
    console.log("[PWA-S6] Payer clicked", {
      tenantId,
      subtotalCentimes: totals.subtotalCentimes,
      totalCentimes: totalsRow.totalCentimes,
      enrolledChannels: gate.enrolledChannels,
    });
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

      <PayButton
        gate={gate}
        totalCentimes={totalsRow.totalCentimes}
        onPayClick={onPayClick}
      />

      <PushEnrollmentModal
        open={modalOpen}
        tenantId={tenantId}
        restoName={restoName}
      />
    </form>
  );
}

/**
 * The actual "Payer X €" CTA. Extracted so the gate narrowing happens once
 * per render, in one place, and so a future test can mount the button in
 * isolation if needed (no jsdom in apps/web V1 → not done here, but the
 * boundary is clean).
 *
 * S6a (#455) — the button is ALWAYS clickable now: a gate-disabled click opens
 * the `<PushEnrollmentModal>` (per the parent's `onPayClick`), a gate-active
 * click triggers the Stripe payment (S7). The visual styling still
 * differentiates the two states so the user sees the gate, but `disabled` is
 * deliberately dropped to keep the modal opening on click.
 */
function PayButton({
  gate,
  totalCentimes,
  onPayClick,
}: {
  gate: ReturnType<typeof decidePaymentGate>;
  totalCentimes: number;
  onPayClick: () => void;
}): React.JSX.Element {
  const isActive = gate.kind === "active";
  return (
    <button
      type="button"
      onClick={onPayClick}
      aria-disabled={!isActive}
      data-gate={isActive ? "active" : "disabled"}
      className="rounded-lg bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800"
    >
      Payer {formatEur(totalCentimes)}
    </button>
  );
}
