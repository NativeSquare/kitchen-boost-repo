import type { Doc } from "../../_generated/dataModel";
import type { Infer } from "convex/values";
import type { prospectPhase } from "../../table/prospects";

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
 * The required binary milestones to ENTER each phase (PRD 70 §3.3). The
 * conditional tablette-invoice milestone is handled separately (it depends on
 * `tabletteMode`). `acquisition` and `operationnel` have no binary prospect-stored
 * gate in this slice (see module header).
 */
const PHASE_BINARY_GATES: Record<ProspectPhase, BinaryMilestoneKey[]> = {
  acquisition: [],
  preparation: ["contratSigne", "kbisRecu", "pieceIdentiteRecue", "ribRecu"],
  installation: ["menuImporte", "photosEmballagesRecues"],
  operationnel: [],
};

/**
 * The binary milestones REQUIRED to enter `phase` that are NOT yet achieved on
 * `prospect`. Empty = the gate is satisfied (the change is clean). Non-empty =
 * the manual change is a bypass to be logged. The conditional `factureTablettePayee`
 * is only required when this prospect's `tabletteMode = achat_kb` (PRD 70 §3.3).
 */
export function missingMilestonesForPhase(
  prospect: Doc<"prospects">,
  phase: ProspectPhase,
): string[] {
  const required = [...PHASE_BINARY_GATES[phase]];

  // Conditional Closing milestone — only when KB supplies the tablet.
  if (phase === "preparation" && prospect.tabletteMode === "achat_kb") {
    required.push("factureTablettePayee");
  }

  const milestones = prospect.milestones ?? {};
  return required.filter(
    (key) => milestones[key as keyof Milestones] === undefined,
  );
}
