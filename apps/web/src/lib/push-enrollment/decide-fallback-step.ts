/**
 * PWA-S6c (#457) — `decideFallbackStep` — pure state machine for the
 * 3-level frictional « Continuer sans notifs » fallback chain
 * (decisions-log Q8 (5) + CONTEXT customer-data « Push enrollment »).
 *
 * Five visible steps (cf. issue body verbatim):
 *
 *   1. `hidden`       — link not surfaced. Default state until 2 documented
 *                       channel failures have happened (Wallet refused /
 *                       timed-out + Web Push denied).
 *   2. `link-visible` — the micro link `« Continuer sans notifs → »` is
 *                       rendered at the bottom of the choice screen (12px,
 *                       muted color — issue acceptance « Lien fallback caché
 *                       avant 2 échecs »).
 *   3. `confirm-l2`   — level-2 confirm modal (« Sans notifs : AUCUNE
 *                       confirmation, AUCUN suivi, AUCUNE offre. Sûr ? »).
 *   4. `confirm-l3`   — level-3 FINAL modal that re-displays the choice
 *                       options ONE LAST TIME (« On a vraiment besoin… »).
 *   5. `flagged`      — TERMINAL: re-refused on level-3 → the parent fires
 *                       `customer.pushEnrollment.markNoChannelPossible` and
 *                       the modal closes via the Convex sub (which unlocks
 *                       the Payer gate).
 *
 * Transitions (every (state, event) pair NOT listed is a no-op — robust to
 * double-clicks / late events):
 *
 *   hidden       -- FailureCountReached(>=THRESHOLD) --> link-visible
 *   link-visible -- ClickFallbackLink                --> confirm-l2
 *   confirm-l2   -- ClickContinueWithout             --> confirm-l3
 *   confirm-l2   -- ClickIWantNotifsAfterAll         --> link-visible (back)
 *   confirm-l3   -- ClickContinueWithout             --> flagged (TERMINAL)
 *   confirm-l3   -- ClickIWantNotifsAfterAll         --> link-visible (back)
 *
 * The threshold lives here as a constant — keeps the state machine free of
 * counter semantics, the parent component is the source of truth for
 * « failure count » (Wallet abort + Web Push denied — counted by
 * `decideWebPushBranch.failureCount` + the Wallet-loader « J'ai changé
 * d'avis » bump). The reducer just reacts to the « 2 strikes » signal.
 */

/** Number of documented channel failures before the fallback link surfaces. */
export const FALLBACK_FAILURE_THRESHOLD = 2;

/** The visible step of the 3-level fallback chain. */
export type FallbackStep =
  | { kind: "hidden" }
  | { kind: "link-visible" }
  | { kind: "confirm-l2" }
  | { kind: "confirm-l3" }
  | { kind: "flagged" };

/**
 * Events the fallback reducer accepts:
 *  - `FailureCountReached { count }` : the parent recomputed a non-strict
 *    failure count (Wallet aborts + Web Push refusals). The reducer surfaces
 *    the link iff `count >= FALLBACK_FAILURE_THRESHOLD` AND the step is
 *    still `hidden` — once visible / past visibility, the count is ignored.
 *  - `ClickFallbackLink`            : user clicked the micro 12px link.
 *  - `ClickContinueWithout`         : user clicked the discreet « Oui
 *    continue sans » link on the l2 / l3 modal.
 *  - `ClickIWantNotifsAfterAll`     : user clicked the PRIMARY button on
 *    the l2 / l3 modal — symmetrical to `ClickChangeOfMind` on the Wallet
 *    loader, returns the user to the choice screen.
 *
 * Open union — kept extensible in case S6c grows a « 4th level » or an
 * « install A2HS instead » short-circuit. The `kind` discriminant keeps
 * existing callers exhaustive.
 */
export type FallbackEvent =
  | { kind: "FailureCountReached"; count: number }
  | { kind: "ClickFallbackLink" }
  | { kind: "ClickContinueWithout" }
  | { kind: "ClickIWantNotifsAfterAll" };

export function decideFallbackStep(
  current: FallbackStep,
  event: FallbackEvent,
): FallbackStep {
  switch (current.kind) {
    case "hidden": {
      if (
        event.kind === "FailureCountReached" &&
        event.count >= FALLBACK_FAILURE_THRESHOLD
      ) {
        return { kind: "link-visible" };
      }
      return current;
    }
    case "link-visible": {
      if (event.kind === "ClickFallbackLink") {
        return { kind: "confirm-l2" };
      }
      return current;
    }
    case "confirm-l2": {
      if (event.kind === "ClickContinueWithout") {
        return { kind: "confirm-l3" };
      }
      if (event.kind === "ClickIWantNotifsAfterAll") {
        return { kind: "link-visible" };
      }
      return current;
    }
    case "confirm-l3": {
      if (event.kind === "ClickContinueWithout") {
        return { kind: "flagged" };
      }
      if (event.kind === "ClickIWantNotifsAfterAll") {
        return { kind: "link-visible" };
      }
      return current;
    }
    case "flagged": {
      // Terminal — the parent fires the mutation, the Convex sub flips the
      // gate, the modal unmounts. Any further event here is a no-op.
      return current;
    }
    default: {
      const _exhaustive: never = current;
      return _exhaustive;
    }
  }
}
