import type { Infer } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  acquisitionSource,
  hubriseStatus,
  prospectPhase,
  stripeConnectStatus,
  uberDirectStatus,
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
 * 2.9-E — set the BACK-LINK from a prospect to the tenant it was provisioned into
 * (`prospect.tenantId`, table/prospects.ts — NOT a tenancy scoping key, just the
 * `by_tenant` prospect → tenant lookup). The wizard calls this once the tenant
 * exists, so the originating prospect points at its live tenant. Bumps
 * `updatedAt`.
 */
export async function setProspectTenant(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
  tenantId: Id<"tenants">,
): Promise<void> {
  await ctx.db.patch(prospectId, { tenantId, updatedAt: Date.now() });
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

// ── B-ONBOARDING-MILESTONES slice 1 (#163) granular milestone seams ────────────
//
// These two helpers are the SOLE sanctioned sites that mutate a SINGLE key of
// `milestones` (binary timestamp) or APPEND one entry to an integration's
// `history[]` (composite, append-only). They underpin the upcoming `setMilestone`
// / `recordIntegrationStatus` granular mutations of issue #138 (parent epic) so
// the front-end checklist can flip one milestone without round-tripping the whole
// `milestones` object — race-free because Convex serialises every mutation.
//
// The seam stays THIN on purpose: argument validation (e.g. checking that
// `status` is in the right per-integration union) is the caller's job (the
// `kbAdminMutation` wrapper validates `args` via its convex `v.union(...)`
// validator at the boundary, ADR 0011). What we DO enforce here is the
// TypeScript discipline: `BinaryMilestoneKey` excludes the composite integration
// keys, and `IntegrationStatusMap` ties each integration to its OWN status union
// (no cross-integration status mix-up). Both types are DERIVED from the schema
// (`Doc<"prospects">["milestones"]` + per-status `Infer<>`) — single source of
// truth, never a duplicated string-literal union.
//
// Atomicity: each helper does ONE read + ONE patch on the same prospect inside a
// Convex mutation, so the read-modify-write is a single transaction (no race
// even between concurrent KB Admin clicks).

/** A binary (timestamped) milestone key — every `milestones.*` field whose value is `number | undefined`. */
type Milestones = NonNullable<Doc<"prospects">["milestones"]>;
export type BinaryMilestoneKey = {
  [K in keyof Milestones]-?: NonNullable<Milestones[K]> extends number
    ? K
    : never;
}[keyof Milestones];

/** Status union per integration — derived from the schema's per-integration `v.union(...)`. */
export type IntegrationStatusMap = {
  stripeConnect: Infer<typeof stripeConnectStatus>;
  uberDirect: Infer<typeof uberDirectStatus>;
  hubrise: Infer<typeof hubriseStatus>;
};

/** The 3 composite integration milestone keys (the only ones with `current` + `history[]`). */
export type IntegrationKey = keyof IntegrationStatusMap;

/**
 * The persisted shape of an integration milestone for integration `I`: current
 * status + append-only chronological history. Mirrors the per-integration
 * `*Milestone` schema in `table/prospects.ts`; centralised here so both the
 * read narrowing and the write payload of `appendIntegrationStatus` share ONE
 * definition.
 */
type IntegrationMilestone<I extends IntegrationKey> = {
  current: IntegrationStatusMap[I];
  history: { status: IntegrationStatusMap[I]; at: number }[];
};

/**
 * Set or clear the timestamp of ONE binary milestone (read prospect → patch
 * `milestones` with the single targeted key → bump `updatedAt`). Pass a
 * `number` to record the achievement instant, or `undefined` to clear it
 * (uncheck). NEVER touches any other milestone — neither the other binary
 * keys nor the composite integration sub-objects. Throws `Prospect not found`
 * when the row vanished.
 *
 * Caller (a `kbAdminMutation`, the only path to this seam in business code) is
 * responsible for validating `key` against the exhaustive binary-milestone
 * union at the boundary; this seam trusts the typed contract.
 */
export async function setMilestoneTimestamp<K extends BinaryMilestoneKey>(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
  key: K,
  value: number | undefined,
): Promise<void> {
  const prospect = await ctx.db.get(prospectId);
  if (prospect === null) {
    throw new Error("Prospect not found.");
  }
  const milestones = { ...(prospect.milestones ?? {}) };
  if (value === undefined) {
    delete milestones[key];
  } else {
    milestones[key] = value;
  }
  await ctx.db.patch(prospectId, {
    milestones,
    updatedAt: Date.now(),
  });
}

/**
 * Append one transition to a composite integration milestone: set
 * `milestones[integration].current = status` AND append `{status, at}` to its
 * `history[]`. If the integration sub-object does not yet exist on this
 * prospect, it is CREATED with `current = status` and `history = [{status, at}]`.
 * NEVER touches the other two integrations nor any binary milestone — only the
 * targeted integration's `current` + `history` change.
 *
 * `history` is APPEND-ONLY (oscillations such as `pending_kyc → verified →
 * rejected → pending_kyc → verified` produce one entry each, in chronological
 * order). The status type is constrained PER integration via the discriminated
 * `IntegrationStatusMap` so a `uberDirect` status can never land on the
 * `stripeConnect` sub-object at compile time.
 *
 * Throws `Prospect not found` when the row vanished.
 */
export async function appendIntegrationStatus<I extends IntegrationKey>(
  ctx: MutationCtx,
  prospectId: Id<"prospects">,
  integration: I,
  status: IntegrationStatusMap[I],
  at: number,
): Promise<void> {
  const prospect = await ctx.db.get(prospectId);
  if (prospect === null) {
    throw new Error("Prospect not found.");
  }
  const milestones = { ...(prospect.milestones ?? {}) };
  const existing = milestones[integration] as
    | IntegrationMilestone<I>
    | undefined;
  const nextHistory = [...(existing?.history ?? []), { status, at }];
  // The cast pins the per-integration discriminated payload — the schema
  // declares `milestones[integration]` as a union of the 3 distinct shapes; this
  // type-level narrowing is what `IntegrationStatusMap[I]` guarantees.
  (milestones as Record<I, IntegrationMilestone<I>>)[integration] = {
    current: status,
    history: nextHistory,
  };
  await ctx.db.patch(prospectId, {
    milestones,
    updatedAt: Date.now(),
  });
}
