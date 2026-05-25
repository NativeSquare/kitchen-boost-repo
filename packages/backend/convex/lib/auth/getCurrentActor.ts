import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../../_generated/server";

/**
 * 1.x-B — getCurrentActor: the SINGLE integration point with Convex Auth.
 *
 * Per ADR 0011 (identité encapsulée), this is the ONLY place in the codebase
 * allowed to call `getAuthUserId`. Every business wrapper
 * (`tenantQuery` / `tenantMutation` / `kbAdminQuery`, story 1.x-C) consumes the
 * normalised actor this returns — no business module talks to Convex Auth
 * directly. Swapping the IdP later (WorkOS, cf. ADR 0011) = rewrite this one
 * function, not the whole codebase.
 */

/** Global role carried on `users.role`. */
export type GlobalRole = "kb_admin" | "customer";

/**
 * Effective role on a given tenant:
 *  - `kb_admin` — root, unlimited access to every tenant (no `userTenants` row).
 *  - `kb_manager` / `staff` — resto-scoped, resolved from `userTenants.role`.
 *  - `null` — caller has no (active) role on that tenant, or no tenant was asked.
 */
export type EffectiveRole = "kb_admin" | "kb_manager" | "staff" | null;

/**
 * Normalised identity of an AUTHENTICATED caller. The wrappers story (1.x-C)
 * references this directly once it has narrowed out the unauthenticated case.
 */
export type Actor = {
  userId: Id<"users">;
  /** Global role (kb_admin / customer). Resto roles live per-tenant. */
  role: GlobalRole;
  isAnonymous: boolean;
  /** Effective role on the `tenantId` passed to `getCurrentActor`, else null. */
  effectiveRole: EffectiveRole;
};

/** Result of `getCurrentActor`. `null` = unauthenticated caller. */
export type CurrentActor = Actor | null;

/**
 * Resolve the normalised identity of the caller, plus — when `tenantId` is
 * supplied — the caller's effective role on that tenant.
 *
 * Resolution rules:
 *  - No Convex Auth identity → `null` (unauthenticated).
 *  - User row missing for the auth id → `null` (treat as unauthenticated).
 *  - Global `role` defaults to `customer` when the field is absent.
 *  - `effectiveRole`:
 *      • no `tenantId` → `null`
 *      • global `kb_admin` → `kb_admin` on ANY tenant, no `userTenants` row
 *      • otherwise the role of the user's ACTIVE `userTenants` row for that
 *        tenant (a row with `detachedAt` set is ignored), else `null`.
 *
 * This is the sanctioned `getAuthUserId` call site (ADR 0011) — do NOT call
 * `getAuthUserId` anywhere else.
 */
export async function getCurrentActor(
  ctx: QueryCtx | MutationCtx,
  tenantId?: Id<"tenants">,
): Promise<CurrentActor> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;

  const user = await ctx.db.get(userId);
  if (user === null) return null;

  const role: GlobalRole = user.role ?? "customer";
  const isAnonymous = user.isAnonymous ?? false;

  return {
    userId,
    role,
    isAnonymous,
    effectiveRole: await resolveEffectiveRole(ctx, userId, role, tenantId),
  };
}

/** Resolve the effective role on `tenantId`. Private to the module. */
async function resolveEffectiveRole(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  globalRole: GlobalRole,
  tenantId?: Id<"tenants">,
): Promise<EffectiveRole> {
  if (tenantId === undefined) return null;

  // kb_admin (root) has unlimited access and carries NO userTenants row.
  if (globalRole === "kb_admin") return "kb_admin";

  const attachment = await ctx.db
    .query("userTenants")
    .withIndex("by_user_tenant", (q) =>
      q.eq("userId", userId).eq("tenantId", tenantId),
    )
    .unique();

  // No row, or a detached one, grants no effective role on this tenant.
  if (attachment === null || attachment.detachedAt !== undefined) return null;

  return attachment.role;
}

/**
 * `whoAmI` — public probe exposing the normalised actor for the current
 * session (optionally scoped to a tenant). Drives the frontend auth guard /
 * tenant switcher and is the seam the 1.x-B test suite exercises. Read-only and
 * self-scoped (returns only the caller's own identity), so it is safe to expose
 * before the `withTenant` wrappers (1.x-C) exist.
 */
export const whoAmI = query({
  args: { tenantId: v.optional(v.id("tenants")) },
  handler: async (ctx, args) => getCurrentActor(ctx, args.tenantId),
});
