/**
 * F-PIPELINE-CRM 02 (#217) — `decidePhaseMove`, the pure module that classifies
 * a Kanban drag between prospect phases.
 *
 * Pinned at the source-file level (same split discipline as
 * `decideProspectFiche` / `decideProvisionLauncher` / `decideGenerateContract`):
 * the React shell (later — `KanbanColumn` drag handler) is a thin adapter that
 * runs this decision and dispatches the right UX (clean: silent + mutation ;
 * bypass: confirm-dialog listing `missing` ; backward: silent + mutation ;
 * noop: ignore). No DOM, no Convex, no router — pure function tested in vitest
 * `node` env.
 *
 * Decision matrix (issue #217 acceptance criteria + EPIC F-PIPELINE-CRM
 * "Drag UX décidé" 2026-05-27):
 *
 *   - `noop`     — same phase as current (drop on own column)
 *   - `backward` — target phase EARLIER in the pipeline order (correction —
 *                  gates ignored, drag is FREE per epic decision « libre en
 *                  arrière, correction sans warning »)
 *   - `clean`    — target phase LATER, every required milestone present
 *                  (`missingMilestonesForTarget` is empty)
 *   - `bypass`   — target phase LATER, at least one required milestone missing
 *                  (the React shell opens a confirm-dialog listing
 *                  `missing` — the operator assumes the shortcut)
 *
 * `missingMilestonesForTarget` is COMPUTED UPSTREAM (backend
 * `gates.missingMilestonesForPhase` exposed as a query, or its front mirror —
 * decision deferred to a later story per epic Implementation Decisions
 * "Branchement Convex attendu"). This module does NOT recompute the gate —
 * trusting the caller keeps the decision pure and the gate single-source-of-truth.
 *
 * Why duplicate `PHASE_ORDER` front-side
 * --------------------------------------
 * Same justification as `decideProvisionLauncher`: the epic scope is
 * `apps/admin/src/app/(app)/pipeline/` STRICT — no touch to
 * `packages/backend/convex/`. The canonical order lives in
 * `packages/backend/convex/lib/onboarding/pipeline.ts` (`PHASE_ORDER`). A
 * future slice may lift the shared array into a cross-package module
 * (`packages/shared/`) — doing it here would expand scope unnecessarily for
 * a 4-element constant.
 */

/**
 * The 4 pipeline phases — mirror of `prospectPhase` validator in
 * `packages/backend/convex/table/prospects.ts` (kb-admin CONTEXT "Phase
 * pipeline", acté 2026-05-23).
 */
export type Phase =
  | "acquisition"
  | "preparation"
  | "installation"
  | "operationnel";

/**
 * Canonical pipeline order. Index defines "forward" vs "backward".
 * Mirror of `PHASE_ORDER` in `convex/lib/onboarding/pipeline.ts`.
 */
const PHASE_ORDER: readonly Phase[] = [
  "acquisition",
  "preparation",
  "installation",
  "operationnel",
];

export type PhaseMoveDecision =
  /** Forward, every required milestone present — drag commits silently. */
  | { kind: "clean" }
  /**
   * Forward, milestones missing — caller opens a confirm-dialog listing
   * `missing` so the operator can assume the shortcut (bypass loggé en audit
   * côté backend, cf. epic User Story 3).
   */
  | { kind: "bypass"; missing: string[] }
  /**
   * Backward (correction) — drag commits silently, milestones ignored
   * (epic décision « libre en arrière, correction sans warning »).
   */
  | { kind: "backward" }
  /** Same phase (drop on own column) — caller ignores. */
  | { kind: "noop" };

export type DecidePhaseMoveInput = {
  currentPhase: Phase;
  targetPhase: Phase;
  /**
   * Required milestones for `targetPhase` that the prospect has NOT yet
   * achieved. Computed upstream (backend `gates.missingMilestonesForPhase`
   * or its front mirror). Empty list ⇒ no gate to bypass.
   *
   * Only consulted when the move is FORWARD — `backward` and `noop`
   * ignore it.
   */
  missingMilestonesForTarget: string[];
};

export function decidePhaseMove(
  input: DecidePhaseMoveInput,
): PhaseMoveDecision {
  const { currentPhase, targetPhase, missingMilestonesForTarget } = input;

  if (currentPhase === targetPhase) {
    return { kind: "noop" };
  }

  const fromIdx = PHASE_ORDER.indexOf(currentPhase);
  const toIdx = PHASE_ORDER.indexOf(targetPhase);

  if (toIdx < fromIdx) {
    return { kind: "backward" };
  }

  // Forward — gate check decides clean vs bypass.
  if (missingMilestonesForTarget.length === 0) {
    return { kind: "clean" };
  }
  return { kind: "bypass", missing: missingMilestonesForTarget };
}
