import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { APP_CONFIG_SINGLETON_KEY } from "../../table/appConfig";

/**
 * #394 — the SANCTIONED data-access seam for the `appConfig` singleton (cf.
 * `convex/table/appConfig.ts` header). Business code in `convex/lib/app` reads
 * the singleton through these helpers; raw `ctx.db.query("appConfig")` is
 * forbidden by `no-untenanted-query` (the `convex/lib/tenancy/**` path is the
 * single sanctioned `ctx.db` site for store seams).
 *
 * V1 has ONE row, keyed by the literal `"singleton"` on the `by_singleton`
 * index — `.unique()` is O(1) and never returns more than one document.
 *
 * Defaults: a missing row resolves to `minSupportedBuildVersion === 1`. Every
 * binary KB ever shipped has `nativeBuildVersion >= 1`, so a fresh deployment
 * with no row set never blocks anyone (the safe baseline).
 */

/** Safe default returned when no singleton row exists yet (fresh deploy). */
export const DEFAULT_MIN_SUPPORTED_BUILD_VERSION = 1;

/**
 * Read the current `minSupportedBuildVersion`, or the safe default `1` when no
 * row exists yet. Used by the public `app.minBuildVersion()` query the native
 * boot gate (PRD 20 §13, ADR 0017 « couche native ») calls before auth.
 */
export async function readMinSupportedBuildVersion(
  ctx: QueryCtx | MutationCtx,
): Promise<number> {
  const row = await ctx.db
    .query("appConfig")
    .withIndex("by_singleton", (q) => q.eq("key", APP_CONFIG_SINGLETON_KEY))
    .unique();
  return row?.minSupportedBuildVersion ?? DEFAULT_MIN_SUPPORTED_BUILD_VERSION;
}

/**
 * UPSERT `minSupportedBuildVersion` on the singleton row. Called from the
 * sanctioned `kbAdminMutation` only (the wrapper enforces the kb_admin gate +
 * writes the audit row). `value` MUST be an integer ≥ 1 — the wrapper validates
 * the arg shape; the helper trusts what it receives.
 */
export async function setMinSupportedBuildVersion(
  ctx: MutationCtx,
  value: number,
): Promise<void> {
  const now = Date.now();
  const row = await ctx.db
    .query("appConfig")
    .withIndex("by_singleton", (q) => q.eq("key", APP_CONFIG_SINGLETON_KEY))
    .unique();

  if (row === null) {
    await ctx.db.insert("appConfig", {
      key: APP_CONFIG_SINGLETON_KEY,
      minSupportedBuildVersion: value,
      updatedAt: now,
    });
    return;
  }

  await ctx.db.patch(row._id, {
    minSupportedBuildVersion: value,
    updatedAt: now,
  });
}
