"use client";

/**
 * PWA-S7 (#458) — `<LatchingConfirmModal>` — the blocking confirm modal
 * shown when the FRESH `recaptureQuoteAtPayment` verdict returns a higher
 * fee than the cached panier fee (US 47, decisions-log Q7 « si fee monte →
 * modal `<LatchingConfirmModal>` bloquant »).
 *
 * Stays open until the user explicitly chooses « Oui » (proceed with the
 * higher fee) or « Non » (cancel — back to the cart). Non-skippable Esc /
 * click-outside (same Radix primitive contract as
 * `<PushEnrollmentModal>`): a stray Esc keystroke should not silently
 * accept a price hike.
 *
 * Pure presentation — the latching DECISION is owned by
 * `decideLatchingOutcome` in `lib/stripe-payment/`; this component just
 * renders the `confirm-surge` outcome's two values + the two callbacks.
 */
import { Dialog as DialogPrimitive } from "radix-ui";

function formatEur(centimes: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(centimes / 100);
}

export type LatchingConfirmModalProps = {
  open: boolean;
  /** Cached panier fee (centimes) the user agreed to. */
  fromCentimes: number;
  /** Fresh fee (centimes) Stripe will charge if confirmed. */
  toCentimes: number;
  /** User clicked « Oui » — proceed with the higher fee. */
  onConfirm: () => void;
  /** User clicked « Non » — cancel; the form returns to its idle state. */
  onCancel: () => void;
};

export function LatchingConfirmModal({
  open,
  fromCentimes,
  toCentimes,
  onConfirm,
  onCancel,
}: LatchingConfirmModalProps): React.JSX.Element {
  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          // Non-skippable: Esc + click-outside both prevented (US 47:
          // never silently accept a price hike).
          onEscapeKeyDown={(e) => e.preventDefault()}
          onPointerDownOutside={(e) => e.preventDefault()}
          className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border border-zinc-200 bg-white p-6 shadow-xl"
        >
          <DialogPrimitive.Title className="text-lg font-semibold text-black">
            Le tarif livraison a changé
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-sm text-zinc-700">
            Le tarif livraison est passé de{" "}
            <strong className="text-zinc-900">{formatEur(fromCentimes)}</strong>{" "}
            à <strong className="text-zinc-900">{formatEur(toCentimes)}</strong>
            . Confirmes-tu ?
          </DialogPrimitive.Description>
          <div className="mt-2 flex flex-col gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-lg bg-emerald-700 px-4 py-3 text-base font-semibold text-white hover:bg-emerald-800"
            >
              Oui, payer {formatEur(toCentimes)} de livraison
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-3 text-base font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Non, annuler
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
