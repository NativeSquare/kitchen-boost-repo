import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";

/**
 * 2.1-G — the SANCTIONED tenant-scoped data-access seam for the
 * `webPushSubscriptions` table (the persisted RFC 8291 subscription objects, ADR
 * 0012 push split, notifications CONTEXT « Push subscription »).
 *
 * `webPushSubscriptions` carries `tenantId` (web-push is per-origin — « 1 origine
 * = 1 channel »), so business code reaches it ONLY through the tenancy wrappers —
 * never raw `ctx.db.query("webPushSubscriptions")` (the `no-untenanted-query`
 * rule). This file lives in the EXEMPT `convex/lib/tenancy/**` path (the single
 * sanctioned `ctx.db` site for this table), exactly like `notificationsStore.ts`
 * for `notificationEvents` or `walletDeviceRegistrationsStore.ts` for the (GLOBAL)
 * Wallet registry it mirrors in structure. The business module
 * `lib/customer/webPush` (NOT exempt) calls THESE helpers instead of `ctx.db`.
 *
 * `endpoint` is the UNIQUE idempotence key (enforced applicatively on
 * `by_endpoint`, same convention as `walletPasses.by_serial`): register is an
 * idempotent upsert, deactivate a soft flip to `inactive` (history kept — never a
 * hard delete). The `customerId` is carried BY ID only — no nominative coordinate
 * is ever copied (the MOAT, ADR 0010 / 0012).
 */

/** The Web Push subscription payload a register carries (RFC 8291 client keys). */
export type WebPushSubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Read the subscription of an `endpoint`, or `null`. Keyed on the unique
 * `by_endpoint` index — the idempotence key.
 */
async function readByEndpoint(
  ctx: QueryCtx | MutationCtx,
  endpoint: string,
): Promise<Doc<"webPushSubscriptions"> | null> {
  return ctx.db
    .query("webPushSubscriptions")
    .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
    .unique();
}

/**
 * Idempotent upsert of a web-push subscription, keyed on the UNIQUE `endpoint`.
 * A fresh endpoint is INSERTED `active` (`createdAt`/`updatedAt` stamped here); a
 * re-subscribe of the same endpoint REFRESHES the client keys + (re-)activates the
 * existing row (`updatedAt` bumped), never a duplicate. The caller has already
 * resolved `tenantId` (tenant wrapper) and `customerId` (its OWN fiche), so the
 * write is tenant-scoped + targets the right couple. The single sanctioned
 * `ctx.db.insert`/`patch` site for this table. Returns the row id.
 */
export async function registerWebPushSubscription(
  ctx: MutationCtx,
  customerId: Id<"customers">,
  tenantId: Id<"tenants">,
  sub: WebPushSubscriptionInput,
): Promise<Id<"webPushSubscriptions">> {
  const now = Date.now();
  const existing = await readByEndpoint(ctx, sub.endpoint);
  if (existing !== null) {
    await ctx.db.patch(existing._id, {
      p256dh: sub.p256dh,
      auth: sub.auth,
      status: "active",
      updatedAt: now,
    });
    return existing._id;
  }
  return ctx.db.insert("webPushSubscriptions", {
    customerId,
    tenantId,
    endpoint: sub.endpoint,
    p256dh: sub.p256dh,
    auth: sub.auth,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * The ACTIVE subscriptions of a (customer, tenant) couple — the read the send
 * layer (#54) calls to obtain the endpoint + client keys to encrypt + POST to.
 * TENANT-SCOPED: keyed on `by_customer` then filtered to the resolved `tenantId`
 * (the caller's wrapper scope), so a foreign tenant's rows are never returned, and
 * only `active` rows (a deactivated endpoint — 410 Gone — is excluded).
 */
export async function listActiveWebPushSubscriptions(
  ctx: QueryCtx | MutationCtx,
  customerId: Id<"customers">,
  tenantId: Id<"tenants">,
): Promise<Doc<"webPushSubscriptions">[]> {
  const rows = await ctx.db
    .query("webPushSubscriptions")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  return rows.filter((r) => r.tenantId === tenantId && r.status === "active");
}

/**
 * Soft-deactivate the subscription of an `endpoint` (consumed on a 410 Gone — the
 * endpoint expired). A SOFT flip to `inactive` — never a hard delete (the row
 * survives so the history stays auditable, `walletDeviceRegistrations` convention),
 * and the channel reachability is propagated back to the GLOBAL fiche separately
 * (the `reachabilityFeedback` pattern, #65 — out of THIS storage seam). A no-op for
 * an unknown endpoint (idempotent). `updatedAt` is bumped. The single sanctioned
 * `ctx.db.patch` site for this transition.
 */
export async function deactivateWebPushSubscription(
  ctx: MutationCtx,
  endpoint: string,
): Promise<void> {
  const existing = await readByEndpoint(ctx, endpoint);
  if (existing === null) return; // unknown endpoint → nothing to flip
  await ctx.db.patch(existing._id, {
    status: "inactive",
    updatedAt: Date.now(),
  });
}
