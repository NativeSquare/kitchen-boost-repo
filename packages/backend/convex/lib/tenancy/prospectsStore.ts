import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { Infer } from "convex/values";
import {
  type acquisitionSource,
  type prospectPhase,
} from "../../table/prospects";

/**
 * 2.9-B — the SANCTIONED data-access seam for the KB-ADMIN-GLOBAL `prospects`
 * table (ADR 0010 documented exemption, exactly like `customerFiche.ts` for the
 * GLOBAL `customers` table).
 *
 * `prospects` is KB's OWN onboarding pipeline, owned by the `kb_admin` (root)
 * role; it carries NO `tenantId` scoping key (the optional `tenantId` is a
 * BACK-LINK, not a tenancy boundary — table/prospects.ts). It is therefore reached
 * ONLY through the root wrappers (`kbAdminQuery/Mutation`), never raw
 * `ctx.db.query("prospects")` in business code (`no-untenanted-query`, 1.x-H).
 * This file lives in the EXEMPT `convex/lib/tenancy/**` path — the single
 * sanctioned `ctx.db` site for the table — so the business module
 * `lib/onboarding/**` (NOT exempt) calls THESE helpers instead of `ctx.db`.
 *
 * Slice scope: CRM CRUD + manual phase change only. The pipeline state machine
 * (transitions + `evaluateClosing`) is slice C — not modelled here.
 */

type AcquisitionSource = Infer<typeof acquisitionSource>;
type ProspectPhase = Infer<typeof prospectPhase>;

/** The mutable identity / pipeline fields an `editProspect` may patch. */
export type ProspectPatch = Partial<
  Pick<
    Doc<"prospects">,
    | "name"
    | "siret"
    | "address"
    | "contactName"
    | "email"
    | "phone"
    | "source"
    | "score"
    | "tabletteMode"
    | "milestones"
  >
>;

/** The minimal fields needed to create a prospect (PRD 70 §3.4). */
export type NewProspect = {
  name: string;
  phone: string;
  source: AcquisitionSource;
  score?: number;
  tabletteMode?: Doc<"prospects">["tabletteMode"];
};

/** One interaction to append to a prospect's history (note + canal; date stamped here). */
export type NewInteraction = {
  note: string;
  canal: AcquisitionSource;
};

/**
 * Insert a fresh prospect, defaulting `phase` to `acquisition` (PRD 70 §3.3 — a
 * new prospect enters at Acquisition). Stamps `createdAt`/`updatedAt`. Returns
 * the new row id.
 */
export async function insertProspect(
  ctx: MutationCtx,
  body: NewProspect,
): Promise<Id<"prospects">> {
  const now = Date.now();
  return ctx.db.insert("prospects", {
    name: body.name,
    phone: body.phone,
    phase: "acquisition",
    source: body.source,
    score: body.score,
    tabletteMode: body.tabletteMode,
    createdAt: now,
    updatedAt: now,
  });
}

/** Read one prospect by id, or `null` if it vanished. */
export async function getProspect(
  ctx: QueryCtx | MutationCtx,
  prospectId: Id<"prospects">,
): Promise<Doc<"prospects"> | null> {
  return ctx.db.get(prospectId);
}

/**
 * List prospects, optionally filtered to one `phase` via the `by_phase` index
 * (the Kanban column read, PRD 70 §3.3/§3.4). No filter → the whole table.
 */
export async function listProspects(
  ctx: QueryCtx | MutationCtx,
  phase?: ProspectPhase,
): Promise<Doc<"prospects">[]> {
  if (phase !== undefined) {
    return ctx.db
      .query("prospects")
      .withIndex("by_phase", (q) => q.eq("phase", phase))
      .collect();
  }
  return ctx.db.query("prospects").collect();
}

/** Patch a prospect's mutable fields. Bumps `updatedAt`. */
export async function patchProspect(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
  patch: ProspectPatch,
): Promise<void> {
  await ctx.db.patch(prospectId, { ...patch, updatedAt: Date.now() });
}

/**
 * Append one interaction (note + date + canal) to a prospect's interaction log
 * (PRD 70 §3.4 "log interaction"). Reads the current list, appends, writes back —
 * the date is stamped here so the caller never forges it. Bumps `updatedAt`.
 */
export async function appendInteraction(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
  interaction: NewInteraction,
): Promise<void> {
  const prospect = await ctx.db.get(prospectId);
  if (prospect === null) {
    throw new Error("Prospect not found.");
  }
  const interactions = prospect.interactions ?? [];
  await ctx.db.patch(prospectId, {
    interactions: [
      ...interactions,
      { note: interaction.note, date: Date.now(), canal: interaction.canal },
    ],
    updatedAt: Date.now(),
  });
}

/** Set a prospect's pipeline `phase` (manual change). Bumps `updatedAt`. */
export async function setProspectPhase(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
  phase: ProspectPhase,
): Promise<void> {
  await ctx.db.patch(prospectId, { phase, updatedAt: Date.now() });
}

/**
 * 2.9-B seed — find an existing prospect by phone (the natural key the seed
 * dedups on, so re-running the import inserts no duplicates). Returns `null`
 * when none exists yet. There is no `by_phone` index (phone is not a query path
 * in V1), so this is a small full-scan — fine for the one-shot seed of a tiny
 * pipeline.
 */
export async function findProspectByPhone(
  ctx: QueryCtx | MutationCtx,
  phone: string,
): Promise<Doc<"prospects"> | null> {
  const all = await ctx.db.query("prospects").collect();
  return all.find((p) => p.phone === phone) ?? null;
}
