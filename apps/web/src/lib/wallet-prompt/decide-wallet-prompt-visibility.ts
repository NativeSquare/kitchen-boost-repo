/**
 * PWA-S9a (#460) — `decideWalletPromptVisibility` — pure decision returning
 * whether the Wallet install prompt (palier 1 card after address-first OR
 * palier 2 banner permanent menu/panier) should be visible (decisions-log
 * Q5 « 3 paliers Wallet install », US 27 + US 28).
 *
 * The decision is consumed by:
 *  - `<WalletPromptCard>` (palier 1, full-page card after address-first) —
 *    `dismissed = false` initially; the « Plus tard » link navigates away
 *    rather than flipping `dismissed` (the redirect IS the skip).
 *  - `<WalletPromptBanner>` (palier 2, top banner on menu/panier) —
 *    `dismissed` is the sessionStorage-backed boolean toggled by the X close
 *    button (issue AC « X session-scoped (sessionStorage) »).
 *
 * Splitting the decision from the React IO keeps every branch vitest-pinnable
 * in node env, same shape as `decidePaymentGate` (#454) /
 * `decideAddressFirstAction` (#451) / `decideManifest` (#449).
 *
 * `PushChannelStatus` mirrors the backend `pushChannelStatus` union
 * (`packages/backend/convex/table/customers.ts`). We keep a LOCAL declaration
 * here so the front never depends on the backend module graph — same pattern
 * as `checkout-gate/decide-payment-gate`. If the backend ever adds a status,
 * this type is the single front-side anchor to update + the visibility test
 * will fail loudly.
 */

/** Per-channel push enrollment status (mirror of backend `pushChannelStatus`). */
export type PushChannelStatus = "enrolled" | "not_enrolled" | "revoked";

export type DecideWalletPromptVisibilityInput = {
  /**
   * The live `walletStatus` from the customer's `pushEnrollment` (Convex sub
   * on `getCurrentCustomer`). `undefined` covers:
   *  - the anonymous fiche before the first Wallet install attempt,
   *  - the fiche with no `pushEnrollment` object yet (S2 just provisioned),
   *  - the fiche with `pushEnrollment` but no `walletStatus` field set.
   * All three are treated identically — the prompt SHOWS.
   */
  walletStatus: PushChannelStatus | undefined;
  /**
   * Session-scoped dismissal flag. The card's « Plus tard » never sets this
   * (it navigates away — the skip is implicit), so palier 1 always passes
   * `dismissed = false`. The banner's X sets `sessionStorage[KEY] = "1"`
   * → palier 2 hides for the session, re-appears next session.
   */
  dismissed: boolean;
};

/**
 * The visibility of either Wallet prompt. Discriminated on `kind`:
 *  - `show` : the prompt should render. The component decides the layout
 *    (card vs banner) — the decision only owns SHOULD-RENDER.
 *  - `hidden` : the prompt should NOT render. The `reason` is surfaced for
 *    debugging + a future variant test (e.g. surface a thank-you toast on
 *    `already-enrolled` first hide).
 */
export type WalletPromptVisibility =
  | { kind: "show" }
  | { kind: "hidden"; reason: "already-enrolled" | "dismissed" };

/**
 * Decide whether either Wallet prompt should render.
 *
 * Precedence (issue AC + Q5):
 *  1. `enrolled` ALWAYS wins → hidden (`already-enrolled`). The moat is
 *     captured; no point nagging the user even if they previously dismissed
 *     the banner — the dismiss flag is irrelevant once they convert.
 *  2. Otherwise, if `dismissed` → hidden (`dismissed`). Session-scoped
 *     respect of the X click on the banner.
 *  3. Otherwise → show.
 *
 * `not_enrolled` and `revoked` are both treated as « not yet enrolled » (the
 * latter happens when the user removed the pass from Wallet — we re-offer
 * the moat). Only the explicit `"enrolled"` literal vetoes the prompt.
 */
export function decideWalletPromptVisibility(
  input: DecideWalletPromptVisibilityInput,
): WalletPromptVisibility {
  if (input.walletStatus === "enrolled") {
    return { kind: "hidden", reason: "already-enrolled" };
  }
  if (input.dismissed) {
    return { kind: "hidden", reason: "dismissed" };
  }
  return { kind: "show" };
}
