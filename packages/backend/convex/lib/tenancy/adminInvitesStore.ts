import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * B-AUTH-4 (#204, EPIC #134) — the SANCTIONED data-access seam for the shared
 * `adminInvites` table from the `inviteManager` business module
 * (`lib/admin/managerInvites.ts`). ADR 0010: that module never touches raw
 * `ctx.db` (`no-untenanted-query`) — it routes every invite read / create /
 * delete through these helpers, which live in the exempt
 * `convex/lib/tenancy/**` path.
 *
 * `adminInvites` is shared (B-AUTH-3 schema extension, PR #180): a legacy row
 * with no `targetRole`/`tenantId` is an admin invite; a row with
 * `targetRole: "kb_manager"` + `tenantId` is a manager invite. Existing flows
 * (`inviteAdmin`, `getInvite`, …) keep using raw `ctx.db` from
 * `convex/table/admin.ts` (the `convex/table/**` path is itself an exempt
 * sanctioned site) — this seam exists specifically for `lib/admin/**`
 * consumers, which are NOT exempt.
 *
 * The mutations are intentionally dumb stores: they do persistence only. Auth,
 * validation (duplicate active membership, pending guard, relance), token
 * generation and audit live in the caller (`lib/admin/managerInvites.ts`).
 */

/** The minimal fields needed to insert a kb_manager invite (B-AUTH-4). */
export type NewManagerInvite = {
  email: string;
  name: string;
  token: string;
  invitedBy: Id<"users">;
  expiresAt: number;
  tenantId: Id<"tenants">;
};

/**
 * The pending invite for `(email, tenantId)` (or `null`). Keyed on the new
 * `by_email_tenant` compound index added in B-AUTH-3 — used by the caller to
 * implement BOTH the pending guard (non-expired ⇒ refuse) AND the relance path
 * (expired ⇒ delete + re-create). Caller decides; this seam only reads.
 */
export async function getManagerInviteForTenant(
  ctx: QueryCtx | MutationCtx,
  email: string,
  tenantId: Id<"tenants">,
): Promise<Doc<"adminInvites"> | null> {
  return ctx.db
    .query("adminInvites")
    .withIndex("by_email_tenant", (q) =>
      q.eq("email", email).eq("tenantId", tenantId),
    )
    .unique();
}

/** Insert a fresh kb_manager invite. Stamps `targetRole: "kb_manager"`. */
export async function insertManagerInvite(
  ctx: MutationCtx,
  body: NewManagerInvite,
): Promise<Id<"adminInvites">> {
  return ctx.db.insert("adminInvites", {
    email: body.email,
    name: body.name,
    token: body.token,
    invitedBy: body.invitedBy,
    expiresAt: body.expiresAt,
    targetRole: "kb_manager",
    tenantId: body.tenantId,
  });
}

/** Delete an invite row (used by the relance path on an expired row). */
export async function deleteAdminInvite(
  ctx: MutationCtx,
  inviteId: Id<"adminInvites">,
): Promise<void> {
  await ctx.db.delete(inviteId);
}
