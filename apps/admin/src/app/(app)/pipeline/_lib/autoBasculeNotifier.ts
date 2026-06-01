/**
 * F-PIPELINE-CRM 06 (#262) — `detectAutoBascule`, the pure phase-transition
 * diff consumed by `useAutoBasculeToast`.
 *
 * The Convex `listProspects` query is reactive (subscription) — when the
 * backend `maybeAutoBascule` flips a prospect Acquisition → Préparation in
 * response to a milestone tick (B-ONBOARDING-MILESTONES `setMilestone`), the
 * Kanban receives a new snapshot. This pure helper compares the previous and
 * current snapshots and returns the prospects whose `phase` changed.
 *
 * Caller responsibility (the hook / shell): decide which transitions deserve
 * a toast. The Kanban issue (#262 « toast bascule auto Closing ») cares about
 * the `acquisition → preparation` edge specifically, but the helper is kept
 * generic — same diff logic also surfaces hypothetical future auto-bascules
 * without re-coding.
 *
 * NOT covered here:
 *  - de-duplication across re-renders (the caller stores prev in a `useRef`)
 *  - whether the toast was already shown (no — every distinct snapshot
 *    transition is reported; the caller squashes if needed)
 *  - mutation-origin (operator-initiated DnD vs backend auto): the snapshot
 *    diff has no way to tell. Both surface; the caller's policy decides.
 */
import type { Phase } from "./prospectPhaseMover";

/**
 * Narrow snapshot — `Doc<"prospects">` is structurally assignable to it.
 * Same discipline as `ProspectCardSnapshot` (we type only what we read).
 */
export type ProspectPhaseSnapshot = {
  _id: string;
  name: string;
  phase: Phase;
};

/** A prospect whose `phase` changed between two `listProspects` snapshots. */
export type PhaseTransition = {
  prospectId: string;
  name: string;
  fromPhase: Phase;
  toPhase: Phase;
};

/**
 * Compare the previous and current `listProspects` snapshots and return the
 * prospects whose `phase` changed. Pure: same inputs ⇒ same output.
 *
 * Returns `[]` for any partial state (either snapshot undefined) — the caller
 * cannot decide a transition without both ends.
 */
export function detectAutoBascule(
  prev: ReadonlyArray<ProspectPhaseSnapshot> | undefined,
  curr: ReadonlyArray<ProspectPhaseSnapshot> | undefined,
): PhaseTransition[] {
  if (prev === undefined || curr === undefined) return [];
  const prevById = new Map(prev.map((p) => [p._id, p]));
  const transitions: PhaseTransition[] = [];
  for (const c of curr) {
    const p = prevById.get(c._id);
    if (p === undefined) continue;
    if (p.phase === c.phase) continue;
    transitions.push({
      prospectId: c._id,
      name: c.name,
      fromPhase: p.phase,
      toPhase: c.phase,
    });
  }
  return transitions;
}
