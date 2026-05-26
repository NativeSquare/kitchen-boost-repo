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
