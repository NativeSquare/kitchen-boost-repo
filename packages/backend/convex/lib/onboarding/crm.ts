import { v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  acquisitionSource,
  milestones,
  prospectPhase,
  tabletteMode,
} from "../../table/prospects";
import {
  appendInteraction,
  getProspect as getProspectRow,
  insertProspect,
  kbAdminMutation,
  kbAdminQuery,
  listProspects as listProspectRows,
  logAudit,
  patchProspect,
  setProspectPhase,
} from "../tenancy";
import { missingMilestonesForPhase } from "./gates";

/**
 * 2.9-B — minimalist CRM KB CRUD over the KB-ADMIN-GLOBAL `prospects` table
 * (PRD 70 §3.4, kb-admin CONTEXT "CRM (KB interne)").
 *
 * Prospects are KB's OWN sales / onboarding pipeline, owned by the `kb_admin`
 * (root) role — so EVERY function here goes through `kbAdminQuery` /
 * `kbAdminMutation` (root scope); a `kb_manager` / `staff` / `customer` is refused
 * (Forbidden). The table is reached ONLY through the sanctioned
 * `lib/tenancy/prospectsStore` seam — never raw `ctx.db` in this business module
 * (`no-untenanted-query`, ADR 0010). Identity flows only through the wrappers'
 * `getCurrentActor` (ADR 0011). Every `kbAdminMutation` is auto-audited by the
 * foundation (STACK.md §6.4).
 *
 * Manual phase change + CRUD ONLY (the issue): the pipeline state machine
 * (transitions + `evaluateClosing`) is slice C. Gates are INDICATIVE in V1
 * (Q70-Q10) — a phase change is never blocked, but moving into a phase with a
 * missing required milestone records a BYPASS audit row.
 *
 * No UI here (the Kanban / CRM cards are front Train B). No invented prospect
 * lifecycle fields — every field/enum is the schema's (table/prospects.ts).
 */

/** Create a prospect (PRD 70 §3.4). Defaults `phase` to `acquisition`. */
export const createProspect = kbAdminMutation({
  args: {
    name: v.string(),
    phone: v.string(),
    source: acquisitionSource,
    score: v.optional(v.number()),
    tabletteMode: v.optional(tabletteMode),
  },
  action: "prospect.create",
  handler: async (ctx, args): Promise<Id<"prospects">> =>
    insertProspect(ctx, {
      name: args.name,
      phone: args.phone,
      source: args.source,
      score: args.score,
      tabletteMode: args.tabletteMode,
    }),
});

/**
 * Edit a prospect's mutable fields (identity + score + tabletteMode + milestones).
 * A `patch` only carries the fields to change; absent fields are left intact.
 * `milestones` is replaced wholesale (the granular milestone toggles are slice C).
 */
export const editProspect = kbAdminMutation({
  args: {
    prospectId: v.id("prospects"),
    patch: v.object({
      name: v.optional(v.string()),
      siret: v.optional(v.string()),
      address: v.optional(v.string()),
      contactName: v.optional(v.string()),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      source: v.optional(acquisitionSource),
      score: v.optional(v.number()),
      tabletteMode: v.optional(tabletteMode),
      // Reuse the schema's milestone validator (single source of truth — the
      // business module can't drift from table/prospects.ts). Replaced wholesale;
      // granular per-milestone toggles are slice C.
      milestones: v.optional(milestones),
    }),
  },
  action: "prospect.edit",
  handler: async (ctx, args): Promise<void> => {
    await patchProspect(ctx, args.prospectId, args.patch);
  },
});

/** Log an interaction (note + canal) appended to the prospect's history (PRD 70 §3.4). */
export const logInteraction = kbAdminMutation({
  args: {
    prospectId: v.id("prospects"),
    note: v.string(),
    canal: acquisitionSource,
  },
  action: "prospect.logInteraction",
  handler: async (ctx, args): Promise<void> => {
    await appendInteraction(ctx, args.prospectId, {
      note: args.note,
      canal: args.canal,
    });
  },
});

/**
 * Manually change a prospect's pipeline `phase`. ALWAYS allowed (gates are
 * indicative in V1, Q70-Q10). If the target phase's required milestones are not
 * all met, the change is a BYPASS: it still happens, but a `prospect.changePhase.bypass`
 * audit row is recorded with the missing milestones (audit via foundation, the
 * acceptance criterion). Returns whether it was a bypass + which milestones were
 * missing (so the front can warn). The `kbAdminMutation` itself auto-logs the
 * `prospect.changePhase` action; the explicit log adds the richer bypass metadata.
 */
export const changePhase = kbAdminMutation({
  args: { prospectId: v.id("prospects"), phase: prospectPhase },
  action: "prospect.changePhase",
  handler: async (
    ctx,
    args,
  ): Promise<{ bypassed: boolean; missing: string[] }> => {
    const prospect = await getProspectRow(ctx, args.prospectId);
    if (prospect === null) {
      throw new Error("Prospect not found.");
    }

    const missing = missingMilestonesForPhase(prospect, args.phase);
    await setProspectPhase(ctx, args.prospectId, args.phase);

    if (missing.length > 0) {
      // Indicative gate bypassed — record it (gates are not enforced V1, but the
      // bypass MUST be audited, acceptance criterion + Q70-Q10).
      await logAudit(ctx, {
        actorUserId: ctx.actor.userId,
        actorRole: ctx.actor.role,
        action: "prospect.changePhase.bypass",
        targetType: "prospect",
        targetId: args.prospectId,
        metadata: {
          fromPhase: prospect.phase,
          toPhase: args.phase,
          missing,
        },
      });
    }

    return { bypassed: missing.length > 0, missing };
  },
});

/** Read one prospect by id (root, PRD 70 §3.4 click → detail). */
export const getProspect = kbAdminQuery({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, args): Promise<Doc<"prospects"> | null> =>
    getProspectRow(ctx, args.prospectId),
});

/** List prospects, optionally filtered by `phase` (the Kanban columns, PRD 70 §3.3/§3.4). */
export const listProspects = kbAdminQuery({
  args: { phase: v.optional(prospectPhase) },
  handler: async (ctx, args): Promise<Doc<"prospects">[]> =>
    listProspectRows(ctx, args.phase),
});
