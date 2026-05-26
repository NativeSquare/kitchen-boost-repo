import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  NotificationChannel,
  NotificationStatus,
  TransactionalCategory,
  TransactionalTrigger,
} from "../../table/notifications";

/**
 * 2.7-B — the SANCTIONED tenant-scoped data-access seam for the
 * `notificationEvents` send journal (the isolation discipline of ADR 0010).
 *
 * `notificationEvents` carries `tenantId`, so business code reaches it ONLY
 * through the tenancy wrappers — never raw `ctx.db.query("notificationEvents")`
 * (the `no-untenanted-query` rule). This file lives in the EXEMPT
 * `convex/lib/tenancy/**` path (the single sanctioned `ctx.db` site for this
 * table), exactly like `ordersStore.ts` for `orders`. The business module
 * `lib/notifications/**` (NOT exempt) calls THESE helpers instead of `ctx.db`.
 *
 * Every helper is TENANT-SCOPED by construction: it takes the caller's resolved
 * `tenantId` (from `ctx.tenantId` inside a tenant wrapper handler) and stamps /
 * keys it on the journal row. The `customerId` is carried BY ID ONLY — no
 * nominative coordinate is ever copied (the MOAT, ADR 0010 / 0012).
 *
 * 2.7-B writes ONLY transactional journal rows (the campaign send path is slice
 * C/D), so this seam exposes a transactional insert + the tenant/customer reads.
 */

/** A transactional journal row to append (kind is fixed to `transactional`). */
export type NewTransactionalEvent = {
  customerId: Id<"customers">;
  trigger: TransactionalTrigger;
  category: TransactionalCategory;
  channel: NotificationChannel;
  status: NotificationStatus;
  /** Set only when the send actually went out (omitted for queued/failed). */
  sentAt?: number;
};

/**
 * Append one transactional `notificationEvents` row for `tenantId`. Stamps
 * `tenantId` from the caller's resolved scope (never from the row payload) and
 * records the trigger + category + effective channel + status. Returns the id.
 */
export async function insertTenantNotificationEvent(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  event: NewTransactionalEvent,
): Promise<Id<"notificationEvents">> {
  return ctx.db.insert("notificationEvents", {
    tenantId,
    customerId: event.customerId,
    kind: "transactional",
    transactionalTrigger: event.trigger,
    transactionalCategory: event.category,
    channel: event.channel,
    status: event.status,
    createdAt: Date.now(),
    ...(event.sentAt !== undefined ? { sentAt: event.sentAt } : {}),
  });
}

/**
 * 2.7-E — mark a tenant's journal row `inactive_endpoint` (the web-push 410 Gone
 * marker, PRD 80 §7 "Endpoint expiré : marker inactive"). TENANT-SCOPED with an
 * ownership re-check: a missing OR foreign `eventId` throws a typed `NOT_FOUND`
 * (no cross-tenant existence oracle — the same discipline as `requireTenantOrder`),
 * so a resto can never flip another tenant's send row. The single sanctioned
 * `ctx.db.patch` site for this status transition; the business module
 * `lib/notifications/reachabilityFeedback` (NOT exempt) calls THIS, never raw
 * `ctx.db`. Only the send `status` moves — no reachability is copied onto the row
 * (reachability stays in 2.1, ADR 0012).
 */
export async function markTenantNotificationEventInactive(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  eventId: Id<"notificationEvents">,
): Promise<void> {
  const row = await ctx.db.get(eventId);
  if (row === null || row.tenantId !== tenantId) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Notification event not found for this tenant.",
    });
  }
  await ctx.db.patch(eventId, { status: "inactive_endpoint" });
}

/** All of a tenant's journal rows, keyed on `by_tenant` (newest first). */
export async function listTenantNotificationEvents(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"notificationEvents">[]> {
  return ctx.db
    .query("notificationEvents")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .order("desc")
    .collect();
}

/**
 * A tenant's journal rows for ONE customer (re-engagement history / rate-limit
 * reads), keyed on the composite `by_tenant_customer` index — scoped to the
 * tenant so a foreign customer's rows are unreachable.
 */
export async function listTenantCustomerNotificationEvents(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
): Promise<Doc<"notificationEvents">[]> {
  return ctx.db
    .query("notificationEvents")
    .withIndex("by_tenant_customer", (q) =>
      q.eq("tenantId", tenantId).eq("customerId", customerId),
    )
    .order("desc")
    .collect();
}
