/**
 * F-PIPELINE-CRM 06 (#262) — `decideKanbanDnDEnd` pure orchestration pinned.
 *
 * The DnD shell receives a `DragEndEvent` from `@dnd-kit/core`. The handler
 * extracts:
 *   - `active.id` = the dragged prospect id
 *   - `over?.id`  = the droppable target (a Kanban column id, encoded as
 *     `column:<phase>`) — or `null` when the drop landed outside any
 *     registered droppable.
 *
 * This pure helper takes those plus a prospect lookup + a gate-evaluator and
 * decides what the shell should do:
 *
 *   - { kind: "ignore" }        — drop outside any column, or unknown prospect
 *   - { kind: "noop" }          — drop on the prospect's own column
 *   - { kind: "commit", phase } — clean forward / backward — fire the
 *                                  mutation directly
 *   - { kind: "confirm",        — bypass — open the dialog with the missing
 *       phase, missing }         list; on confirm the shell fires the mutation
 *
 * This composes `decidePhaseMove` (#217 pure decision) with the front gate
 * mirror (`missingMilestonesForPhase`) so the whole DnD policy is testable
 * in vitest's `node` env — the React shell (`useKanbanDnd`) only wires
 * `dnd-kit` events + a `useState` + a `useMutation` on top.
 */
import { describe, expect, it } from "vitest";

import { decideKanbanDnDEnd } from "./decideKanbanDnDEnd";
import type { ProspectGateSnapshot } from "./missingMilestonesForPhase";
import type { Phase } from "./prospectPhaseMover";

type Prospect = ProspectGateSnapshot & { _id: string; phase: Phase };

function mk(
  id: string,
  phase: Phase,
  overrides: Partial<Prospect> = {},
): Prospect {
  return {
    _id: id,
    phase,
    milestones: undefined,
    tabletteMode: undefined,
    ...overrides,
  };
}

describe("decideKanbanDnDEnd — pure DnD orchestration (#262)", () => {
  it("ignore — over is null (drop outside any column)", () => {
    const res = decideKanbanDnDEnd({
      activeId: "p1",
      overId: null,
      prospects: [mk("p1", "acquisition")],
    });
    expect(res).toEqual({ kind: "ignore" });
  });

  it("ignore — overId is not a column droppable id", () => {
    const res = decideKanbanDnDEnd({
      activeId: "p1",
      overId: "garbage",
      prospects: [mk("p1", "acquisition")],
    });
    expect(res).toEqual({ kind: "ignore" });
  });

  it("ignore — prospect not found in the snapshot (race against subscription)", () => {
    const res = decideKanbanDnDEnd({
      activeId: "missing",
      overId: "column:preparation",
      prospects: [mk("p1", "acquisition")],
    });
    expect(res).toEqual({ kind: "ignore" });
  });

  it("noop — drop on the prospect's own column", () => {
    const res = decideKanbanDnDEnd({
      activeId: "p1",
      overId: "column:acquisition",
      prospects: [mk("p1", "acquisition")],
    });
    expect(res).toEqual({ kind: "noop" });
  });

  it("commit backward — Installation → Préparation (gates ignored, drag is free)", () => {
    const res = decideKanbanDnDEnd({
      activeId: "p1",
      overId: "column:preparation",
      prospects: [mk("p1", "installation")],
    });
    expect(res).toEqual({ kind: "commit", phase: "preparation" });
  });

  it("commit clean — forward, all milestones present (Acquisition → Préparation, appareil_existant)", () => {
    const p = mk("p1", "acquisition", {
      tabletteMode: "appareil_existant",
      milestones: {
        contratSigne: 1,
        kbisRecu: 2,
        pieceIdentiteRecue: 3,
        ribRecu: 4,
      },
    });
    const res = decideKanbanDnDEnd({
      activeId: "p1",
      overId: "column:preparation",
      prospects: [p],
    });
    expect(res).toEqual({ kind: "commit", phase: "preparation" });
  });

  it("confirm bypass — forward with missing milestones (Acquisition → Préparation, achat_kb)", () => {
    const p = mk("p1", "acquisition", {
      tabletteMode: "achat_kb",
      milestones: {
        contratSigne: 1,
        kbisRecu: 2,
        pieceIdentiteRecue: 3,
        ribRecu: 4,
        // factureTablettePayee missing → bypass
      },
    });
    const res = decideKanbanDnDEnd({
      activeId: "p1",
      overId: "column:preparation",
      prospects: [p],
    });
    expect(res).toEqual({
      kind: "confirm",
      phase: "preparation",
      missing: ["factureTablettePayee"],
    });
  });

  it("confirm bypass — multi-hop forward (Acquisition → Installation, no milestones)", () => {
    const res = decideKanbanDnDEnd({
      activeId: "p1",
      overId: "column:installation",
      prospects: [mk("p1", "acquisition")],
    });
    // Installation gate = menuImporte + photosEmballagesRecues.
    expect(res.kind).toBe("confirm");
    if (res.kind === "confirm") {
      expect(res.phase).toBe("installation");
      expect(res.missing.sort()).toEqual(
        ["menuImporte", "photosEmballagesRecues"].sort(),
      );
    }
  });
});
