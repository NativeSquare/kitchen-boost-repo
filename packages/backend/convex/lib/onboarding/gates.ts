import type { Infer } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { prospectPhase } from "../../table/prospects";
import {
  MANDATORY_CLOSING_MILESTONES,
  requiredClosingMilestones,
} from "./pipeline";

/**
 * 2.9-B — INDICATIVE phase gates (PRD 70 §3.3, Q70-Q10 "indicatif V1 : bypass
 * loggé"). A phase change is NEVER blocked in V1 — but entering a phase whose
 * required milestones are not all met is a BYPASS that must be recorded (audit
 * via foundation, acceptance criterion).
 *
 * `missingMilestonesForPhase` returns the required binary milestones for the
 * TARGET phase that are not yet achieved (a binary milestone is "achieved" iff
 * its timestamp is present — table/prospects.ts). The gate lists are taken
 * VERBATIM from PRD 70 §3.3 — NO milestone is invented:
 *  - → Préparation = the [[Closing]] event: contrat signé + KBIS + pièce ID + RIB,
 *    plus (conditionally, only if `tabletteMode = achat_kb`) facture tablette payée
 *    (kb-admin CONTEXT "Closing").
 *  - → Installation = the Préparation GATE: menu importé + photos emballages reçues
 *    (the binary, prospect-stored Préparation milestones; the oscillating Stripe /
 *    Uber / Hubrise integration statuses are NOT binary gates here).
 *  - → Opérationnel = "1ère cmd publique reçue" — an EVENT not stored as a binary
 *    prospect milestone in this slice, so no binary gate is asserted for it.
 *  - → Acquisition = the entry phase (no inbound gate).
 *
 * The pipeline state machine + automatic Closing detection (`evaluateClosing`) is
 * slice C; this slice only surfaces which milestones are missing so the manual
 * change can flag the bypass.
 */

type ProspectPhase = Infer<typeof prospectPhase>;
type Milestones = NonNullable<Doc<"prospects">["milestones"]>;

/**
 * The binary (timestamp) milestone keys a phase gate may require — the subset of
 * `Milestones` keys whose value is `number | undefined` (a timestamp), excluding
 * the composite oscillating integration objects.
 */
type BinaryMilestoneKey = Extract<
  {
    [K in keyof Milestones]-?: NonNullable<Milestones[K]> extends number
      ? K
      : never;
  }[keyof Milestones],
  string
>;

/**
 * The required binary milestones to ENTER each phase (PRD 70 §3.3). `preparation`
 * is the [[Closing]] event, so its gate is derived per-prospect from the canonical
 * Closing set (`requiredClosingMilestones`, incl. the conditional tablette
 * milestone) — single source of truth, no drift with slice C. `installation` is
 * the Préparation GATE binary milestones. `acquisition` / `operationnel` have no
 * binary prospect-stored gate in this slice (see module header).
 */
const PHASE_BINARY_GATES: Record<ProspectPhase, BinaryMilestoneKey[]> = {
  acquisition: [],
  preparation: [...MANDATORY_CLOSING_MILESTONES],
  installation: ["menuImporte", "photosEmballagesRecues"],
  operationnel: [],
};

/**
 * The binary milestones REQUIRED to enter `phase` that are NOT yet achieved on
 * `prospect`. Empty = the gate is satisfied (the change is clean). Non-empty =
 * the manual change is a bypass to be logged. For `preparation` (the [[Closing]]
 * event) the full applicable Closing set is used — including the conditional
 * `factureTablettePayee` when this prospect's `tabletteMode = achat_kb`
 * (`requiredClosingMilestones`, PRD 70 §3.3).
 */
export function missingMilestonesForPhase(
  prospect: Doc<"prospects">,
  phase: ProspectPhase,
): string[] {
  const required: string[] =
    phase === "preparation"
      ? requiredClosingMilestones(prospect)
      : [...PHASE_BINARY_GATES[phase]];

  const milestones = prospect.milestones ?? {};
  return required.filter(
    (key) => milestones[key as keyof Milestones] === undefined,
  );
}
