/**
 * F-PIPELINE-CRM 06 (#262) — `missingMilestonesForPhase`, the FRONT MIRROR of
 * `convex/lib/onboarding/gates.ts → missingMilestonesForPhase`.
 *
 * Pure function — no React, no Convex, no DOM. The DnD shell (`useKanbanDnd`)
 * calls it to classify a forward drag as `clean` (no missing) or `bypass`
 * (one+ missing). The gate is INDICATIVE in V1 (PRD 70 §3.3 / Q70-Q10) —
 * never blocks ; the backend `crm.changePhase` mutation re-computes the same
 * set and logs a `prospect.changePhase.bypass` audit row when the operator
 * confirms the dialog.
 *
 * Decision recorded in this story
 * -------------------------------
 * The issue offers three options for the gate source:
 *   1. expose `missingMilestonesForPhase` as a Convex query (SSOT)
 *   2. embed it in the `listProspects` response
 *   3. mirror it front-side from prospect data
 *
 * (3) wins: `listProspects` already returns the full `Doc<"prospects">`
 * (every field needed — `milestones` + `tabletteMode` — is in the snapshot
 * the Kanban subscribes to). Option (1) would mean N per-card round-trips;
 * option (2) would change the backend contract. Mirroring keeps epic scope
 * (`apps/admin/src/app/(app)/pipeline/` STRICT) and the decision pure /
 * dependency-free — same trade-off as `prospectPhaseMover.ts`. The pinned
 * tests (`missingMilestonesForPhase.test.ts`) match the backend acceptance
 * matrix one-for-one so any drift will fail loudly.
 *
 * No invention: every set comes verbatim from PRD 70 §3.3 / kb-admin CONTEXT
 * "Closing" — see `convex/lib/onboarding/pipeline.ts` for the canonical
 * `MANDATORY_CLOSING_MILESTONES` + `CONDITIONAL_TABLETTE_MILESTONE`, and
 * `convex/lib/onboarding/gates.ts` for the Préparation/Installation encoding.
 */

import type { Phase } from "./prospectPhaseMover";

/**
 * The binary milestone subset of `prospect.milestones` (timestamp shape —
 * present = achieved). Composite oscillating integrations
 * (`stripeConnect` / `uberDirect` / `hubrise`) deliberately omitted: not
 * gates here (cf. `gates.ts` header). Same shape as
 * `ProspectMilestonesInput` in `milestoneChecklistModel.ts`.
 */
export type ProspectMilestonesInput = {
  contratSigne?: number;
  kbisRecu?: number;
  pieceIdentiteRecue?: number;
  ribRecu?: number;
  factureTablettePayee?: number;
  menuImporte?: number;
  photosEmballagesRecues?: number;
  // Any other binary milestone is irrelevant to a gate — they're optional
  // metadata for the operator dashboard (see milestoneChecklistModel.ts).
  [k: string]: number | undefined;
};

/**
 * Narrow snapshot of a prospect that this gate computation depends on.
 * Structurally assignable from `Doc<"prospects">` (every field of this
 * snapshot is also on the Doc) so the Convex doc passes through without
 * conversion — identical narrowing discipline as `ProspectCardSnapshot`.
 */
export type ProspectGateSnapshot = {
  milestones?: ProspectMilestonesInput;
  tabletteMode?: "achat_kb" | "appareil_existant";
};

/**
 * The 4 ALWAYS-mandatory Closing milestones (PRD 70 §3.3 / CONTEXT "Closing").
 * Mirror of `MANDATORY_CLOSING_MILESTONES` in
 * `convex/lib/onboarding/pipeline.ts`.
 */
const MANDATORY_CLOSING_MILESTONES = [
  "contratSigne",
  "kbisRecu",
  "pieceIdentiteRecue",
  "ribRecu",
] as const;

/** The CONDITIONAL Closing milestone — applies only when `tabletteMode === "achat_kb"`. */
const CONDITIONAL_TABLETTE_MILESTONE = "factureTablettePayee" as const;

/**
 * The Closing milestones APPLICABLE to `prospect` — the 4 mandatory ones,
 * plus the conditional tablette-invoice milestone ONLY when
 * `tabletteMode = achat_kb`. Mirror of `requiredClosingMilestones` in
 * `convex/lib/onboarding/pipeline.ts`.
 */
function requiredClosingMilestones(prospect: ProspectGateSnapshot): string[] {
  const required: string[] = [...MANDATORY_CLOSING_MILESTONES];
  if (prospect.tabletteMode === "achat_kb") {
    required.push(CONDITIONAL_TABLETTE_MILESTONE);
  }
  return required;
}

/**
 * The required binary milestones to ENTER each phase (PRD 70 §3.3).
 * `preparation` is the [[Closing]] event — its gate is derived per-prospect
 * from `requiredClosingMilestones` (so the conditional tablette milestone
 * follows `tabletteMode`). `installation` is the Préparation GATE binary
 * milestones. `acquisition` / `operationnel` have no binary prospect-stored
 * gate in V1 (see `gates.ts` header).
 */
const PHASE_BINARY_GATES: Record<Phase, readonly string[]> = {
  acquisition: [],
  preparation: [], // computed dynamically from `requiredClosingMilestones`
  installation: ["menuImporte", "photosEmballagesRecues"],
  operationnel: [],
};

/**
 * The binary milestones REQUIRED to enter `phase` that are NOT yet achieved
 * on `prospect`. Empty = the gate is satisfied (the drag is clean). Non-empty
 * = the drag is a bypass to be confirmed via dialog (and logged backend-side
 * by `crm.changePhase` when the operator confirms).
 */
export function missingMilestonesForPhase(
  prospect: ProspectGateSnapshot,
  phase: Phase,
): string[] {
  const required: readonly string[] =
    phase === "preparation"
      ? requiredClosingMilestones(prospect)
      : PHASE_BINARY_GATES[phase];

  const milestones = prospect.milestones ?? {};
  return required.filter((key) => milestones[key] === undefined);
}
