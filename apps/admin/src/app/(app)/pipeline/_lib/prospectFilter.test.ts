/**
 * F-PIPELINE-CRM 05 (#255) — `prospectFilter` pure module test.
 *
 * Pure derivation for the Kanban surface :
 *
 *   1. `searchProspectsByName(prospects, query)` — case-insensitive, accent-
 *      insensitive substring match on `name`. Empty / whitespace query =
 *      identity (return everything). Used by the `ProspectSearchBar` to
 *      narrow the rendered cards in real time (PRD 70 §3.4 « Search par
 *      nom »).
 *   2. `partitionProspectsByPhase(prospects)` — split into `{ acquisition,
 *      preparation, installation, operationnel }`. Required because the
 *      backend `listProspects()` returns the FLAT list (no per-phase
 *      grouping) — we partition front-side to fill the 3 Kanban columns
 *      AND the « Clients actifs » tab (PRD 70 §3.3 « 3 colonnes visibles
 *      + onglet séparé Opérationnel »).
 *
 * No React, no Convex, no DOM (vitest `node` env, same as
 * `prospectPhaseMover.test.ts`).
 */
import { describe, expect, it } from "vitest";

import type { ProspectCardSnapshot } from "./prospectFilter";
import {
  partitionProspectsByPhase,
  searchProspectsByName,
} from "./prospectFilter";

function prospect(
  overrides: Partial<ProspectCardSnapshot>,
): ProspectCardSnapshot {
  return {
    _id: "prospects_x",
    name: "L'Artisan",
    phase: "acquisition",
    source: "cold_call",
    score: undefined,
    tenantId: undefined,
    interactions: undefined,
    ...overrides,
  };
}

describe("searchProspectsByName", () => {
  it("empty query returns the full list (identity)", () => {
    const list = [
      prospect({ name: "Pizza Roma" }),
      prospect({ name: "Sushi" }),
    ];
    expect(searchProspectsByName(list, "")).toEqual(list);
  });

  it("whitespace-only query returns the full list (identity)", () => {
    const list = [prospect({ name: "Pizza Roma" })];
    expect(searchProspectsByName(list, "   ")).toEqual(list);
  });

  it("substring match is case-insensitive", () => {
    const list = [
      prospect({ _id: "a", name: "Pizza Roma" }),
      prospect({ _id: "b", name: "SUSHI BAR" }),
      prospect({ _id: "c", name: "Le Burger" }),
    ];
    expect(searchProspectsByName(list, "ZZA")).toEqual([list[0]]);
    expect(searchProspectsByName(list, "sushi")).toEqual([list[1]]);
  });

  it("accent-insensitive match — searching 'cafe' finds 'Café Vert'", () => {
    const list = [
      prospect({ _id: "a", name: "Café Vert" }),
      prospect({ _id: "b", name: "Crêperie Nantaise" }),
    ];
    expect(searchProspectsByName(list, "cafe")).toEqual([list[0]]);
    expect(searchProspectsByName(list, "creperie")).toEqual([list[1]]);
  });

  it("no match returns an empty array", () => {
    const list = [prospect({ name: "Pizza Roma" })];
    expect(searchProspectsByName(list, "introuvable")).toEqual([]);
  });

  it("preserves the input order (stable filter, no sort)", () => {
    const list = [
      prospect({ _id: "a", name: "Pizza Z" }),
      prospect({ _id: "b", name: "Pizza A" }),
      prospect({ _id: "c", name: "Pizza M" }),
    ];
    expect(searchProspectsByName(list, "pizza")).toEqual(list);
  });
});

describe("partitionProspectsByPhase", () => {
  it("splits prospects into the 4 phases (Kanban columns + Clients actifs)", () => {
    const acq = prospect({ _id: "a", phase: "acquisition" });
    const prep = prospect({ _id: "b", phase: "preparation" });
    const inst = prospect({ _id: "c", phase: "installation" });
    const op = prospect({ _id: "d", phase: "operationnel" });

    const out = partitionProspectsByPhase([acq, prep, inst, op]);
    expect(out.acquisition).toEqual([acq]);
    expect(out.preparation).toEqual([prep]);
    expect(out.installation).toEqual([inst]);
    expect(out.operationnel).toEqual([op]);
  });

  it("empty input returns empty buckets for each phase (never undefined)", () => {
    const out = partitionProspectsByPhase([]);
    expect(out.acquisition).toEqual([]);
    expect(out.preparation).toEqual([]);
    expect(out.installation).toEqual([]);
    expect(out.operationnel).toEqual([]);
  });

  it("preserves input order WITHIN each bucket (stable partition, no sort)", () => {
    const a1 = prospect({ _id: "a1", phase: "acquisition", name: "Z" });
    const a2 = prospect({ _id: "a2", phase: "acquisition", name: "A" });
    const out = partitionProspectsByPhase([a1, a2]);
    expect(out.acquisition).toEqual([a1, a2]);
  });
});
