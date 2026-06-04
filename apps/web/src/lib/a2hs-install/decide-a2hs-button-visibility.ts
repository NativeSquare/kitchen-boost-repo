/**
 * PWA-S10 (#462) — `decideA2hsButtonVisibility` — pure decision returning
 * whether the Android A2HS install button (`<AndroidInstallButton>`) should
 * render right now (decisions-log Q4 « A2HS Android trigger : `beforeinstallprompt`
 * capture + bouton bottom-right après 1er add cart + click → `prompt.prompt()` »,
 * US 56 / 57 / 59).
 *
 * Four conditions ALL required to SHOW the button (any missing → hidden):
 *   1. `hasBeforeInstallPrompt = true`   — the captured event the click consumes
 *                                          (Android Chrome only; iOS Safari NEVER fires it)
 *   2. `cartItemCount >= 1`              — post-cart trigger (Q4, US 56)
 *   3. `isStandalone = false`            — not already running as an installed PWA
 *                                          (US 59 heuristic — once standalone, the
 *                                          install button is meaningless)
 *   4. `a2hsStatus !== "enrolled"`       — backend already knows we installed
 *                                          (AC 4 « visite suivante après install →
 *                                          bouton n'apparaît plus »)
 *
 * iOS Safari path : `hasBeforeInstallPrompt` STAYS false on iOS (the platform
 * never fires the event — Apple limitation), so the button NEVER renders on
 * iOS (US 56 AC 5 « iOS → bouton n'apparaît jamais »). The iOS A2HS instructional
 * bottom-sheet is a SEPARATE surface (PWA-S11 #463) — out of scope here.
 *
 * Splitting the decision from the React IO keeps every branch vitest-pinnable
 * in node env, same shape as `decideWalletPromptVisibility` (#460) /
 * `decideWebPushCapability` (#456) / `decidePaymentGate` (#454).
 *
 * `PushChannelStatus` mirrors the backend `pushChannelStatus` union — we
 * re-declare it locally (rather than import from `@/lib/wallet-prompt`) so
 * the module is self-contained and the front never gains a transitive backend
 * coupling. Same pattern as `checkout-gate` / `wallet-prompt`.
 */

/** Per-channel push enrollment status (mirror of backend `pushChannelStatus`). */
export type PushChannelStatus = "enrolled" | "not_enrolled" | "revoked";

export type DecideA2hsButtonVisibilityInput = {
  /**
   * `true` once the React `<PWAInstallProvider>` has captured an
   * unconsumed `beforeinstallprompt` event. Stays `false` on iOS Safari
   * (event never fires — Apple limitation), on desktop, and after the
   * captured prompt has been used (one-shot).
   */
  hasBeforeInstallPrompt: boolean;
  /**
   * Number of distinct items currently in the cart (NOT the qty sum — any
   * line is enough). Comes from `useCart().state.lines.length` (or
   * equivalent). Trigger threshold: `>= 1` (Q4 « après 1er ajout panier »).
   */
  cartItemCount: number;
  /**
   * `true` when the PWA is running in installed standalone mode
   * (`window.matchMedia('(display-mode: standalone)').matches`). US 59
   * heuristic — flips `a2hsStatus = "enrolled"` on the backend on the next
   * visit; the button must hide immediately even before the backend round-trip
   * (otherwise it briefly flashes after install on the same session).
   */
  isStandalone: boolean;
  /**
   * The live `a2hsStatus` from the customer's `pushEnrollment` (Convex sub
   * on `getCurrentCustomer`). `undefined` covers the anonymous fiche before
   * the first install attempt + the fiche with no `pushEnrollment` object
   * yet (S2 just provisioned). All three (`undefined` / `not_enrolled` /
   * `revoked`) are treated as « not yet enrolled » — only the explicit
   * `"enrolled"` literal vetoes the button (the user previously installed
   * and we know about it).
   */
  a2hsStatus: PushChannelStatus | undefined;
};

/**
 * Why the button is hidden — analytics-friendly enum, surfaced for breadcrumbs.
 * Order of cases here mirrors the precedence in `decideA2hsButtonVisibility`.
 */
export type A2hsButtonHiddenReason =
  | "already-enrolled"
  | "already-standalone"
  | "no-prompt-captured"
  | "cart-empty";

/**
 * The visibility verdict. Discriminated on `kind`:
 *  - `show` : render the button (Android Chrome, prompt captured, cart non-empty,
 *    not standalone, not enrolled).
 *  - `hidden` : do NOT render. `reason` names the strongest hide signal
 *    (precedence: enrolled > standalone > no-prompt > cart-empty).
 */
export type A2hsButtonVisibility =
  | { kind: "show" }
  | { kind: "hidden"; reason: A2hsButtonHiddenReason };

/**
 * Decide whether `<AndroidInstallButton>` should render.
 *
 * Precedence rationale (strongest backend/device truth wins):
 *  1. `a2hsStatus = "enrolled"` — loudest backend truth. They installed and
 *     the backend knows; the button is permanently retired on this fiche.
 *  2. `isStandalone = true` — live device truth (running INSIDE the PWA right
 *     now). The backend may not yet have the flag (S10 fires the mutation
 *     when the user accepts; the standalone heuristic catches users who
 *     installed via the browser menu without going through our button).
 *  3. `!hasBeforeInstallPrompt` — we literally cannot install (no captured
 *     event to call `.prompt()` on). Hides on iOS Safari / desktop / already
 *     consumed prompt.
 *  4. `cartItemCount < 1` — soft trigger gate (Q4 « post-cart »).
 */
export function decideA2hsButtonVisibility(
  input: DecideA2hsButtonVisibilityInput,
): A2hsButtonVisibility {
  if (input.a2hsStatus === "enrolled") {
    return { kind: "hidden", reason: "already-enrolled" };
  }
  if (input.isStandalone) {
    return { kind: "hidden", reason: "already-standalone" };
  }
  if (!input.hasBeforeInstallPrompt) {
    return { kind: "hidden", reason: "no-prompt-captured" };
  }
  if (input.cartItemCount < 1) {
    return { kind: "hidden", reason: "cart-empty" };
  }
  return { kind: "show" };
}
