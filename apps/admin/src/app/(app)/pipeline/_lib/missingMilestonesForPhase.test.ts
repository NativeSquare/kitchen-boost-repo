/**
 * F-PIPELINE-CRM 06 (#262) — `missingMilestonesForPhase` (front mirror) pure
 * decision pinned.
 *
 * Mirrors `convex/lib/onboarding/gates.ts → missingMilestonesForPhase`. The
 * gate is INDICATIVE in V1 (PRD 70 §3.3 / Q70-Q10) — never blocks, but the
 * DnD shell consults it to know whether a forward drag is `clean` or `bypass`.
 *
 * Why a front mirror (decided in this story)
 * ------------------------------------------
 * The issue spells the choice out:
 *   « préférence — exposer `missingMilestonesForPhase` côté Convex en query
 *   pure (SSOT). Si pas dispo, l'inclure dans la réponse de `listProspects`
 *   ou la dupliquer côté front à partir des données prospect. Trancher dans
 *   cette story. »
 *
 * `listProspects` already returns the FULL `Doc<"prospects">` — every field
 * needed to compute the gate (milestones + tabletteMode) is therefore in the
 * snapshot the Kanban already subscribes to. Adding a per-prospect Convex
 * query would mean N round-trips for N visible cards; embedding it in the
 * list response would change the backend contract. Mirroring the small pure
 * function front-side keeps the epic scope (`apps/admin/src/app/(app)/pipeline/`
 * STRICT) and the decision pure / dependency-free, exactly like
 * `prospectPhaseMover.ts` mirrors `PHASE_ORDER`.
 *
 * Single-source-of-truth discipline: the canonical Closing set lives in
 * `convex/lib/onboarding/pipeline.ts` (`MANDATORY_CLOSING_MILESTONES` +
 * `CONDITIONAL_TABLETTE_MILESTONE`); the Préparation/Installation gate
 * encoding lives in `convex/lib/onboarding/gates.ts`. This mirror MUST stay
 * in lockstep — a future slice may lift the shared arrays into
 * `packages/shared/` if more cross-package consumers appear.
 */
import { describe, expect, it } from "vitest";

import {
  type ProspectGateSnapshot,
  missingMilestonesForPhase,
} from "./missingMilestonesForPhase";

function makeProspect(
  overrides: Partial<ProspectGateSnapshot> = {},
): ProspectGateSnapshot {
  return {
    milestones: undefined,
    tabletteMode: undefined,
    ...overrides,
  };
}

describe("missingMilestonesForPhase — front mirror of backend gates (#262)", () => {
  it("acquisition has no inbound gate (always []) — entry phase", () => {
    expect(missingMilestonesForPhase(makeProspect(), "acquisition")).toEqual(
      [],
    );
  });

  it("operationnel has no binary prospect-stored gate (always [])", () => {
    expect(missingMilestonesForPhase(makeProspect(), "operationnel")).toEqual(
      [],
    );
  });

  describe("→ Préparation = the Closing event (PRD 70 §3.3)", () => {
    it("appareil_existant + empty milestones → 4 mandatory missing", () => {
      const missing = missingMilestonesForPhase(
        makeProspect({ tabletteMode: "appareil_existant" }),
        "preparation",
      );
      expect(missing.sort()).toEqual(
        ["contratSigne", "kbisRecu", "pieceIdentiteRecue", "ribRecu"].sort(),
      );
    });

    it("achat_kb + empty milestones → 5 missing (the 4 mandatory + factureTablettePayee)", () => {
      const missing = missingMilestonesForPhase(
        makeProspect({ tabletteMode: "achat_kb" }),
        "preparation",
      );
      expect(missing.sort()).toEqual(
        [
          "contratSigne",
          "kbisRecu",
          "pieceIdentiteRecue",
          "ribRecu",
          "factureTablettePayee",
        ].sort(),
      );
    });

    it("appareil_existant + all 4 mandatory present → [] (clean Closing)", () => {
      const missing = missingMilestonesForPhase(
        makeProspect({
          tabletteMode: "appareil_existant",
          milestones: {
            contratSigne: 1,
            kbisRecu: 2,
            pieceIdentiteRecue: 3,
            ribRecu: 4,
          },
        }),
        "preparation",
      );
      expect(missing).toEqual([]);
    });

    it("achat_kb + 4 mandatory present but factureTablettePayee missing → [factureTablettePayee]", () => {
      const missing = missingMilestonesForPhase(
        makeProspect({
          tabletteMode: "achat_kb",
          milestones: {
            contratSigne: 1,
            kbisRecu: 2,
            pieceIdentiteRecue: 3,
            ribRecu: 4,
          },
        }),
        "preparation",
      );
      expect(missing).toEqual(["factureTablettePayee"]);
    });

    it("undefined tabletteMode behaves like appareil_existant (4 mandatory, no tablette gate)", () => {
      const missing = missingMilestonesForPhase(
        makeProspect({ tabletteMode: undefined }),
        "preparation",
      );
      expect(missing.sort()).toEqual(
        ["contratSigne", "kbisRecu", "pieceIdentiteRecue", "ribRecu"].sort(),
      );
    });
  });

  describe("→ Installation = the Préparation GATE binary milestones (PRD 70 §3.3)", () => {
    it("empty milestones → menuImporte + photosEmballagesRecues missing", () => {
      const missing = missingMilestonesForPhase(makeProspect(), "installation");
      expect(missing.sort()).toEqual(
        ["menuImporte", "photosEmballagesRecues"].sort(),
      );
    });

    it("both Préparation milestones present → [] (clean)", () => {
      const missing = missingMilestonesForPhase(
        makeProspect({
          milestones: {
            menuImporte: 1,
            photosEmballagesRecues: 2,
          },
        }),
        "installation",
      );
      expect(missing).toEqual([]);
    });

    it("only menuImporte present → photosEmballagesRecues still missing", () => {
      const missing = missingMilestonesForPhase(
        makeProspect({
          milestones: { menuImporte: 1 },
        }),
        "installation",
      );
      expect(missing).toEqual(["photosEmballagesRecues"]);
    });

    it("tabletteMode is irrelevant to the Installation gate", () => {
      const achatKb = missingMilestonesForPhase(
        makeProspect({ tabletteMode: "achat_kb" }),
        "installation",
      );
      const appareil = missingMilestonesForPhase(
        makeProspect({ tabletteMode: "appareil_existant" }),
        "installation",
      );
      expect(achatKb.sort()).toEqual(appareil.sort());
    });
  });
});
