"use client";

/**
 * PWA-S7 (#458) — `<SavedCardPanel>` — the saved-card branch (US 45). The
 * customer has a `savedPaymentMethodId` on their fiche (set by a previous
 * resto via the platform Stripe Customer, 2.5-D « clone PM cross-resto »)
 * — pre-select it as a tile + offer the escape « Utiliser une autre carte »
 * link that flips the parent to the new-card branch.
 *
 * We deliberately render the card as « Payer avec ma carte enregistrée »
 * WITHOUT a `**** 1234` suffix : the backend `saveCard` action does NOT
 * persist `last4` on the fiche (see `packages/backend/convex/lib/stripe/
 * savedCard.ts` — the platform PaymentMethod is referenced by id only).
 * Surfacing « **** XXXX » would require either (a) calling Stripe's
 * `/payment_methods/<id>` from the front (impossible — needs the secret
 * key; ADR-aligned never expose secret to client) or (b) caching `last4`
 * on the fiche (out of scope of this issue — a separate slice would have
 * to extend the schema + the saveCard mutation). The neutral wording is
 * sufficient for the moat UX while keeping S7's scope tight.
 */

export type SavedCardPanelProps = {
  /** Called when the user clicks « Utiliser une autre carte » → parent flips to new-card. */
  onUseAnotherCard: () => void;
};

export function SavedCardPanel({
  onUseAnotherCard,
}: SavedCardPanelProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className="flex h-8 w-12 items-center justify-center rounded bg-white text-xs font-semibold tracking-wide text-emerald-700"
        >
          •••• •••
        </span>
        <span className="text-base font-medium text-black">
          Payer avec ma carte enregistrée
        </span>
      </div>
      <p className="text-xs text-zinc-600">
        Tu réutilises la carte que tu as enregistrée lors d&apos;une commande
        précédente sur KitchenBoost.
      </p>
      <button
        type="button"
        onClick={onUseAnotherCard}
        className="self-start text-sm font-medium text-emerald-700 underline hover:text-emerald-800"
      >
        Utiliser une autre carte
      </button>
    </div>
  );
}
