/**
 * F-PIPELINE-CRM 06 (#262) — `decideKanbanDnDEnd`, the pure DnD orchestration.
 *
 * Composes the two pure decisions of the epic (`decidePhaseMove` from #217 +
 * `missingMilestonesForPhase` mirror from #262) into ONE decision the React
 * shell calls in its `onDragEnd` handler. Returns a tagged action telling the
 * shell exactly what to do:
 *
 *   - `ignore`  — invalid drop (off-canvas / unknown prospect / unknown droppable)
 *   - `noop`    — drop on the prospect's own column
 *   - `commit`  — clean forward or backward; fire the mutation directly
 *   - `confirm` — bypass; open the dialog with the `missing` list
 *
 * Pure ⇒ pinned ⇒ stable. The shell wires `@dnd-kit/core` events + the
 * `useState` for the dialog + the `useMutation` on top.
 *
 * Droppable id encoding
 * ---------------------
 * The Kanban registers ONE droppable per column, with id `column:<phase>`.
 * Encoding the phase in the id (instead of stashing it in `over.data`) keeps
 * the decision pure-string-typed and the React shell shallow.
 */

import {
  type Phase,
  type PhaseMoveDecision,
  decidePhaseMove,
} from "./prospectPhaseMover";
import {
  type ProspectGateSnapshot,
  missingMilestonesForPhase,
} from "./missingMilestonesForPhase";

/** Prefix encoding the column droppable id (e.g. `column:preparation`). */
const COLUMN_PREFIX = "column:";

/** Build the droppable id for a column. Used by both `KanbanColumn` and tests. */
export function columnDroppableId(phase: Phase): string {
  return `${COLUMN_PREFIX}${phase}`;
}

/** Inverse of `columnDroppableId`. Returns null when the id is not a column. */
export function parseColumnDroppableId(id: string): Phase | null {
  if (!id.startsWith(COLUMN_PREFIX)) return null;
  const candidate = id.slice(COLUMN_PREFIX.length);
  if (
    candidate === "acquisition" ||
    candidate === "preparation" ||
    candidate === "installation" ||
    candidate === "operationnel"
  ) {
    return candidate;
  }
  return null;
}

/** The minimal prospect snapshot the decision needs. */
export type DnDProspectSnapshot = ProspectGateSnapshot & {
  _id: string;
  phase: Phase;
};

/** Input to `decideKanbanDnDEnd` — pulled out of the `DragEndEvent` by the shell. */
export type DecideKanbanDnDEndInput = {
  /** `event.active.id` — the dragged prospect id. */
  activeId: string;
  /** `event.over?.id ?? null` — the droppable target. */
  overId: string | null;
  /** Current `listProspects` snapshot — looked up to read phase + gates. */
  prospects: ReadonlyArray<DnDProspectSnapshot>;
};

export type KanbanDnDAction =
  | { kind: "ignore" }
  | { kind: "noop" }
  | { kind: "commit"; phase: Phase }
  | { kind: "confirm"; phase: Phase; missing: string[] };

export function decideKanbanDnDEnd(
  input: DecideKanbanDnDEndInput,
): KanbanDnDAction {
  const { activeId, overId, prospects } = input;

  if (overId === null) return { kind: "ignore" };
  const targetPhase = parseColumnDroppableId(overId);
  if (targetPhase === null) return { kind: "ignore" };

  const prospect = prospects.find((p) => p._id === activeId);
  if (prospect === undefined) return { kind: "ignore" };

  const missing = missingMilestonesForPhase(prospect, targetPhase);
  const decision: PhaseMoveDecision = decidePhaseMove({
    currentPhase: prospect.phase,
    targetPhase,
    missingMilestonesForTarget: missing,
  });

  switch (decision.kind) {
    case "noop":
      return { kind: "noop" };
    case "backward":
    case "clean":
      return { kind: "commit", phase: targetPhase };
    case "bypass":
      return { kind: "confirm", phase: targetPhase, missing: decision.missing };
  }
}
