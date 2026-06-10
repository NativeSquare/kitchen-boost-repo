/**
 * PWA-S11 (#463) — `decideIosStandaloneHeuristic` — pure decision for the
 * `<IOSStandaloneHeuristicRunner>` (decisions-log Q4, US 59 « heuristique
 * standalone à la visite suivante pour tracker enrolled »).
 *
 * iOS A2HS install completes OUTSIDE our app (the user navigates the Safari
 * Share menu, taps « Sur l'écran d'accueil », confirms — no JS event fires
 * during the flow, unlike Android's `beforeinstallprompt` / `appinstalled`).
 * The only signal we get on the NEXT visit is the `display-mode: standalone`
 * media query. The runner mounts at the root layout and fires the
 * `recordA2hsAccepted` mutation once on the first visit where standalone is
 * true AND `a2hsStatus` is not yet `"enrolled"`.
 *
 * The decision also covers the Android safety net case (US 59) — a user who
 * installed via the browser menu, closed the tab before the `appinstalled`
 * window event was caught by `<PWAInstallProvider>`, and reopens later in
 * standalone. In that rare race, this runner is the only path that flips the
 * backend signal. We therefore do NOT iOS-only gate the decision; the mount
 * site (root layout) is the surface where the heuristic catches every
 * standalone session it can.
 *
 * The backend mutation IS idempotent (it re-writes `"enrolled"` + a second
 * audit row on re-fire — same shape as #462), but the heuristic decision
 * here avoids the redundant round-trip + audit noise on every page load
 * AFTER the first flip. The runner is the single fire-once-per-fiche guard.
 */

import type { PushChannelStatus } from "./decide-ios-bottom-sheet-visibility";

export type DecideIosStandaloneHeuristicInput = {
  /**
   * `true` when the PWA is running in installed standalone mode
   * (`window.matchMedia('(display-mode: standalone)').matches`).
   */
  isStandalone: boolean;
  /**
   * The live `a2hsStatus` from the customer's `pushEnrollment` (Convex sub
   * on `getCurrentCustomer`). Same treatment as #462 / the sibling decision:
   * `undefined` / `"not_enrolled"` / `"revoked"` all mean « not yet
   * enrolled, fire the flip »; only the explicit `"enrolled"` literal
   * vetoes the mutation.
   */
  a2hsStatus: PushChannelStatus | undefined;
};

export type IosStandaloneHeuristicDecision =
  | { kind: "flip" }
  | { kind: "noop"; reason: "not-standalone" | "already-enrolled" };

/**
 * Decide whether to fire the `recordA2hsAccepted` mutation on this visit.
 *
 * Precedence (strongest negative signal first):
 *  1. `!isStandalone` — we're in a regular browser tab; there's nothing to
 *     attribute (and the standalone media query is the SOLE iOS install
 *     proxy — without it we'd be guessing).
 *  2. `a2hsStatus === "enrolled"` — already flipped; save the round-trip.
 *  3. Otherwise → flip.
 */
export function decideIosStandaloneHeuristic(
  input: DecideIosStandaloneHeuristicInput,
): IosStandaloneHeuristicDecision {
  if (!input.isStandalone) {
    return { kind: "noop", reason: "not-standalone" };
  }
  if (input.a2hsStatus === "enrolled") {
    return { kind: "noop", reason: "already-enrolled" };
  }
  return { kind: "flip" };
}
