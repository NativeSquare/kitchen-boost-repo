import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.1-B — the SANCTIONED self-scoped data-access seam for the GLOBAL `customers`
 * fiche (the MOAT table, ADR 0010 documented exemption).
 *
 * The `customers` table carries NO `tenantId`, so it is reached through the
 * tenancy wrappers, never raw `ctx.db.query("customers")` in business code
 * (`no-untenanted-query`, 1.x-H). This file lives in the EXEMPT
 * `convex/lib/tenancy/**` path — alongside the `customer*` wrappers it serves —
 * so it is the single sanctioned place raw `ctx.db` touches `customers` for the
 * SELF case. Business modules (`lib/customer/**`, NOT exempt) call THESE helpers
 * instead of `ctx.db`, exactly as they resolve identity through `getCurrentActor`
 * rather than `getAuthUserId` (ADR 0011).
 *
 * Both helpers are SELF-SCOPED by construction: they take the caller's own
 * `userId` (sourced from `ctx.actor.userId` in the wrapper handler) and key on
 * the `by_user` index — no other customer's fiche is reachable from here.
 */

/**
 * Read the caller's OWN `customers` fiche by `userId`, or `null` if none exists
 * yet. Keyed on the unique `by_user` index (one fiche per user, enforced
 * applicatively at provisioning).
 */
export async function readCustomerFicheByUser(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<Doc<"customers"> | null> {
  return ctx.db
    .query("customers")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/**
 * Insert a fresh MINIMAL `customers` fiche for `userId` (silent provisioning,
 * ADR 0008): only `userId` + `createdAt`. Every captation field (email / phone /
 * firstName / address / lat / lng / consent / push) is filled later by the
 * checkout + push slices. Returns the new fiche id.
 */
export async function insertCustomerFiche(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<Id<"customers">> {
  return ctx.db.insert("customers", { userId, createdAt: Date.now() });
}
