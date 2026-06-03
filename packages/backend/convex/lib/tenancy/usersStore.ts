import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.9-E — the SANCTIONED data-access seam for the CORE `users` table from the
 * tenant provisioning wizard (`lib/onboarding/provisioning.ts`). ADR 0010: the
 * business module never touches raw `ctx.db` (`no-untenanted-query`) — it routes
 * the "create or reuse a KB Manager user" step through these helpers, which live
 * in the exempt `convex/lib/tenancy/**` path.
 *
 * IMPORTANT (ADR 0011 / PRD 50 §1.1): the resto-scoped role `kb_manager` is NOT a
 * `users.role` — that global enum is only `kb_admin` / `customer`. A KB Manager is
 * a `users` row whose RESTO role lives PER-TENANT on `userTenants` (see
 * `userTenantsStore.ts`). So a freshly-created KB Manager user is inserted with
 * the GLOBAL default role `customer`; its `kb_manager` capability comes solely
 * from the `userTenants` attachment. This is exactly how the fuzz fixture seeds
 * its managers (`fuzz.ts`).
 */

/** The minimal fields needed to create a KB Manager user (email is the key). */
export type NewManagerUser = {
  email: string;
  name?: string;
};

/**
 * The user whose `email` equals `email` (or `null`). Keyed on the `email` index.
 * Used to REUSE an existing user as KB Manager (cas Walid — one user, N tenants)
 * instead of creating a duplicate.
 */
export async function getUserByEmail(
  ctx: QueryCtx | MutationCtx,
  email: string,
): Promise<Doc<"users"> | null> {
  return ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .unique();
}

/**
 * Insert a fresh KB Manager user. The GLOBAL role is `customer` (the lowest
 * privilege) — the `kb_manager` capability is granted exclusively by the
 * per-tenant `userTenants` attachment (ADR 0011), never by `users.role`. Returns
 * the new row id. The actual login credential / magic-link invite is a later
 * Installation milestone (PRD 70 §3.3), out of this slice.
 */
export async function insertManagerUser(
  ctx: MutationCtx,
  body: NewManagerUser,
): Promise<Id<"users">> {
  return ctx.db.insert("users", {
    email: body.email,
    name: body.name,
    role: "customer",
  });
}

/**
 * Does `userId` have a Convex Auth `password` account row attached? This is the
 * proxy for « the user has actually completed sign-up » — i.e. has a working
 * login credential, not just a `users` row stamped by an admin flow.
 *
 * Why this matters (bug AC2 E2E test wizard step 7) : `provisionTenant` (the
 * wizard step 1) creates a bare `users` row from `prospect.email` AND attaches
 * it to the new tenant as `kb_manager` BEFORE the gérant has ever signed up.
 * That gérant still needs the first magic-link to actually create their
 * credentials — but `inviteManager` used to refuse them ALREADY_MEMBER because
 * the `userTenants` link was already active. The distinguant the check was
 * missing : « attached but no credentials yet » (legit first magic-link, allow)
 * vs « attached AND has a working account » (true duplicate, refuse).
 *
 * Convex Auth's `authAccounts` table is the source of truth for "has the user
 * gone through a sign-up provider". The `Password` provider in `auth.ts`
 * inserts an `authAccounts` row with `provider: "password"` on signUp; the
 * `userIdAndProvider` index gives an O(log n) existence lookup.
 *
 * Note (`no-untenanted-query` ADR 0010): the business module `lib/admin/**`
 * cannot touch `ctx.db` directly — that's why this helper lives here in
 * `lib/tenancy/**` (the sanctioned data-access seam), even though
 * `authAccounts` isn't a tenant-scoped table.
 */
export async function hasPasswordAccount(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<boolean> {
  const account = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) =>
      q.eq("userId", userId).eq("provider", "password"),
    )
    .first();
  return account !== null;
}
