import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.1-C — the SANCTIONED data-access seam for the GLOBAL `cgvVersions` table (the
 * CNIL-proof CGV archive, ADR 0007).
 *
 * `cgvVersions` carries NO `tenantId` (one standard KB wording in V1; per-resto
 * bespoke CGV is V2), so — exactly like `customers` — it is reached through the
 * tenancy wrappers, never raw `ctx.db.query("cgvVersions")` in business code
 * (`no-untenanted-query`, 1.x-H). This file lives in the EXEMPT
 * `convex/lib/tenancy/**` path, so it is the single sanctioned place raw `ctx.db`
 * touches `cgvVersions`. Business modules (`lib/customer/cgv`, NOT exempt) call
 * THESE helpers instead of `ctx.db`.
 *
 * INVARIANT (enforced by `publishCgvVersion`): at most one ACTIVE version (a row
 * with `endedAt === undefined`) at a time.
 */

/**
 * The single currently-active CGV version (no `endedAt`), or `null` if none has
 * been published yet. Resolved via the `by_activatedAt` index, newest first, so
 * even if the one-active invariant were ever violated we still return the most
 * recently activated one.
 */
export async function readActiveCgvVersion(
  ctx: QueryCtx | MutationCtx,
): Promise<Doc<"cgvVersions"> | null> {
  return ctx.db
    .query("cgvVersions")
    .withIndex("by_activatedAt")
    .order("desc")
    .filter((q) => q.eq(q.field("endedAt"), undefined))
    .first();
}

/**
 * Close (set `endedAt`) every still-active CGV version. Called by
 * `publishCgvVersion` BEFORE inserting the new one so exactly one version stays
 * active. Defensive: closes ALL active rows, not just the expected single one.
 */
export async function closeActiveCgvVersions(
  ctx: MutationCtx,
  endedAt: number,
): Promise<void> {
  const active = await ctx.db
    .query("cgvVersions")
    .withIndex("by_activatedAt")
    .filter((q) => q.eq(q.field("endedAt"), undefined))
    .collect();
  for (const v of active) {
    await ctx.db.patch(v._id, { endedAt });
  }
}

/** Insert a fresh active CGV version (no `endedAt`). Returns the new row id. */
export async function insertCgvVersion(
  ctx: MutationCtx,
  version: { wording: string; hash: string; activatedAt: number },
): Promise<Id<"cgvVersions">> {
  return ctx.db.insert("cgvVersions", version);
}
