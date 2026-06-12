"use client";

/**
 * PWA-S7 (#458) — `<StripePaymentSection>` — the orchestrator of the
 * S7 payment flow. Rendered as a CHILD of `<StripeElementsProvider>` so
 * the `useStripe` / `useElements` hooks resolve.
 *
 * Owns the click-Payer flow at the top of the file header
 * (decisions-log Q6 / Q7, US 44-49) :
 *
 *  1. `recordCheckoutContact(firstName/email/phone)` — capture PII for the
 *     NEXT visit's prefill (US 44 prefill loop, decisions-log Q3).
 *  2. `recordConsentAtCheckout()` — stamp CGV hash (ADR 0007).
 *  3. `recaptureQuoteAtPayment({tenantId, address})` — latching anti-surge.
 *     `decideLatchingOutcome` →
 *       - `abort`         : surface the reason as a toast → return.
 *       - `confirm-surge` : show `<LatchingConfirmModal>` → wait for
 *                           user's OK/cancel; on OK → continue with the
 *                           FRESH fee; on cancel → return to idle.
 *       - `ok`            : continue with the FRESH fee.
 *  4. `createOrderFromCart({mode, address, lat, lng, restaurantNote, items})`
 *     → get `orderId` (US 23, freezes the cart).
 *  5. Branch on `decidePaymentBranch(customer)` :
 *       - `saved-card` : `payWithSavedCard({tenantId, orderId,
 *                        pricingSnapshot})` → on success, redirect to
 *                        `/c/[orderId]` (US 50).
 *       - `new-card`   : `createPaymentIntent({tenantId, orderId,
 *                        pricingSnapshot})` → `stripe.confirmPayment({
 *                        elements, clientSecret, confirmParams: {
 *                        return_url: '<host>/c/<orderId>' } })` (Stripe
 *                        handles 3DS / redirect / Apple Pay sheet, US 49).
 *  6. On failure: increment `attempts`; `decideRetryAction(attempts)` →
 *     - `inline-retry`  : surface a discreet inline banner with the
 *                         Stripe message + a Retry button.
 *     - `fatal-toast`   : surface a terminal toast + call the Sentry shim
 *                         (US 48, acceptance criterion « 3ᵉ échec »).
 *
 * NO direct `getAuthUserId` (ADR 0011) — identity flows through the Convex
 * Auth session cookie already used by `usePreloadedQuery`.
 *
 * Conditional Stripe.js calls: `useStripe()` / `useElements()` may return
 * `null` before Stripe.js finishes loading (acceptance criterion #458
 * « Bundle Stripe lazy-loaded sur /checkout »). The Payer CTA stays
 * disabled in that window.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { useElements, useStripe } from "@stripe/react-stripe-js";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useCart } from "@/components/cart/cart-context";
import { useDeliveryMode } from "@/components/delivery-mode/delivery-mode-context";
import { decideCartTotals } from "@/lib/delivery-mode";
import {
  captureException,
  decideLatchingOutcome,
  decidePaymentBranch,
  decideRetryAction,
  derivePricingSnapshot,
  type LatchingOutcome,
  type PaymentBranch,
  type SavedCardFicheSnapshot,
} from "@/lib/stripe-payment";
import { LatchingConfirmModal } from "./latching-confirm-modal";
import { NewCardPanel } from "./new-card-panel";
import { SavedCardPanel } from "./saved-card-panel";

function formatEur(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(centimes / 100);
}

/** Customer fields piped from the form's `<input>` controls into the flow. */
export type CheckoutContactValues = {
  firstName: string;
  email: string;
  phone: string;
};

export type StripePaymentSectionProps = {
  tenantId: Id<"tenants">;
  /** Resolved from preloaded fiche on the parent (drives branch + saved-card label). */
  fiche: SavedCardFicheSnapshot | null;
  /** Customer's address from the fiche (needed for `recaptureQuoteAtPayment`). */
  customerAddress: string | undefined;
  /** Customer's lat from the fiche (passed to `createOrderFromCart`). */
  customerLat: number | undefined;
  /** Customer's lng from the fiche (passed to `createOrderFromCart`). */
  customerLng: number | undefined;
  /** Live form values (firstName/email/phone) — read from the parent form. */
  getContactValues: () => CheckoutContactValues;
  /**
   * Contact form validity gate (root-cause fix). When `false`, the pay CTA
   * is disabled so a customer cannot pay with an incomplete contact form.
   * This only gates the BUTTON — the payment flow itself is untouched.
   */
  contactFormValid: boolean;
};

/** Cart line → backend `cartItem` shape consumed by `createOrderFromCart`. */
function mapCartLinesToBackend(
  lines: ReadonlyArray<{
    itemId: string;
    qty: number;
    modifiers: ReadonlyArray<{ groupId: string; optionLabel: string }>;
  }>,
): Array<{
  itemId: Id<"menuItems">;
  quantity: number;
  modifierSelections: Array<{
    modifierGroupId: Id<"modifierGroups">;
    optionLabels: string[];
  }>;
}> {
  // Group modifier selections by `groupId` (the backend validator expects
  // ONE entry per group with an array of option labels; the cart-store
  // models them as flat per-option entries).
  return lines.map((line) => {
    const byGroup = new Map<string, string[]>();
    for (const m of line.modifiers) {
      const arr = byGroup.get(m.groupId) ?? [];
      arr.push(m.optionLabel);
      byGroup.set(m.groupId, arr);
    }
    return {
      itemId: line.itemId as Id<"menuItems">,
      quantity: line.qty,
      modifierSelections: Array.from(byGroup.entries()).map(
        ([groupId, labels]) => ({
          modifierGroupId: groupId as Id<"modifierGroups">,
          optionLabels: labels,
        }),
      ),
    };
  });
}

export function StripePaymentSection({
  tenantId,
  fiche,
  customerAddress,
  customerLat,
  customerLng,
  getContactValues,
  contactFormValid,
}: StripePaymentSectionProps): React.JSX.Element {
  const router = useRouter();
  const stripe = useStripe();
  const elements = useElements();

  const { state: cartState, totals } = useCart();
  const { mode, verdict } = useDeliveryMode();
  const totalsRow = decideCartTotals({
    subtotalCentimes: totals.subtotalCentimes,
    mode,
    verdict,
  });

  // Default branch derived from the fiche; the « Use another card » link
  // forces the new-card branch even when a saved card exists.
  const defaultBranch = decidePaymentBranch(fiche);
  const [branch, setBranch] = useState<PaymentBranch>(defaultBranch);

  // Convex bindings
  const recordCheckoutContact = useMutation(
    api.lib.customer.checkoutContact.recordCheckoutContact,
  );
  const recordConsent = useMutation(
    api.lib.customer.consent.recordConsentAtCheckout,
  );
  const createOrderFromCart = useMutation(
    api.lib.cart.cart.createOrderFromCart,
  );
  const recaptureQuote = useAction(
    api.lib.delivery.quote.recaptureQuoteAtPayment,
  );
  const createPaymentIntent = useAction(
    api.lib.stripe.paymentIntent.createPaymentIntent,
  );
  const payWithSavedCard = useAction(api.lib.stripe.savedCard.payWithSavedCard);

  // State machine — owned locally, narrow on purpose.
  const [isProcessing, setIsProcessing] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [surgeConfirm, setSurgeConfirm] = useState<{
    fromCentimes: number;
    toCentimes: number;
    /** Resolves the user's choice in the pending payment flow. */
    resolve: (proceed: boolean) => void;
  } | null>(null);

  /** Run the latching re-quote (with C&C short-circuit) + resolve the outcome. */
  async function runLatching(): Promise<LatchingOutcome> {
    if (mode === "click_and_collect") {
      return decideLatchingOutcome({
        mode,
        cachedFeeCentimes: 0,
        freshVerdict: null,
      });
    }
    if (customerAddress === undefined) {
      // Defensive: the parent only renders the form when the customer is
      // authenticated; the address-first flow stamps `customers.address`
      // BEFORE the user can reach /checkout. If it's absent, we cannot
      // re-quote — abort fail-closed.
      return { kind: "abort", reason: "hors_zone" };
    }
    const freshVerdict = await recaptureQuote({
      tenantId,
      address: customerAddress,
    });
    return decideLatchingOutcome({
      mode,
      cachedFeeCentimes:
        verdict !== null && verdict.deliverable ? verdict.fee : 0,
      freshVerdict,
    });
  }

  /** Show the surge confirm modal and await user choice. */
  function awaitSurgeConfirm(
    fromCentimes: number,
    toCentimes: number,
  ): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      setSurgeConfirm({ fromCentimes, toCentimes, resolve });
    });
  }

  /** Map the latching abort reason to the user-visible toast wording. */
  function abortReasonToMessage(
    reason: "hors_zone" | "hors_horaire" | "surge",
  ): string {
    if (reason === "hors_horaire") {
      return "Le resto vient de fermer, ta commande ne peut pas être payée maintenant.";
    }
    if (reason === "surge") {
      return "Livraison temporairement indisponible. Réessaie dans quelques minutes.";
    }
    return "Adresse plus en zone de livraison. Reviens à l'accueil pour rebasculer en retrait sur place.";
  }

  /** Centralised handler called on every failure (Stripe / mutation / action). */
  function recordFailure(message: string, err: unknown): void {
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    const action = decideRetryAction(nextAttempts);
    if (action.kind === "fatal-toast") {
      setFatal("Paiement impossible, contacte ton resto");
      setErrorMessage(null);
      captureException(err, {
        tags: { slice: "PWA-S7", tenantId: String(tenantId) },
        extras: { message, attempts: nextAttempts },
      });
    } else {
      setErrorMessage(message);
    }
  }

  async function onPay(): Promise<void> {
    if (isProcessing) return;
    setIsProcessing(true);
    setErrorMessage(null);
    try {
      // 1. Persist contact + consent (best-effort, NOT a payment blocker).
      const contact = getContactValues();
      try {
        await recordCheckoutContact({ tenantId, ...contact });
      } catch (err) {
        // Non-fatal — log and continue (the customer paid for an order
        // is the SoT; the contact prefill loop only suffers a 1-cycle delay).
        captureException(err, {
          tags: { slice: "PWA-S7", step: "recordCheckoutContact" },
        });
      }
      try {
        await recordConsent({ tenantId });
      } catch (err) {
        // Non-fatal in the SAME spirit — ADR 0007 makes the click itself
        // the consent; the stamp is the audit trail, not the consent gate.
        captureException(err, {
          tags: { slice: "PWA-S7", step: "recordConsentAtCheckout" },
        });
      }

      // 2. Latching anti-surge.
      const outcome = await runLatching();
      if (outcome.kind === "abort") {
        setFatal(abortReasonToMessage(outcome.reason));
        return;
      }
      let latchedFeeCentimes =
        mode === "click_and_collect"
          ? 0
          : verdict !== null && verdict.deliverable
            ? verdict.fee
            : 0;
      if (outcome.kind === "confirm-surge") {
        latchedFeeCentimes = outcome.toCentimes;
        const proceed = await awaitSurgeConfirm(
          outcome.fromCentimes,
          outcome.toCentimes,
        );
        if (!proceed) {
          // User declined — return to idle (no order created, no Stripe call).
          return;
        }
      }

      // 3. Build pricing snapshot from the FRESH fee.
      const pricingSnapshot = derivePricingSnapshot({
        mode,
        subtotalCentimes: totals.subtotalCentimes,
        latchedFeeCentimes,
      });

      // 4. Create the order. Map the front mode label
      // (`click_and_collect`) onto the backend `orderMode` validator
      // (`pickup`) — the two are the SAME concept, the differing labels
      // are a pre-existing seam (front: UX label, backend: internal).
      const backendMode = mode === "click_and_collect" ? "pickup" : "delivery";
      const orderId = await createOrderFromCart({
        tenantId,
        mode: backendMode,
        address: mode === "delivery" ? customerAddress : undefined,
        lat: mode === "delivery" ? customerLat : undefined,
        lng: mode === "delivery" ? customerLng : undefined,
        restaurantNote: cartState.note.length > 0 ? cartState.note : undefined,
        items: mapCartLinesToBackend(cartState.lines),
      });

      // 5. Branch on payment mode.
      if (branch.kind === "saved-card") {
        const result = await payWithSavedCard({
          tenantId,
          orderId,
          pricingSnapshot,
        });
        if (result.paymentIntentId.length === 0) {
          recordFailure(
            "Paiement refusé. Essaie une autre carte.",
            new Error("payWithSavedCard returned an empty paymentIntentId"),
          );
          return;
        }
        // Saved card direct-charged successfully — redirect to tracking.
        // The Stripe webhook (`payment_intent.succeeded`) will confirm the
        // order in backend; the tracking page subscribes via Convex sub.
        router.replace(`/c/${orderId}`);
        return;
      }

      // new-card branch: deferred-intent Payment Element.
      if (stripe === null || elements === null) {
        recordFailure(
          "Le formulaire de paiement n'est pas prêt. Réessaie.",
          new Error("Stripe.js not initialised"),
        );
        return;
      }
      // Pre-validate the Payment Element (catches empty card etc. before
      // calling our backend / creating the PaymentIntent).
      const submit = await elements.submit();
      if (submit.error !== undefined) {
        recordFailure(
          submit.error.message ?? "Erreur de validation de la carte.",
          submit.error,
        );
        return;
      }
      const { clientSecret } = await createPaymentIntent({
        tenantId,
        orderId,
        pricingSnapshot,
      });
      const baseUrl = window.location.origin;
      const confirm = await stripe.confirmPayment({
        elements,
        clientSecret,
        confirmParams: {
          return_url: `${baseUrl}/c/${orderId}`,
          // Stripe handles 3DS / Apple Pay redirects via this URL; we
          // never reach the line after confirmPayment on a SUCCESS that
          // required a redirect (the user is already on /c/[orderId]).
        },
        // The Payment Element handles its own redirect contract; when
        // the payment is fully inline (no 3DS), Stripe returns here.
      });
      if (confirm.error !== undefined) {
        recordFailure(
          confirm.error.message ?? "Paiement refusé. Réessaie.",
          confirm.error,
        );
        return;
      }
      // No redirect needed (rare: inline success). Push tracking ourselves.
      router.replace(`/c/${orderId}`);
    } catch (err) {
      recordFailure("Une erreur est survenue. Réessaie.", err);
    } finally {
      setIsProcessing(false);
    }
  }

  // Wire the surge modal's two buttons.
  function onSurgeConfirm(): void {
    if (surgeConfirm === null) return;
    surgeConfirm.resolve(true);
    setSurgeConfirm(null);
  }
  function onSurgeCancel(): void {
    if (surgeConfirm === null) return;
    surgeConfirm.resolve(false);
    setSurgeConfirm(null);
  }

  const stripeReady = stripe !== null && elements !== null;
  const payDisabled =
    isProcessing ||
    fatal !== null ||
    !contactFormValid ||
    (branch.kind === "new-card" && !stripeReady);

  return (
    <section
      className="flex flex-col gap-4"
      data-saved-card-default={
        defaultBranch.kind === "saved-card" ? "true" : "false"
      }
    >
      {branch.kind === "saved-card" ? (
        <SavedCardPanel
          onUseAnotherCard={() => setBranch({ kind: "new-card" })}
        />
      ) : (
        <NewCardPanel />
      )}

      {/* Inline retry banner (failures 1 + 2). */}
      {errorMessage !== null && fatal === null ? (
        <div
          role="alert"
          className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {errorMessage}
        </div>
      ) : null}

      {/* Fatal toast (failure 3 OR unrecoverable abort). */}
      {fatal !== null ? (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {fatal}
        </div>
      ) : null}

      <button
        type="button"
        onClick={onPay}
        disabled={payDisabled}
        className="rounded-lg bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isProcessing
          ? "Paiement en cours…"
          : `Payer ${formatEur(totalsRow.totalCentimes)}`}
      </button>

      {/* Root-cause gate hint: surfaced only when the contact form is the
          reason the CTA is disabled (not while processing / fatal). */}
      {!contactFormValid && !isProcessing && fatal === null ? (
        <p className="text-xs text-zinc-500">
          Remplis tes coordonnées pour continuer
        </p>
      ) : null}

      <LatchingConfirmModal
        open={surgeConfirm !== null}
        fromCentimes={surgeConfirm?.fromCentimes ?? 0}
        toCentimes={surgeConfirm?.toCentimes ?? 0}
        onConfirm={onSurgeConfirm}
        onCancel={onSurgeCancel}
      />
    </section>
  );
}
