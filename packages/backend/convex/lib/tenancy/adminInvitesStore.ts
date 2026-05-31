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

/**
 * F-WIZARD [9/10] (#273) — read the LATEST manager invite for a tenant (any
 * acceptedAt / expiresAt). Used by the wizard's Step 7 to surface the
 * « invitation envoyée » state + by `useWizardState` as the completion gate
 * for step 7 (issue spec: « le hook marque step 7 complete si une ligne
 * managerInvites existe pour le tenant, peu importe acceptedAt »).
 *
 * Filters on `targetRole === "kb_manager"` so legacy admin invites (no
 * targetRole, no tenantId) never surface — the `by_email_tenant` index keys
 * `(email, tenantId)` and the legacy rows have `tenantId === undefined`, so
 * they're not returned by the `eq("tenantId", ...)` lookup anyway, but we
 * keep the targetRole filter as a defensive narrowing.
 *
 * Orders by `_creationTime` desc and returns the head — Convex indexes are
 * sorted ascending by default; we use `.order("desc")` to flip and `.first()`
 * to grab the most recently created row.
 *
 * There is no dedicated `by_tenant` index for manager invites — we reuse the
 * existing `by_email_tenant` compound by collecting all rows for the tenant
 * and selecting the latest. V1 cardinality is bounded by the wizard flow
 * itself (one operator-driven invite per (email, tenantId), relance replaces
 * the row), so the scan is O(few) per tenant. A dedicated `by_tenant` index
 * can land later if a tenant's invite history grows unbounded.
 */
export async function getLatestManagerInviteForTenant(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"adminInvites"> | null> {
  // There is no dedicated `by_tenant` index for manager invites today —
  // the wizard tenant has at most a handful of invites (one per operator
  // action; the `(email, tenantId)` dedupes via `by_email_tenant`), so a
  // full collect filtered in-memory is correct and bounded. A dedicated
  // `by_tenant` schema index can land later if a tenant's invite history
  // grows unbounded.
  const all = await ctx.db.query("adminInvites").collect();
  const tenantRows = all.filter(
    (r) => r.tenantId === tenantId && r.targetRole === "kb_manager",
  );
  if (tenantRows.length === 0) return null;
  tenantRows.sort((a, b) => b._creationTime - a._creationTime);
  return tenantRows[0] ?? null;
}
