/**
 * PWA-S6c (#457) — `decideFallbackStep` — pure state machine for the
 * 3-level frictional « Continuer sans notifs » fallback (decisions-log Q8 (5)
 * + CONTEXT customer-data « Push enrollment » + issue #457 acceptance).
 *
 * The fallback link is the user's escape hatch when BOTH Wallet AND Web Push
 * channels failed. The 4 steps below are documented verbatim in the issue:
 *
 *   1. `hidden`       — link is not surfaced (the modal shows the 2 channel
 *                       options only). Default state until 2 documented
 *                       failures have happened.
 *   2. `link-visible` — the micro 12px muted link `« Continuer sans notifs → »`
 *                       appears at the BOTTOM of the choice screen.
 *   3. `confirm-l2`   — clicking the link opens the level-2 confirm modal
 *                       (« Sans notifs : AUCUNE confirmation, AUCUN suivi,
 *                       AUCUNE offre. Sûr ? »).
 *   4. `confirm-l3`   — clicking « Oui continue sans » opens the level-3 final
 *                       modal (« On a vraiment besoin… choisis encore »). The
 *                       modal re-displays the choice screen options ONE LAST
 *                       TIME (re-render is in the UI, not in this reducer).
 *   5. `flagged`      — terminal: the user re-refused on level-3, the
 *                       `markNoChannelPossible` mutation fired, the parent
 *                       `<PushEnrollmentModal>` closes via the Convex sub on
 *                       `noChannelPossible` (which flips the gate to active).
 *
 * Transitions (NB: « back to choice / I want notifs after all » is modelled
 * as the SAME event so the UI button label and the in-state arrows match):
 *   hidden       -- FailureCountReached(2)  --> link-visible
 *   link-visible -- ClickFallbackLink       --> confirm-l2
 *   confirm-l2   -- ClickIWantNotifsAfterAll--> link-visible (back to choice)
 *   confirm-l2   -- ClickContinueWithout    --> confirm-l3
 *   confirm-l3   -- ClickIWantNotifsAfterAll--> link-visible (back to choice)
 *   confirm-l3   -- ClickContinueWithout    --> flagged (terminal)
 *
 * `FailureCountReached(n)` is fed from the OUTSIDE (the parent modal counts
 * Wallet refusals + Web Push refusals + denied permissions). The threshold is
 * a CONSTANT here so the state machine never has to know counter semantics —
 * it just reacts to the « 2 strikes » signal.
 *
 * Every (state, event) pair NOT in the transition table is a no-op — the
 * reducer silently swallows stray events (double-clicks, late events after
 * the user transitioned, etc.).
 */
import { describe, expect, it } from "vitest";
import {
  type FallbackEvent,
  type FallbackStep,
  decideFallbackStep,
} from "./decide-fallback-step";

const HIDDEN: FallbackStep = { kind: "hidden" };
const LINK_VISIBLE: FallbackStep = { kind: "link-visible" };
const CONFIRM_L2: FallbackStep = { kind: "confirm-l2" };
const CONFIRM_L3: FallbackStep = { kind: "confirm-l3" };
const FLAGGED: FallbackStep = { kind: "flagged" };

describe("decideFallbackStep — hidden → link-visible only after 2 failures", () => {
  it("stays hidden on FailureCountReached(0)", () => {
    expect(
      decideFallbackStep(HIDDEN, { kind: "FailureCountReached", count: 0 }),
    ).toEqual(HIDDEN);
  });

  it("stays hidden on FailureCountReached(1)", () => {
    expect(
      decideFallbackStep(HIDDEN, { kind: "FailureCountReached", count: 1 }),
    ).toEqual(HIDDEN);
  });

  it("flips to link-visible on FailureCountReached(2)", () => {
    expect(
      decideFallbackStep(HIDDEN, { kind: "FailureCountReached", count: 2 }),
    ).toEqual(LINK_VISIBLE);
  });

  it("flips to link-visible on FailureCountReached(>=2) — guards against a counter that jumps", () => {
    // The parent sums Wallet failure + Web Push failure independently; a
    // double-failure event could surface a count of 3 directly.
    expect(
      decideFallbackStep(HIDDEN, { kind: "FailureCountReached", count: 3 }),
    ).toEqual(LINK_VISIBLE);
  });

  it("ignores click events from hidden — the link is not interactable yet", () => {
    expect(decideFallbackStep(HIDDEN, { kind: "ClickFallbackLink" })).toEqual(
      HIDDEN,
    );
    expect(
      decideFallbackStep(HIDDEN, { kind: "ClickContinueWithout" }),
    ).toEqual(HIDDEN);
    expect(
      decideFallbackStep(HIDDEN, { kind: "ClickIWantNotifsAfterAll" }),
    ).toEqual(HIDDEN);
  });
});

describe("decideFallbackStep — link-visible → confirm-l2 on click", () => {
  it("flips to confirm-l2 on ClickFallbackLink", () => {
    expect(
      decideFallbackStep(LINK_VISIBLE, { kind: "ClickFallbackLink" }),
    ).toEqual(CONFIRM_L2);
  });

  it("stays link-visible on a later FailureCountReached (already past the threshold)", () => {
    expect(
      decideFallbackStep(LINK_VISIBLE, {
        kind: "FailureCountReached",
        count: 5,
      }),
    ).toEqual(LINK_VISIBLE);
  });

  it("ignores confirm-screen click events from link-visible", () => {
    expect(
      decideFallbackStep(LINK_VISIBLE, { kind: "ClickContinueWithout" }),
    ).toEqual(LINK_VISIBLE);
    expect(
      decideFallbackStep(LINK_VISIBLE, { kind: "ClickIWantNotifsAfterAll" }),
    ).toEqual(LINK_VISIBLE);
  });
});

describe("decideFallbackStep — confirm-l2 has 2 exits (l3 vs back)", () => {
  it("flips to confirm-l3 on ClickContinueWithout", () => {
    expect(
      decideFallbackStep(CONFIRM_L2, { kind: "ClickContinueWithout" }),
    ).toEqual(CONFIRM_L3);
  });

  it("returns to link-visible on ClickIWantNotifsAfterAll (back to choice)", () => {
    // The primary button on the l2 modal — symmetric to ClickChangeOfMind on
    // wallet-loading. The choice screen + the link reappear; the user can
    // retry a channel or re-click the link.
    expect(
      decideFallbackStep(CONFIRM_L2, { kind: "ClickIWantNotifsAfterAll" }),
    ).toEqual(LINK_VISIBLE);
  });

  it("ignores the fallback link click event from confirm-l2 (already open)", () => {
    expect(
      decideFallbackStep(CONFIRM_L2, { kind: "ClickFallbackLink" }),
    ).toEqual(CONFIRM_L2);
  });
});

describe("decideFallbackStep — confirm-l3 is the terminal-or-back gate", () => {
  it("flips to flagged on the FINAL ClickContinueWithout (terminal)", () => {
    expect(
      decideFallbackStep(CONFIRM_L3, { kind: "ClickContinueWithout" }),
    ).toEqual(FLAGGED);
  });

  it("returns to link-visible on ClickIWantNotifsAfterAll (re-display the choice options ONE LAST TIME)", () => {
    expect(
      decideFallbackStep(CONFIRM_L3, { kind: "ClickIWantNotifsAfterAll" }),
    ).toEqual(LINK_VISIBLE);
  });
});

describe("decideFallbackStep — flagged is terminal", () => {
  it("never transitions out of flagged on any event (the parent unmounts)", () => {
    for (const event of [
      { kind: "ClickFallbackLink" } as const,
      { kind: "ClickContinueWithout" } as const,
      { kind: "ClickIWantNotifsAfterAll" } as const,
      { kind: "FailureCountReached", count: 99 } as const,
    ] satisfies FallbackEvent[]) {
      expect(decideFallbackStep(FLAGGED, event)).toEqual(FLAGGED);
    }
  });
});

describe("decideFallbackStep — pure / referential transparency", () => {
  it("never mutates the input step (pure function)", () => {
    const frozen = Object.freeze({ ...LINK_VISIBLE });
    expect(() =>
      decideFallbackStep(frozen, { kind: "ClickFallbackLink" }),
    ).not.toThrow();
  });

  it("returns the same result for the same (state, event) pair (no hidden state)", () => {
    const a = decideFallbackStep(HIDDEN, {
      kind: "FailureCountReached",
      count: 2,
    });
    const b = decideFallbackStep(HIDDEN, {
      kind: "FailureCountReached",
      count: 2,
    });
    expect(a).toEqual(b);
  });
});
