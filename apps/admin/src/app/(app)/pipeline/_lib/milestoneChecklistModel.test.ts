/**
 * F-PIPELINE-CRM 03 (#218) — `buildMilestoneChecklist` pure derivation test.
 *
 * Pure module — no React / no Convex / no DOM (vitest `node` env, same as
 * `prospectPhaseMover.test.ts`). Pins the 5 cases listed in the issue's
 * acceptance criteria:
 *
 *   1. `tabletteMode === "achat_kb"` includes the 2 tablette-invoice entries.
 *   2. `tabletteMode === "appareil_existant"` excludes them.
 *      (Same exclusion for `non_applicable`, sentinel for absent
 *      `tabletteMode` on the prospect doc.)
 *   3. Per-phase classification matches PRD 70 §3.3 on a 5-6 milestone sample.
 *   4. `achieved` is derived from the timestamp (present ⇒ true + `achievedAt`,
 *      absent ⇒ false + no `achievedAt`).
 *   5. `impactsClosing` true for `contratSigne` (mandatory Closing milestone)
 *      and false for `stickersQrCollesDansSacs` (Installation, not Closing).
 *
 * The Closing set comes verbatim from
 * `packages/backend/convex/lib/onboarding/pipeline.ts`
 * (`MANDATORY_CLOSING_MILESTONES` + the conditional tablette milestone) — no
 * invention. The phase classification mirrors PRD 70 §3.3.
 *
 * Per-phase classification is duplicated front-side (same justification as
 * `prospectPhaseMover`: F-PIPELINE-CRM scope is `apps/admin/src/app/(app)/pipeline/`
 * STRICT — no edits to `packages/backend/convex/`).
 */
import { describe, expect, it } from "vitest";

import { buildMilestoneChecklist } from "./milestoneChecklistModel";

describe("buildMilestoneChecklist", () => {
  it("tabletteMode 'achat_kb' includes both tablette-invoice entries (Acquisition, impactsClosing for the paid one)", () => {
    const list = buildMilestoneChecklist({
      milestones: {},
      tabletteMode: "achat_kb",
    });

    const tabletteEmise = list.find(
      (entry) => entry.key === "factureTabletteEmise",
    );
    const tablettePayee = list.find(
      (entry) => entry.key === "factureTablettePayee",
    );

    expect(tabletteEmise).toBeDefined();
    expect(tabletteEmise?.phase).toBe("acquisition");
    expect(tablettePayee).toBeDefined();
    expect(tablettePayee?.phase).toBe("acquisition");
    // Only `factureTablettePayee` is a Closing milestone
    // (cf. `CONDITIONAL_TABLETTE_MILESTONE` in pipeline.ts) — emise is
    // operationally tracked but does NOT block Closing.
    expect(tablettePayee?.impactsClosing).toBe(true);
    expect(tabletteEmise?.impactsClosing).toBe(false);
  });

  it("tabletteMode 'appareil_existant' excludes both tablette-invoice entries", () => {
    const list = buildMilestoneChecklist({
      milestones: {},
      tabletteMode: "appareil_existant",
    });

    expect(
      list.find((entry) => entry.key === "factureTabletteEmise"),
    ).toBeUndefined();
    expect(
      list.find((entry) => entry.key === "factureTablettePayee"),
    ).toBeUndefined();
  });

  it("tabletteMode 'non_applicable' excludes both tablette-invoice entries", () => {
    const list = buildMilestoneChecklist({
      milestones: {},
      tabletteMode: "non_applicable",
    });

    expect(
      list.find((entry) => entry.key === "factureTabletteEmise"),
    ).toBeUndefined();
    expect(
      list.find((entry) => entry.key === "factureTablettePayee"),
    ).toBeUndefined();
  });

  it("classifies each milestone in the correct phase (sample from PRD 70 §3.3)", () => {
    const list = buildMilestoneChecklist({
      milestones: {},
      tabletteMode: "appareil_existant",
    });
    const phaseOf = (key: string) =>
      list.find((entry) => entry.key === key)?.phase;

    // Acquisition (PRD 70 §3.3)
    expect(phaseOf("premierContact")).toBe("acquisition");
    expect(phaseOf("contratSigne")).toBe("acquisition");
    expect(phaseOf("kbisRecu")).toBe("acquisition");

    // Preparation (PRD 70 §3.3) — binary prospect-stored milestones only
    expect(phaseOf("menuImporte")).toBe("preparation");
    expect(phaseOf("photosEmballagesRecues")).toBe("preparation");

    // Installation (PRD 70 §3.3)
    expect(phaseOf("stickersQrCollesDansSacs")).toBe("installation");
  });

  it("derives `achieved` and `achievedAt` from the timestamp (present vs absent)", () => {
    const at = 1_700_000_000_000;
    const list = buildMilestoneChecklist({
      milestones: { contratSigne: at },
      tabletteMode: "appareil_existant",
    });

    const contratSigne = list.find((entry) => entry.key === "contratSigne");
    const kbisRecu = list.find((entry) => entry.key === "kbisRecu");

    expect(contratSigne?.achieved).toBe(true);
    expect(contratSigne?.achievedAt).toBe(at);

    expect(kbisRecu?.achieved).toBe(false);
    expect(kbisRecu?.achievedAt).toBeUndefined();
  });

  it("`impactsClosing` true for `contratSigne`, false for `stickersQrCollesDansSacs`", () => {
    const list = buildMilestoneChecklist({
      milestones: {},
      tabletteMode: "appareil_existant",
    });

    expect(
      list.find((entry) => entry.key === "contratSigne")?.impactsClosing,
    ).toBe(true);
    expect(
      list.find((entry) => entry.key === "stickersQrCollesDansSacs")
        ?.impactsClosing,
    ).toBe(false);
  });
});
