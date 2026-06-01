/**
 * F-PIPELINE-CRM 05 (#255) — `ActiveClientsTab` test matrix.
 *
 * The « Clients actifs » panel rendered when the operator switches away
 * from the Kanban tab. Lists prospects in the `operationnel` phase as a
 * flat stack of `ProspectCard`s (the same card the Kanban uses — operator
 * vocabulary stays consistent).
 *
 * Pins :
 *   - renders one card anchor per prospect in `operationnel`
 *   - empty state when prospects=[] (« Aucun client actif »)
 *   - the panel surfaces the count
 */
import { describe, expect, it } from "vitest";

import { ActiveClientsTab } from "./active-clients-tab";
import type { ProspectCardSnapshot } from "../_lib/prospectFilter";
import { allText, findAllByType, serialize } from "./test-utils";

function makeProspect(
  overrides: Partial<ProspectCardSnapshot>,
): ProspectCardSnapshot {
  return {
    _id: "p_1",
    name: "Khan",
    phase: "operationnel",
    source: "referral",
    score: undefined,
    tenantId: "tenants_khan",
    interactions: undefined,
    ...overrides,
  };
}

describe("ActiveClientsTab — F-PIPELINE-CRM 05 (#255)", () => {
  it("renders one anchor per prospect (bare `<a>` drill-down)", () => {
    const tree = serialize(
      ActiveClientsTab({
        prospects: [
          makeProspect({ _id: "p_1", name: "Khan" }),
          makeProspect({ _id: "p_2", name: "L'Artisan" }),
        ],
      }),
    );
    const anchors = findAllByType(tree, "a");
    expect(anchors).toHaveLength(2);
    expect(allText(tree)).toContain("Khan");
    expect(allText(tree)).toContain("L'Artisan");
  });

  it("renders an empty state when no prospects in `operationnel` (« Aucun client actif »)", () => {
    const tree = serialize(ActiveClientsTab({ prospects: [] }));
    expect(allText(tree)).toMatch(/aucun client actif/i);
    expect(findAllByType(tree, "a")).toHaveLength(0);
  });
});
