/**
 * PWA-S6a (#455) — `decideModalStep` — pure state machine for
 * `<PushEnrollmentModal>` (decisions-log Q8 « Modal single-screen
 * non-skippable + flow async install Wallet »).
 *
 * Two visible steps for S6a:
 *
 *   1. `"choice"`         — the entry screen with the 2 channel options
 *                            visible together (Wallet primary +
 *                            Web Push secondary placeholder). The modal opens
 *                            here when `<CheckoutForm>` clicks "Payer" with
 *                            the gate `disabled`.
 *
 *   2. `"wallet-loading"` — the async install loader (US 33). The user
 *                            clicked « Ajouter à mon Wallet », the action
 *                            `generatePass` ran, the device dispatch fired,
 *                            and we are now waiting for the webhook
 *                            `pass_installed` → Convex sub flip
 *                            `walletStatus = "enrolled"` → modal close auto.
 *                            From here: « J'ai changé d'avis » → back to
 *                            `"choice"` (US 34); « Tester sans attendre » →
 *                            poll `wallet.checkInstallStatus` (US 33).
 *
 * The union is OPEN via the discriminant `kind` — S6b will add
 * `"web-push-loading"`, S6c will add `"fallback-l1" / "l2" / "l3"`. The auto-
 * close on `walletStatus = enrolled` is a side-effect of the modal (it
 * renders `null` when the gate flips to active), NOT a step in this machine
 * — modelling it here would couple the pure decision to the gate logic.
 *
 * Transitions (all other events on all other states are no-op, by design — a
 * silent swallow is robust to component re-renders + double-clicks):
 *   choice         -- ClickWalletPrimary  --> wallet-loading
 *   wallet-loading -- ClickChangeOfMind   --> choice
 */

/** The visible step of the modal. Open union (S6b/S6c will extend). */
export type ModalStep = { kind: "choice" } | { kind: "wallet-loading" };

/**
 * The events the modal reducer accepts. `ClickWalletPrimary` fires the
 * device-specific install dispatch; `ClickChangeOfMind` is the "back" link
 * during loading (US 34). Open union, same shape as `ModalStep`.
 */
export type ModalEvent =
  | { kind: "ClickWalletPrimary" }
  | { kind: "ClickChangeOfMind" };

/**
 * Compute the next step for a given (current step, event) pair. Pure: no IO,
 * no hidden state, never mutates `current`. Unknown / disallowed transitions
 * return the SAME state (a silent no-op — a state machine that swallows
 * stray events is robust to UI double-clicks + re-renders).
 */
export function decideModalStep(
  current: ModalStep,
  event: ModalEvent,
): ModalStep {
  switch (current.kind) {
    case "choice": {
      if (event.kind === "ClickWalletPrimary") {
        return { kind: "wallet-loading" };
      }
      return current;
    }
    case "wallet-loading": {
      if (event.kind === "ClickChangeOfMind") {
        return { kind: "choice" };
      }
      return current;
    }
    default: {
      // Exhaustiveness — the union is open; future kinds short-circuit here.
      const _exhaustive: never = current;
      return _exhaustive;
    }
  }
}
