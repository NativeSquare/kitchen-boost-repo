/**
 * PWA-S11 (#463) — tests for `decideIosStandaloneHeuristic`, the pure
 * decision the `<IOSStandaloneHeuristicRunner>` consults to know whether to
 * fire the `recordA2hsAccepted` mutation on a visit (decisions-log Q4 /
 * US 59 « heuristique standalone à la visite suivante pour tracker enrolled »).
 *
 * On iOS Safari, A2HS install completes OUTSIDE our app (user goes to the
 * Share menu, taps « Sur l'écran d'accueil », confirms — no JS event fires).
 * The only signal we get on the NEXT visit is the standalone display-mode
 * media query — that's the heuristic. We fire the mutation EXACTLY ONCE per
 * fiche per install: re-running on every page load would write redundant
 * audit rows. The backend mutation IS idempotent, but the heuristic decision
 * is the one place we can avoid the round-trip noise.
 *
 * Decision matrix:
 *   - standalone + NOT enrolled → flip (fire the mutation, attribute the install).
 *   - standalone + already enrolled → noop (already-flipped, save the round-trip).
 *   - NOT standalone → noop (regular browser tab, never the install signal).
 *
 * Why NOT gate on iOS-only here :
 *   The standalone heuristic ALSO fires for the user who skipped the bottom
 *   sheet on /c/[orderId] and installed via the Chrome menu on Android (US 59
 *   « heuristique standalone à la visite suivante »). The #462 sibling
 *   handles the Android `appinstalled` window event INSIDE the active session;
 *   the runner here is the safety net for the cross-session signal on EVERY
 *   platform. Excluding non-iOS would create a backend signal gap where a
 *   user installs Android via the browser menu, closes the tab before the
 *   `appinstalled` listener fires (rare race), and re-opens later in
 *   standalone — without this runner the `a2hsStatus` would never flip.
 */
import { describe, expect, it } from "vitest";
import { decideIosStandaloneHeuristic } from "./decide-ios-standalone-heuristic";

describe("decideIosStandaloneHeuristic — flip", () => {
  it("flips when standalone + a2hsStatus undefined (first revisit after install)", () => {
    expect(
      decideIosStandaloneHeuristic({
        isStandalone: true,
        a2hsStatus: undefined,
      }),
    ).toEqual({ kind: "flip" });
  });

  it("flips when standalone + a2hsStatus = not_enrolled (Convex sub loaded the fiche but no install signal yet)", () => {
    expect(
      decideIosStandaloneHeuristic({
        isStandalone: true,
        a2hsStatus: "not_enrolled",
      }),
    ).toEqual({ kind: "flip" });
  });

  it('flips when standalone + a2hsStatus = "revoked" (re-install after uninstall)', () => {
    expect(
      decideIosStandaloneHeuristic({
        isStandalone: true,
        a2hsStatus: "revoked",
      }),
    ).toEqual({ kind: "flip" });
  });
});

describe("decideIosStandaloneHeuristic — noop", () => {
  it("noops when standalone + already enrolled (save the redundant round-trip)", () => {
    expect(
      decideIosStandaloneHeuristic({
        isStandalone: true,
        a2hsStatus: "enrolled",
      }),
    ).toEqual({ kind: "noop", reason: "already-enrolled" });
  });

  it("noops when NOT standalone + undefined (regular browser tab)", () => {
    expect(
      decideIosStandaloneHeuristic({
        isStandalone: false,
        a2hsStatus: undefined,
      }),
    ).toEqual({ kind: "noop", reason: "not-standalone" });
  });

  it("noops when NOT standalone + already enrolled (consistent baseline)", () => {
    expect(
      decideIosStandaloneHeuristic({
        isStandalone: false,
        a2hsStatus: "enrolled",
      }),
    ).toEqual({ kind: "noop", reason: "not-standalone" });
  });

  it("noops when NOT standalone + not_enrolled (still in browser tab)", () => {
    expect(
      decideIosStandaloneHeuristic({
        isStandalone: false,
        a2hsStatus: "not_enrolled",
      }),
    ).toEqual({ kind: "noop", reason: "not-standalone" });
  });
});

describe("decideIosStandaloneHeuristic — precedence", () => {
  // `not-standalone` wins over `already-enrolled` when both apply because
  // « not standalone » is the loudest signal (we're literally not in the PWA
  // right now — nothing to attribute). The reason ordering matches:
  // not-standalone > already-enrolled.
  it("not-standalone wins over already-enrolled when both apply", () => {
    expect(
      decideIosStandaloneHeuristic({
        isStandalone: false,
        a2hsStatus: "enrolled",
      }),
    ).toEqual({ kind: "noop", reason: "not-standalone" });
  });
});
