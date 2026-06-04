/**
 * PWA-S10 (#462) — tests for `decideA2hsButtonVisibility`, the pure decision
 * the `<AndroidInstallButton>` consults to know whether to render itself
 * (decisions-log Q4 « A2HS Android trigger : bouton bottom-right rendered
 * conditionnellement après cart.items.length >= 1 ET prompt capturé ET pas
 * déjà standalone », US 56 / 57 / 59).
 *
 * The decision lives in `apps/web/src/lib/a2hs-install/` next to its peers
 * (`push-enrollment` / `wallet-prompt`) and follows the same shape: 4
 * boolean / enum inputs → discriminated union out, every branch
 * vitest-pinnable in node env.
 *
 * Branch matrix (ALL conditions must be met to SHOW the button):
 *   1. `hasBeforeInstallPrompt = true`   — the captured event (Android Chrome only)
 *   2. `cartItemCount >= 1`              — post-cart trigger (Q4)
 *   3. `isStandalone = false`            — not already installed (US 59 heuristic)
 *   4. `a2hsStatus !== "enrolled"`       — backend already knows we installed
 *
 * iOS Safari NEVER fires `beforeinstallprompt` → `hasBeforeInstallPrompt`
 * stays false → button NEVER shows (US 56 explicit, AC 5 « iOS → bouton
 * n'apparaît jamais »). The iOS A2HS bottom-sheet is a SEPARATE surface
 * (PWA-S11 #463) — out of scope here.
 */
import { describe, expect, it } from "vitest";
import { decideA2hsButtonVisibility } from "./decide-a2hs-button-visibility";

const SHOW = { kind: "show" } as const;

describe("decideA2hsButtonVisibility — show", () => {
  it("renders when ALL four conditions are met (Android post-cart, prompt captured, not standalone, not enrolled)", () => {
    expect(
      decideA2hsButtonVisibility({
        hasBeforeInstallPrompt: true,
        cartItemCount: 1,
        isStandalone: false,
        a2hsStatus: undefined,
      }),
    ).toEqual(SHOW);
  });

  it("renders with cartItemCount > 1 too (post-cart threshold is >= 1)", () => {
    expect(
      decideA2hsButtonVisibility({
        hasBeforeInstallPrompt: true,
        cartItemCount: 5,
        isStandalone: false,
        a2hsStatus: "not_enrolled",
      }),
    ).toEqual(SHOW);
  });

  it('renders when a2hsStatus is "revoked" (re-offer install — same shape as wallet-prompt revoked)', () => {
    expect(
      decideA2hsButtonVisibility({
        hasBeforeInstallPrompt: true,
        cartItemCount: 1,
        isStandalone: false,
        a2hsStatus: "revoked",
      }),
    ).toEqual(SHOW);
  });
});

describe("decideA2hsButtonVisibility — hidden", () => {
  it("hides when the cart is empty (Q4: trigger AFTER 1er ajout panier)", () => {
    expect(
      decideA2hsButtonVisibility({
        hasBeforeInstallPrompt: true,
        cartItemCount: 0,
        isStandalone: false,
        a2hsStatus: undefined,
      }),
    ).toEqual({ kind: "hidden", reason: "cart-empty" });
  });

  it("hides when beforeinstallprompt was never captured (iOS Safari / desktop / Chrome already-installed)", () => {
    expect(
      decideA2hsButtonVisibility({
        hasBeforeInstallPrompt: false,
        cartItemCount: 3,
        isStandalone: false,
        a2hsStatus: undefined,
      }),
    ).toEqual({ kind: "hidden", reason: "no-prompt-captured" });
  });

  it("hides when the PWA is already running standalone (US 59 — heuristique flip enrolled)", () => {
    expect(
      decideA2hsButtonVisibility({
        hasBeforeInstallPrompt: true,
        cartItemCount: 1,
        isStandalone: true,
        a2hsStatus: undefined,
      }),
    ).toEqual({ kind: "hidden", reason: "already-standalone" });
  });

  it("hides when a2hsStatus is enrolled (backend already knows we installed — AC 4)", () => {
    expect(
      decideA2hsButtonVisibility({
        hasBeforeInstallPrompt: true,
        cartItemCount: 1,
        isStandalone: false,
        a2hsStatus: "enrolled",
      }),
    ).toEqual({ kind: "hidden", reason: "already-enrolled" });
  });
});

describe("decideA2hsButtonVisibility — precedence", () => {
  // Precedence pins the reason surfaced when multiple hide conditions are
  // true at once — useful for the analytics breadcrumb (so the Sentry log
  // names ONE root cause, not « ambiguous »). Order chosen so the strongest
  // signal wins:
  //   1. `enrolled` is the loudest backend truth — they're DONE, never
  //      offer install again.
  //   2. `standalone` is the live device truth — they're IN the PWA right
  //      now; the backend just hasn't flipped yet (S10 fires the mutation
  //      to fix this).
  //   3. `no-prompt-captured` is the next-strongest signal — we literally
  //      can't install without the prompt; everything else is moot.
  //   4. `cart-empty` is the soft trigger gate — last to surface.

  it("enrolled wins over standalone + no prompt + empty cart", () => {
    expect(
      decideA2hsButtonVisibility({
        hasBeforeInstallPrompt: false,
        cartItemCount: 0,
        isStandalone: true,
        a2hsStatus: "enrolled",
      }),
    ).toEqual({ kind: "hidden", reason: "already-enrolled" });
  });

  it("standalone wins over no-prompt + empty cart (when not enrolled yet)", () => {
    expect(
      decideA2hsButtonVisibility({
        hasBeforeInstallPrompt: false,
        cartItemCount: 0,
        isStandalone: true,
        a2hsStatus: undefined,
      }),
    ).toEqual({ kind: "hidden", reason: "already-standalone" });
  });

  it("no-prompt-captured wins over empty cart (when not standalone, not enrolled)", () => {
    expect(
      decideA2hsButtonVisibility({
        hasBeforeInstallPrompt: false,
        cartItemCount: 0,
        isStandalone: false,
        a2hsStatus: undefined,
      }),
    ).toEqual({ kind: "hidden", reason: "no-prompt-captured" });
  });
});
