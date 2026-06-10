/**
 * PWA-S7 (#458) — pure decision returning which `/checkout` payment branch
 * to render by DEFAULT, given the customer's preloaded fiche
 * (US 45 / 46, decisions-log Q6 « branche saved card vs Payment Element »).
 *
 * Rule:
 *  - `savedPaymentMethodId` present on the fiche → "saved-card" tile
 *    (« Payer avec ma carte enregistrée » + a link « Utiliser une autre
 *    carte » the parent component owns to toggle to the new-card branch);
 *  - otherwise → "new-card" branch (Stripe Payment Element, US 46 — Apple
 *    Pay / Google Pay via `automatic_payment_methods`).
 *
 * `stripeCustomerId` alone (no PaymentMethod) is INSUFFICIENT — a customer
 * may have a platform Customer record without an active saved card (e.g.
 * the card was detached by Stripe or removed manually). Only the
 * PaymentMethod id is the chargeable handle on the platform side.
 *
 * `SavedCardFicheSnapshot` mirrors the SUBSET of `Doc<"customers">` the
 * decision reads — kept local on purpose, the front never imports the
 * Convex `Doc` shape (decoupled from the backend module graph, same shape
 * as `CustomerFicheSnapshot` in `decide-prefill.ts`).
 */

/** Minimal shape of `customers` row the saved-card branch needs. */
export type SavedCardFicheSnapshot = {
  /** Platform Stripe Customer id, KB-account level (NOT tenant). */
  stripeCustomerId?: string;
  /** Platform PaymentMethod id saved on the platform Customer. */
  savedPaymentMethodId?: string;
};

/** The default payment branch the form should render at mount. */
export type PaymentBranch = { kind: "saved-card" } | { kind: "new-card" };

/**
 * Decide the default payment branch for a given customer fiche. A `null`
 * fiche (anonymous first visit) collapses to "new-card" — no saved card to
 * surface yet. A fiche without `savedPaymentMethodId` is also "new-card",
 * even if `stripeCustomerId` is present (platform Customer reused but card
 * removed — see file header).
 */
export function decidePaymentBranch(
  fiche: SavedCardFicheSnapshot | null,
): PaymentBranch {
  if (fiche === null) return { kind: "new-card" };
  if (fiche.savedPaymentMethodId === undefined) return { kind: "new-card" };
  return { kind: "saved-card" };
}
