/**
 * F-PIPELINE-CRM 02 (#217) — `decidePhaseMove` pure decision matrix test.
 *
 * Pure module, no React / no Convex / no DOM — runs in vitest's lean `node`
 * env. Pins the 4 `PhaseMoveDecision` kinds plus the bypass-at-one-hop edge
 * case spelled out in the issue's acceptance criteria.
 *
 * Decision matrix (issue #217):
 *
 *   - currentPhase === targetPhase                       → `noop`
 *   - targetPhase index < currentPhase index             → `backward`
 *                                                          (correction — gates ignored)
 *   - targetPhase index > currentPhase index, missing=[] → `clean`
 *   - targetPhase index > currentPhase index, missing≠[] → `bypass` (carries `missing`)
 *
 * `missing` is taken AS-IS from the caller (pre-computed via
 * `gates.missingMilestonesForPhase` backend-side or its front mirror — out of
 * scope for this module, decided in a later story).
 *
 * The phase order (Acquisition → Préparation → Installation → Opérationnel)
 * mirrors `packages/backend/convex/lib/onboarding/pipeline.ts` `PHASE_ORDER`
 * but is duplicated front-side so the module stays pure / dependency-free
 * (epic F-PIPELINE-CRM scope is `apps/admin/src/app/(app)/pipeline/` STRICT).
 */
import { describe, expect, it } from "vitest";

import { decidePhaseMove } from "./prospectPhaseMover";

describe("decidePhaseMove", () => {
  it("clean forward — Acquisition → Préparation with all milestones present", () => {
    expect(
      decidePhaseMove({
        currentPhase: "acquisition",
        targetPhase: "preparation",
        missingMilestonesForTarget: [],
      }),
    ).toEqual({ kind: "clean" });
  });

  it("bypass forward (multi-hop) — Acquisition → Installation with several missing milestones", () => {
    expect(
      decidePhaseMove({
        currentPhase: "acquisition",
        targetPhase: "installation",
        missingMilestonesForTarget: ["contratSigne", "kbisRecu"],
      }),
    ).toEqual({ kind: "bypass", missing: ["contratSigne", "kbisRecu"] });
  });

  it("bypass forward (one-hop) — Acquisition → Préparation with one missing milestone", () => {
    expect(
      decidePhaseMove({
        currentPhase: "acquisition",
        targetPhase: "preparation",
        missingMilestonesForTarget: ["contratSigne"],
      }),
    ).toEqual({ kind: "bypass", missing: ["contratSigne"] });
  });

  it("backward — Installation → Préparation is free regardless of milestones", () => {
    // Pinning the contract: backward NEVER looks at `missingMilestonesForTarget`.
    // We feed a non-empty list to prove it is ignored.
    expect(
      decidePhaseMove({
        currentPhase: "installation",
        targetPhase: "preparation",
        missingMilestonesForTarget: ["kbisRecu", "ribRecu"],
      }),
    ).toEqual({ kind: "backward" });
  });

  it("noop — Préparation → Préparation regardless of milestones", () => {
    // Same as backward: noop ignores the milestone list.
    expect(
      decidePhaseMove({
        currentPhase: "preparation",
        targetPhase: "preparation",
        missingMilestonesForTarget: ["kbisRecu"],
      }),
    ).toEqual({ kind: "noop" });
  });
});
