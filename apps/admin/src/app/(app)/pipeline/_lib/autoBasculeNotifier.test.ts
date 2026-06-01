/**
 * F-PIPELINE-CRM 06 (#262) — `detectAutoBascule` pure decision pinned.
 *
 * Pure helper consumed by the `useAutoBasculeToast` hook (a `useEffect`
 * comparing the previous and current `listProspects` snapshots). When the
 * backend auto-bascules a prospect Acquisition → Préparation (because the
 * last Closing milestone got ticked on the fiche, B-ONBOARDING-MILESTONES
 * `maybeAutoBascule`), the Convex subscription delivers a new snapshot to the
 * Kanban — this helper compares prev vs curr to spot the (prospectId, phase)
 * pairs that just changed, so the shell can fire one toast per bascule.
 *
 * Why a pure helper (not a `useRef` inside the hook)
 * --------------------------------------------------
 * Same discipline as `decidePhaseMove` / `buildMilestoneChecklist`: the
 * decision is testable in vitest's `node` env. The hook is a 3-line
 * `useEffect` wrapper. Pure ⇒ pinned ⇒ stable.
 *
 * Decision matrix:
 *   - prev undefined        → no toasts (initial mount — Convex hasn't
 *                             delivered a comparable snapshot yet)
 *   - prospect missing prev → no toast (newly visible, not a transition)
 *   - same phase prev/curr  → no toast
 *   - different phase       → emit `{prospectId, name, fromPhase, toPhase}`
 *
 * The CALLER (the hook / shell) decides whether each transition deserves a
 * toast — typically only the auto-bascule edge `acquisition → preparation`,
 * skipping the operator's own manual drags (the dialog flow surfaces its
 * own confirmation toast, decoupled from the snapshot diff).
 */
import { describe, expect, it } from "vitest";

import {
  type PhaseTransition,
  type ProspectPhaseSnapshot,
  detectAutoBascule,
} from "./autoBasculeNotifier";

function mk(
  id: string,
  phase: ProspectPhaseSnapshot["phase"],
  name = `R-${id}`,
): ProspectPhaseSnapshot {
  return { _id: id, phase, name };
}

describe("detectAutoBascule — pure phase-transition diff (#262)", () => {
  it("returns [] when prev is undefined (initial mount, no comparable baseline)", () => {
    const curr = [mk("p1", "acquisition")];
    expect(detectAutoBascule(undefined, curr)).toEqual([]);
  });

  it("returns [] when curr is undefined (still loading)", () => {
    const prev = [mk("p1", "acquisition")];
    expect(detectAutoBascule(prev, undefined)).toEqual([]);
  });

  it("returns [] when phases are identical", () => {
    const prev = [mk("p1", "acquisition"), mk("p2", "preparation")];
    const curr = [mk("p1", "acquisition"), mk("p2", "preparation")];
    expect(detectAutoBascule(prev, curr)).toEqual([]);
  });

  it("returns one transition when a prospect basculed acquisition → preparation", () => {
    const prev = [mk("p1", "acquisition", "Pizza Roma")];
    const curr = [mk("p1", "preparation", "Pizza Roma")];

    const transitions = detectAutoBascule(prev, curr);
    expect(transitions).toEqual<PhaseTransition[]>([
      {
        prospectId: "p1",
        name: "Pizza Roma",
        fromPhase: "acquisition",
        toPhase: "preparation",
      },
    ]);
  });

  it("returns one transition per prospect that changed phase (multi-bascule)", () => {
    const prev = [
      mk("p1", "acquisition", "Pizza Roma"),
      mk("p2", "acquisition", "Sushi Bar"),
      mk("p3", "preparation", "Tacos King"),
    ];
    const curr = [
      mk("p1", "preparation", "Pizza Roma"),
      mk("p2", "preparation", "Sushi Bar"),
      mk("p3", "installation", "Tacos King"),
    ];

    const transitions = detectAutoBascule(prev, curr);
    expect(transitions).toHaveLength(3);
    expect(transitions.find((t) => t.prospectId === "p1")?.toPhase).toBe(
      "preparation",
    );
    expect(transitions.find((t) => t.prospectId === "p3")?.toPhase).toBe(
      "installation",
    );
  });

  it("ignores prospects newly visible in curr (no prev entry → not a transition)", () => {
    const prev = [mk("p1", "acquisition")];
    const curr = [mk("p1", "acquisition"), mk("p2", "preparation")];

    expect(detectAutoBascule(prev, curr)).toEqual([]);
  });

  it("ignores prospects disappeared from curr (no curr entry → no transition)", () => {
    const prev = [mk("p1", "acquisition"), mk("p2", "preparation")];
    const curr = [mk("p1", "acquisition")];

    expect(detectAutoBascule(prev, curr)).toEqual([]);
  });

  it("handles backward transitions too (operator un-bascule via fiche / DnD)", () => {
    const prev = [mk("p1", "preparation", "Pizza Roma")];
    const curr = [mk("p1", "acquisition", "Pizza Roma")];

    expect(detectAutoBascule(prev, curr)).toEqual<PhaseTransition[]>([
      {
        prospectId: "p1",
        name: "Pizza Roma",
        fromPhase: "preparation",
        toPhase: "acquisition",
      },
    ]);
  });
});
