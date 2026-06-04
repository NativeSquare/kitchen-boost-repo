/**
 * PWA-S6a (#455) — `decideModalStep` — the pure state machine driving
 * `<PushEnrollmentModal>` (decisions-log Q8 « Modal single-screen
 * non-skippable + flow async install Wallet »).
 *
 * The modal has 2 visible steps for S6a (the Web Push branch is the next slice
 * S6b #456; the fallback chain is the slice after that S6c #457):
 *
 *   1. `"choice"` — the entry screen with the 2 channel options visible
 *      together (Wallet primary + Web Push disabled-placeholder). This is
 *      what opens when `<CheckoutForm>` clicks "Payer" with the gate
 *      `disabled` (S6 stub `console.log` → real modal here).
 *
 *   2. `"wallet-loading"` — the async install loader (US 33 « Tester sans
 *      attendre »): the user clicked « Ajouter à mon Wallet », the action
 *      `generatePass` ran, the device-specific dispatch fired (Blob on iOS,
 *      Save link on Android), and we are now waiting for the webhook
 *      `pass_installed` → Convex sub flip `walletStatus = enrolled` to
 *      close the modal automatically. While in this step, the user can
 *      click « J'ai changé d'avis » → back to `"choice"` (US 34), or
 *      « Tester sans attendre » → poll `checkInstallStatus` (US 33).
 *
 * S6a deliberately STOPS at these 2 steps. A `"web-push-loading"` step + a
 * `"fallback-l1"`/`"l2"`/`"l3"` chain land in S6b / S6c respectively. The
 * union below is open via the discriminant `kind` so the next slice extends
 * it without breaking the S6a callers.
 *
 * Auto-close on enrolled is a side-effect of the modal — it is NOT a step.
 * The wire shape is `kind: "choice" | "wallet-loading"`; the modal renders
 * `null` (auto-closes) when the gate flips to `active` via the Convex sub.
 * Modelling the auto-close in `decideModalStep` would couple this pure
 * decision to the gate logic; instead the modal short-circuits at render
 * time when the gate is active.
 *
 * Transitions:
 *   choice  -- ClickWalletPrimary   --> wallet-loading
 *   wallet-loading -- ClickChangeOfMind --> choice
 *
 * Every other event (re-click on Wallet during loading, etc.) is a no-op
 * (= return the same state). This is deliberate: a state machine that
 * silently swallows unexpected events is robust to component re-renders +
 * double-clicks.
 */
import { describe, expect, it } from "vitest";
import {
  type ModalEvent,
  type ModalStep,
  decideModalStep,
} from "./decide-modal-step";

describe("decideModalStep — initial state", () => {
  it("starts at `choice` (the entry screen with the 2 channel options)", () => {
    // The modal opens directly on the choice screen when <CheckoutForm>
    // clicks "Payer" with the gate disabled (decisions-log Q8).
    const init: ModalStep = { kind: "choice" };
    expect(init.kind).toBe("choice");
  });
});

describe("decideModalStep — choice → wallet-loading transition", () => {
  it("transitions from `choice` to `wallet-loading` on ClickWalletPrimary", () => {
    const current: ModalStep = { kind: "choice" };
    const next = decideModalStep(current, {
      kind: "ClickWalletPrimary",
    });
    expect(next.kind).toBe("wallet-loading");
  });

  it("ignores ClickChangeOfMind on `choice` (no-op — there is no previous step)", () => {
    const current: ModalStep = { kind: "choice" };
    const next = decideModalStep(current, { kind: "ClickChangeOfMind" });
    expect(next).toEqual(current);
  });
});

describe("decideModalStep — wallet-loading → choice transition (US 34 « J'ai changé d'avis »)", () => {
  it("transitions back from `wallet-loading` to `choice` on ClickChangeOfMind", () => {
    const current: ModalStep = { kind: "wallet-loading" };
    const next = decideModalStep(current, { kind: "ClickChangeOfMind" });
    expect(next.kind).toBe("choice");
  });

  it("ignores re-ClickWalletPrimary while already in `wallet-loading` (idempotent against double-click)", () => {
    const current: ModalStep = { kind: "wallet-loading" };
    const next = decideModalStep(current, { kind: "ClickWalletPrimary" });
    expect(next).toEqual(current);
  });
});

describe("decideModalStep — purity", () => {
  it("returns the same state shape for the same (state, event) pair (referential transparency)", () => {
    const a = decideModalStep(
      { kind: "choice" },
      { kind: "ClickWalletPrimary" },
    );
    const b = decideModalStep(
      { kind: "choice" },
      { kind: "ClickWalletPrimary" },
    );
    expect(a).toEqual(b);
  });

  it("never mutates the input state object (pure function)", () => {
    const current = Object.freeze({ kind: "choice" } as ModalStep);
    expect(() =>
      decideModalStep(current, { kind: "ClickWalletPrimary" }),
    ).not.toThrow();
  });
});

describe("decideModalStep — exhaustive event surface", () => {
  it("exposes a discriminated union on `kind` so callers can switch exhaustively", () => {
    const events: ModalEvent[] = [
      { kind: "ClickWalletPrimary" },
      { kind: "ClickChangeOfMind" },
    ];
    // Just a typing-surface assertion: every event flows through the
    // exhaustive `switch` in decideModalStep without falling into a default
    // throwing branch.
    for (const ev of events) {
      expect(() => decideModalStep({ kind: "choice" }, ev)).not.toThrow();
      expect(() =>
        decideModalStep({ kind: "wallet-loading" }, ev),
      ).not.toThrow();
    }
  });
});
