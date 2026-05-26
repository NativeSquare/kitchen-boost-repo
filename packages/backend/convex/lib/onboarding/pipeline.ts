import { ConvexError, type Infer, v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { prospectPhase } from "../../table/prospects";
import {
  getProspect as getProspectRow,
  kbAdminMutation,
  logAudit,
  setProspectPhase,
} from "../tenancy";

/**
 * 2.9-C — the KB onboarding PIPELINE state machine + the composite [[Closing]]
 * auto-bascule (PRD 70 §3.3, kb-admin CONTEXT "Closing" / "Phase pipeline").
 *
 * Two responsibilities, kept apart so the decision is testable in isolation from
 * its persistence:
 *
 *  1. `evaluateClosing(prospect)` — a PURE function (input → result, no DB). It
 *     reports whether the composite **Closing event** is complete. Closing is NOT
 *     a phase of its own; it is the EVENT that triggers Acquisition → Préparation
 *     (kb-admin CONTEXT "Closing"). Its milestones are taken VERBATIM from PRD 70
 *     §3.3 / the CONTEXT — NONE is invented:
 *       - contrat signé        (`contratSigne`)
 *       - KBIS reçu            (`kbisRecu`)
 *       - pièce d'identité reçue (`pieceIdentiteRecue`)
 *       - RIB reçu             (`ribRecu`)
 *       - CONDITIONAL: facture tablette payée (`factureTablettePayee`) — required
 *         ONLY when `tabletteMode = achat_kb` (KB supplies the tablet). For any
 *         other mode (`appareil_existant` / absent) this milestone MUST NOT block
 *         (a resto on its own device is not gated by a non-applicable milestone).
 *
 *  2. The pipeline STATE MACHINE — the canonical ordered phase progression
 *     Acquisition → Préparation → Installation → Opérationnel (kb-admin CONTEXT
 *     "Phase pipeline", acté 2026-05-23). `assertLegalPhaseTransition` rejects any
 *     edge that is not a single forward step. This guards the ONE automatic
 *     transition (the Closing auto-bascule): the bascule fires only on the
 *     `acquisition → preparation` edge, and only from a prospect still in
 *     Acquisition. MANUAL phase changes stay INDICATIVE in V1 (Q70-Q10) and live
 *     in `crm.changePhase` (slice B) — they are deliberately NOT routed through
 *     this machine, so a manual bypass is not regressed.
 *
 * Access goes EXCLUSIVELY through the root wrapper `kbAdminMutation` (prospects
 * are KB-ADMIN-GLOBAL, owned by the `kb_admin` role; a non-root actor is refused
 * Forbidden) and the sanctioned `lib/tenancy/prospectsStore` seam — never raw
 * `ctx.db` in this business module (`no-untenanted-query`, ADR 0010). Identity
 * flows only through the wrapper's `getCurrentActor` (ADR 0011). Every
 * `kbAdminMutation` is auto-audited by the foundation; the auto-bascule adds an
 * explicit, richer `prospect.closing.autoBascule` row.
 */

type ProspectPhase = Infer<typeof prospectPhase>;
type Milestones = NonNullable<Doc<"prospects">["milestones"]>;
export type ClosingMilestoneKey =
  | "contratSigne"
  | "kbisRecu"
  | "pieceIdentiteRecue"
  | "ribRecu"
  | "factureTablettePayee";

/**
 * The 4 ALWAYS-mandatory Closing milestones (PRD 70 §3.3 / CONTEXT "Closing").
 * Exported as the SINGLE source of truth — the indicative Préparation gate
 * (`gates.ts`) reuses it so the two slices can never drift on the Closing set.
 */
export const MANDATORY_CLOSING_MILESTONES: readonly ClosingMilestoneKey[] = [
  "contratSigne",
  "kbisRecu",
  "pieceIdentiteRecue",
  "ribRecu",
];

/** The CONDITIONAL Closing milestone — applies only when KB supplies the tablet. */
export const CONDITIONAL_TABLETTE_MILESTONE: ClosingMilestoneKey =
  "factureTablettePayee";

/**
 * The Closing milestones APPLICABLE to `prospect` — the 4 mandatory ones, plus
 * the conditional tablette-invoice milestone ONLY when `tabletteMode = achat_kb`.
 * Pure (depends only on `tabletteMode`); the single place the Closing set is
 * computed for a given prospect.
 */
export function requiredClosingMilestones(
  prospect: Pick<Doc<"prospects">, "tabletteMode">,
): ClosingMilestoneKey[] {
  const required: ClosingMilestoneKey[] = [...MANDATORY_CLOSING_MILESTONES];
  if (prospect.tabletteMode === "achat_kb") {
    required.push(CONDITIONAL_TABLETTE_MILESTONE);
  }
  return required;
}

/** Result of the pure Closing evaluation. */
export type ClosingEvaluation = {
  /** All applicable Closing milestones achieved → the auto-bascule may fire. */
  complete: boolean;
  /** The applicable Closing milestones not yet achieved (empty iff complete). */
  missing: ClosingMilestoneKey[];
};

/** A binary milestone is achieved iff its timestamp is present (table/prospects.ts). */
function achieved(milestones: Milestones, key: ClosingMilestoneKey): boolean {
  return milestones[key] !== undefined;
}

/**
 * PURE composite Closing evaluator (no DB). Returns whether the Closing event is
 * complete plus the applicable milestones still missing. The tablette-invoice
 * milestone is applicable ONLY when `prospect.tabletteMode = achat_kb`; for any
 * other mode it is dropped from the required set entirely (so it can never block).
 */
export function evaluateClosing(prospect: Doc<"prospects">): ClosingEvaluation {
  const required = requiredClosingMilestones(prospect);
  const milestones = prospect.milestones ?? {};
  const missing = required.filter((key) => !achieved(milestones, key));
  return { complete: missing.length === 0, missing };
}

/**
 * The canonical pipeline phase order (kb-admin CONTEXT "Phase pipeline"). A legal
 * transition is a SINGLE forward step along this chain.
 */
export const PHASE_ORDER: readonly ProspectPhase[] = [
  "acquisition",
  "preparation",
  "installation",
  "operationnel",
];

/** Whether `from → to` is a single forward step in the pipeline. Pure — no DB. */
export function isLegalPhaseTransition(
  from: ProspectPhase,
  to: ProspectPhase,
): boolean {
  const fromIdx = PHASE_ORDER.indexOf(from);
  const toIdx = PHASE_ORDER.indexOf(to);
  return fromIdx !== -1 && toIdx === fromIdx + 1;
}

/**
 * Throw `INVALID_STATE` unless `from → to` is a single forward step. Centralises
 * the state-machine guard so a skip-ahead, a backward step, or a self-loop is
 * rejected, never silently applied (mirrors `ordersStore.assertLegalTransition`).
 */
export function assertLegalPhaseTransition(
  from: ProspectPhase,
  to: ProspectPhase,
): void {
  if (!isLegalPhaseTransition(from, to)) {
    throw new ConvexError({
      code: "INVALID_STATE",
      message: `Illegal pipeline transition "${from}" → "${to}".`,
    });
  }
}

/** Outcome of an `applyClosing` attempt. */
type ApplyClosingResult = {
  /** Whether the auto-bascule actually fired (Acquisition → Préparation). */
  basculed: boolean;
  /** The prospect's phase AFTER the attempt. */
  phase: ProspectPhase;
  /** Closing milestones still missing (empty when Closing is complete). */
  missing: ClosingMilestoneKey[];
};

/**
 * Evaluate the composite Closing event and, IF it is complete AND the prospect is
 * still in `acquisition`, auto-advance it to `preparation` — the ONLY automatic
 * pipeline transition (kb-admin CONTEXT "Closing"). Idempotent: a prospect already
 * past Acquisition is a no-op (the single auto edge `acquisition → preparation`
 * does not apply), as is one whose Closing is not yet complete. Returns whether
 * the bascule fired, the resulting phase, and any missing milestones.
 *
 * The transition is GUARDED by `assertLegalPhaseTransition` (defence in depth —
 * the edge is always `acquisition → preparation`, a legal single step) and the
 * actual bascule is recorded with an explicit `prospect.closing.autoBascule`
 * audit row (on top of the wrapper's automatic root-mutation audit).
 */
export const applyClosing = kbAdminMutation({
  args: { prospectId: v.id("prospects") },
  action: "prospect.closing.evaluate",
  handler: async (ctx, args): Promise<ApplyClosingResult> => {
    const prospect = await getProspectRow(ctx, args.prospectId);
    if (prospect === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Prospect not found.",
      });
    }

    const { complete, missing } = evaluateClosing(prospect);

    // The auto-bascule fires ONLY from Acquisition, and only when Closing is
    // complete. Any other current phase = no-op (the single auto edge does not
    // apply); a manual move elsewhere is the slice-B path, untouched here.
    if (!complete || prospect.phase !== "acquisition") {
      return { basculed: false, phase: prospect.phase, missing };
    }

    const to: ProspectPhase = "preparation";
    assertLegalPhaseTransition(prospect.phase, to);
    await setProspectPhase(ctx, args.prospectId, to);

    await logAudit(ctx, {
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: "prospect.closing.autoBascule",
      targetType: "prospect",
      targetId: args.prospectId,
      metadata: { fromPhase: prospect.phase, toPhase: to },
    });

    return { basculed: true, phase: to, missing: [] };
  },
});
