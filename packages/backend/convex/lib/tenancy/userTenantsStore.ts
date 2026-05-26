import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type { TenantRole } from "./withTenant";

/**
 * 2.9-E — the SANCTIONED data-access seam for the N-N `userTenants` link table
 * from the tenant provisioning wizard (`lib/onboarding/provisioning.ts`). ADR
 * 0010: the business module never touches raw `ctx.db` (`no-untenanted-query`) —
 * it routes the "attach KB Manager to tenant" step through these helpers, which
 * live in the exempt `convex/lib/tenancy/**` path (alongside the fuzz fixture
 * which seeds the same rows).
 *
 * `userTenants` is the source of truth of WHICH tenants a user may access and
 * with WHICH resto role (`kb_manager` / `staff`, PRD 50 §1.1, ADR 0011) — the
 * same table `getCurrentActor` reads to resolve a caller's `effectiveRole`. A
 * `kb_admin` (root) has NO row here; a `customer` neither. An attachment is
 * soft-detachable (`detachedAt`); an ACTIVE attachment is one without it.
 */

/**
 * The ACTIVE attachment of `userId` to `tenantId` (or `null`). Keyed on
 * `by_user_tenant`. "Active" = not soft-detached (`detachedAt` absent) — a
 * revoked attachment does not grant access (mirrors `getCurrentActor`). Used to
 * keep the attach step idempotent (no duplicate link on a re-run).
 */
export async function getActiveUserTenant(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  tenantId: Id<"tenants">,
): Promise<Doc<"userTenants"> | null> {
  const link = await ctx.db
    .query("userTenants")
    .withIndex("by_user_tenant", (q) =>
      q.eq("userId", userId).eq("tenantId", tenantId),
    )
    .unique();
  if (link === null || link.detachedAt !== undefined) return null;
  return link;
}

/**
 * Attach `userId` to `tenantId` with the given resto `role`, recording who made
 * the attachment (`attachedBy`, audit). Stamps `attachedAt`. Returns the new link
 * id. The CALLER (a root `kbAdminMutation` handler) has already gated access.
 */
export async function attachUserToTenant(
  ctx: MutationCtx,
  args: {
    userId: Id<"users">;
    tenantId: Id<"tenants">;
    role: TenantRole;
    attachedBy: Id<"users">;
  },
): Promise<Id<"userTenants">> {
  return ctx.db.insert("userTenants", {
    userId: args.userId,
    tenantId: args.tenantId,
    role: args.role,
    attachedAt: Date.now(),
    attachedBy: args.attachedBy,
  });
}
