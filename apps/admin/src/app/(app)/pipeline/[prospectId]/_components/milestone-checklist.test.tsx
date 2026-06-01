/**
 * F-PIPELINE-CRM 07 (#256) — `MilestoneChecklist` test matrix.
 *
 * Two-layer test discipline (mirrors `generate-contract-launcher.test.ts` +
 * `generate-contract-modal.test.tsx` split):
 *
 *   1. RUNTIME PINS (via the React-tree serializer) — the pure-callable
 *      branches of the component, with `setMilestone` mutation injected as
 *      an optional `onToggle` prop so the lean `node` env can call the
 *      function directly (the real Convex `useMutation` is exercised only
 *      when the prop is omitted — that path is covered by the WIRING
 *      contract below).
 *
 *   2. WIRING CONTRACT (via source-file regex) — pins that the component
 *      calls `useMutation(api.lib.onboarding.milestones.setMilestone)` and
 *      uses `buildMilestoneChecklist` as its derivation source (the pure
 *      module from PIPELINE-03 #218).
 *
 * Issue #256 « MilestoneChecklist consomme buildMilestoneChecklist pour
 *  structurer la liste. Rend les milestones binaires applicables, groupés
 *  par phase (Acquisition / Préparation / Installation). Checkbox par
 *  milestone : achieved: true quand coché. Au check/uncheck → mutation
 *  setMilestone(prospectId, key, achieved). Indique visuellement les
 *  milestones qui impactent le Closing. »
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { MilestoneChecklist } from "./milestone-checklist";
import type { ProspectMilestonesInput } from "../../_lib/milestoneChecklistModel";
import {
  allText,
  findAllByType,
  flatten,
  serialize,
} from "../../_components/test-utils";

const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;

function baseProps(
  overrides: Partial<Parameters<typeof MilestoneChecklist>[0]> = {},
) {
  return {
    prospectId: PROSPECT_ID,
    milestones: {} as ProspectMilestonesInput,
    tabletteMode: "appareil_existant" as const,
    onToggle: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("MilestoneChecklist — F-PIPELINE-CRM 07 (#256) runtime", () => {
  it("renders the 3 phase group headings (Acquisition / Préparation / Installation)", () => {
    const tree = serialize(MilestoneChecklist(baseProps()));
    const text = allText(tree);
    expect(text).toMatch(/Acquisition/i);
    expect(text).toMatch(/Pr[ée]paration/i);
    expect(text).toMatch(/Installation/i);
  });

  it("renders the binary Acquisition milestone labels (« Premier contact », « RDV booké », « Contrat signé »…)", () => {
    const tree = serialize(MilestoneChecklist(baseProps()));
    const text = allText(tree);
    expect(text).toMatch(/Premier contact/i);
    expect(text).toMatch(/RDV book[ée]/i);
    expect(text).toMatch(/Contrat sign[ée]/i);
    expect(text).toMatch(/KBIS/i);
  });

  it("does NOT render the conditional tablette-invoice milestones when tabletteMode=appareil_existant", () => {
    const tree = serialize(
      MilestoneChecklist(baseProps({ tabletteMode: "appareil_existant" })),
    );
    const text = allText(tree);
    expect(text).not.toMatch(/Facture tablette/i);
  });

  it("renders the conditional tablette-invoice milestones when tabletteMode=achat_kb", () => {
    const tree = serialize(
      MilestoneChecklist(baseProps({ tabletteMode: "achat_kb" })),
    );
    const text = allText(tree);
    expect(text).toMatch(/Facture tablette/i);
  });

  it("marks the row `achieved` (data-achieved=true on the row) for milestones with a timestamp", () => {
    const tree = serialize(
      MilestoneChecklist(
        baseProps({
          milestones: { premierContact: 1_700_000_000_000 },
        }),
      ),
    );
    // Each milestone row carries `data-achieved={entry.achieved}` — the
    // canonical pin (radix's Checkbox primitive doesn't expand cleanly in
    // the `node` env, so we pin the achieved state on the row, not the
    // inner checkbox).
    const achievedRows = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: ReturnType<typeof flatten>;
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] === "milestone-row" &&
        (n.props as Record<string, unknown>)["data-achieved"] === true,
    );
    expect(achievedRows.length).toBeGreaterThan(0);
    expect(achievedRows[0].props["data-milestone-key"]).toBe("premierContact");
  });

  it("visually badges the milestones that impact Closing (data-impacts-closing=true on the row)", () => {
    const tree = serialize(MilestoneChecklist(baseProps()));
    const closingRows = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: ReturnType<typeof flatten>;
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] === "milestone-row" &&
        (n.props as Record<string, unknown>)["data-impacts-closing"] === true,
    );
    // contratSigne / kbisRecu / pieceIdentiteRecue / ribRecu — 4 mandatory
    // Closing milestones in the default (non-tablette) tabletteMode.
    expect(closingRows.length).toBeGreaterThanOrEqual(4);
  });

  it("calls `onToggle(prospectId, key, !achieved)` when a milestone row is clicked", async () => {
    const onToggle = vi.fn(async () => {});
    const tree = serialize(
      MilestoneChecklist(
        baseProps({
          onToggle,
          milestones: { premierContact: 1_700_000_000_000 },
        }),
      ),
    );
    const rows = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: ReturnType<typeof flatten>;
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] === "milestone-row",
    );
    const premierContactRow = rows.find(
      (r) => r.props["data-milestone-key"] === "premierContact",
    );
    if (premierContactRow === undefined) {
      throw new Error("premierContact row not found");
    }
    const onClick = premierContactRow.props.onClick as () => void;
    expect(typeof onClick).toBe("function");
    onClick();
    expect(onToggle).toHaveBeenCalledWith(
      PROSPECT_ID,
      "premierContact",
      false, // currently achieved, click → uncheck
    );
  });

  it("groups milestones under their phase heading (Acquisition rows precede Préparation rows in the rendered tree)", () => {
    const tree = serialize(MilestoneChecklist(baseProps()));
    const groups = findAllByType(tree, "section").filter(
      (s) => (s.props as Record<string, unknown>)["data-phase"] !== undefined,
    );
    expect(groups.length).toBe(3);
    const phases = groups.map(
      (g) => (g.props as Record<string, unknown>)["data-phase"],
    );
    expect(phases).toEqual(["acquisition", "preparation", "installation"]);
  });
});

// ---------------------------------------------------------------------------
// Wiring contract — pins `useMutation` + the canonical mutation symbol.
// (The runtime `useMutation(api.lib.onboarding.milestones.setMilestone)` path
// is exercised only when the optional `onToggle` prop is omitted; that path
// can't be expanded in `node` env, so we pin it at the source level.)
// ---------------------------------------------------------------------------
const SOURCE = readFileSync(
  path.resolve(__dirname, "./milestone-checklist.tsx"),
  "utf8",
);

function stripNonCode(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

const CODE = stripNonCode(SOURCE);

describe("MilestoneChecklist — F-PIPELINE-CRM 07 (#256) wiring", () => {
  it("fires the canonical `api.lib.onboarding.milestones.setMilestone` mutation via Convex `useMutation`", () => {
    expect(CODE).toMatch(/api\.lib\.onboarding\.milestones\.setMilestone/);
    expect(CODE).toMatch(/useMutation\(/);
  });

  it("derives its rendered list from the pure `buildMilestoneChecklist` (PIPELINE-03 #218)", () => {
    expect(CODE).toMatch(/buildMilestoneChecklist/);
  });

  it("never imports from `apps/web` or `apps/native` (scope discipline)", () => {
    expect(CODE).not.toMatch(/apps\/web/);
    expect(CODE).not.toMatch(/apps\/native/);
  });
});
