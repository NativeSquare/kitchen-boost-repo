/**
 * F-PIPELINE-CRM 05 (#255) — `KanbanColumn` test matrix.
 *
 * Static column shell rendered 3 times on `/pipeline` (one per phase :
 * Acquisition / Préparation / Installation). NO drag-and-drop (story 06
 * #221 cables that). Just a titled stack of `ProspectCard`s + an empty
 * state.
 *
 * Pins :
 *   - the title surfaces (« Acquisition » / « Préparation » /
 *     « Installation »)
 *   - the cards rendered are the ones passed in (count + a name spot-check)
 *   - empty state renders « Aucun prospect » when prospects=[]
 *   - the per-column count surfaces (« 3 prospects » badge — operator
 *     scans column volumes at a glance)
 */
import { describe, expect, it } from "vitest";

import { KanbanColumn } from "./kanban-column";
import type { ProspectCardSnapshot } from "../_lib/prospectFilter";
import { allText, findAllByType, serialize } from "./test-utils";

function makeProspect(
  overrides: Partial<ProspectCardSnapshot>,
): ProspectCardSnapshot {
  return {
    _id: "p_1",
    name: "L'Artisan",
    phase: "acquisition",
    source: "cold_call",
    score: undefined,
    tenantId: undefined,
    interactions: undefined,
    ...overrides,
  };
}

describe("KanbanColumn — F-PIPELINE-CRM 05 (#255)", () => {
  it("renders the column title (« Acquisition »)", () => {
    const tree = serialize(
      KanbanColumn({
        phase: "acquisition",
        title: "Acquisition",
        prospects: [],
      }),
    );
    expect(allText(tree)).toContain("Acquisition");
  });

  it("renders one anchor per prospect (each card is a bare `<a>` drill-down)", () => {
    const tree = serialize(
      KanbanColumn({
        phase: "acquisition",
        title: "Acquisition",
        prospects: [
          makeProspect({ _id: "p_1", name: "Pizza Roma" }),
          makeProspect({ _id: "p_2", name: "Sushi Bar" }),
        ],
      }),
    );
    const anchors = findAllByType(tree, "a");
    expect(anchors).toHaveLength(2);
    expect(allText(tree)).toContain("Pizza Roma");
    expect(allText(tree)).toContain("Sushi Bar");
  });

  it("renders an empty state when prospects=[] (« Aucun prospect »)", () => {
    const tree = serialize(
      KanbanColumn({
        phase: "acquisition",
        title: "Acquisition",
        prospects: [],
      }),
    );
    expect(allText(tree)).toMatch(/aucun prospect/i);
    // No card anchors when empty.
    expect(findAllByType(tree, "a")).toHaveLength(0);
  });

  it("surfaces the per-column prospect count (operator scans volumes at a glance)", () => {
    const tree = serialize(
      KanbanColumn({
        phase: "preparation",
        title: "Préparation",
        prospects: [
          makeProspect({ _id: "a", phase: "preparation" }),
          makeProspect({ _id: "b", phase: "preparation" }),
          makeProspect({ _id: "c", phase: "preparation" }),
        ],
      }),
    );
    expect(allText(tree)).toContain("3");
  });
});
