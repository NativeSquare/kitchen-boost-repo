import { describe, expect, it } from "vitest";
import {
  decideTapAction,
  revealableFieldReducer,
} from "./decide-revealable-field";

/**
 * Pure state machine tests for `<RevealableField />` (PRD 20 §4 — adresse +
 * téléphone tap-to-reveal, ADR 0010 MOAT). Same vitest convention as
 * `decideWorkflowButton` / `decideRefuseFlow` — no React, no Convex, no Expo.
 */

describe("revealableFieldReducer — only `hidden → revealed` edge", () => {
  it("flips hidden → revealed on a tap", () => {
    expect(revealableFieldReducer("hidden", { type: "tap" })).toBe("revealed");
  });

  it("stays revealed on a subsequent tap (no toggle-back)", () => {
    // The second tap on a revealed field is a no-op state-wise — the action
    // firing is handled by `decideTapAction`, not the reducer. The cuisinier
    // never accidentally re-hides PII (would require a deliberate « cacher »
    // CTA, out of scope).
    expect(revealableFieldReducer("revealed", { type: "tap" })).toBe(
      "revealed",
    );
  });
});

describe("decideTapAction — what should the NEXT tap do?", () => {
  it("hidden + no action wired → reveal (the field surfaces the value)", () => {
    expect(decideTapAction("hidden", false)).toBe("reveal");
  });

  it("hidden + action wired → reveal (first tap always reveals, never skips to fire)", () => {
    // E.g. téléphone: first tap reveals, only the SECOND fires `tel:`. This
    // prevents an accidental dial on an unread number — PRD 20 §4 + AC9
    // (« 2 taps : la PII reste protégée d'un mauvais geste »).
    expect(decideTapAction("hidden", true)).toBe("reveal");
  });

  it("revealed + action wired → fire-action (tap-to-call sur téléphone)", () => {
    expect(decideTapAction("revealed", true)).toBe("fire-action");
  });

  it("revealed + no action wired → none (adresse : no Maps launch sur tap)", () => {
    // Address case: once revealed, a second tap does nothing. PRD 20 §4 / Q4.2
    // — pas de dialer fiable, pas de Maps launch automatique. The address card
    // stays consultatif après reveal.
    expect(decideTapAction("revealed", false)).toBe("none");
  });
});
