import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  NotificationChannel,
  NotificationStatus,
  TemplateScope,
} from "../../table/notifications";

/**
 * 2.7-D — the SANCTIONED data-access seam for marketing campaigns (ADR 0010 + the
 * MOAT discipline of PRD 90). The business module `lib/notifications/campaigns`
 * (NOT exempt) reaches `notificationEvents` / `campaignLaunches` / the GLOBAL
 * `customers` fiche ONLY through these helpers — never raw `ctx.db`
 * (`no-untenanted-query`). This file lives in the EXEMPT `convex/lib/tenancy/**`
 * path, like `notificationsStore.ts` / `customerOrdersStore.ts`.
 *
 * ── MOAT (PRD 90 §3/§5, ADR 0010) ─────────────────────────────────────────────
 * A `kb_manager` campaign never receives a recipient identity. The targeting +
 * sending happen ENTIRELY server-side here (KB proxy): the seam reads the customer
 * fiches, the engine reduces them to per-customer channel decisions, and only
 * COUNTS leave the mutation. No helper returns a raw `customers` row, an email, a
 * phone or a name to the caller — the campaign-fields projection is NARROW
 * (reachability + eligibility timestamps only), exactly as `customerOrdersStore`'s
 * aggregate projection. The `notificationEvents` / `campaignLaunches` rows store
 * the `customerId` BY ID + counts only.
 *
 * ── Rate-limit GLOBAL across tenants ──────────────────────────────────────────
 * `listCustomerCampaignSendTimestamps` reads the customer's campaign sends across
 * EVERY tenant (the `by_customer` index spans tenants — the journal carries
 * `tenantId` but the customer is GLOBAL, ADR 0010), so the 3/sem limit is enforced
 * globally (PRD 80 §6 "tous restos + cross-tenant confondus").
 */

// ── Targeting reads (NARROW projections — the MOAT) ───────────────────────────

/**
 * The NARROW per-customer fields a campaign needs: reachability (email / push
 * enrolment) + the marketing-eligibility timestamps (ADR 0005). Deliberately NO
 * name / phone / address — the engine reduces this to a channel decision + a
 * boolean before anything (counts only) leaves the mutation.
 */
export type CustomerCampaignFields = {
  email?: string;
  pushEnrollment?: Doc<"customers">["pushEnrollment"];
  cgvAcceptedAt?: number;
  marketingOptOutDate?: number;
  lastCheckoutAt?: number;
};

/**
 * Read the campaign-relevant fields of a customer by id. SANCTIONED read of the
 * GLOBAL `customers` table (no `tenantId` to scope on — the MOAT exemption, ADR
 * 0010); the CALLER has already resolved this `customerId` from a tenant-scoped
 * `customerOrdersPerTenant` row (tenant campaign) or, for a cross-tenant KB
 * campaign, under the root `kb_admin` gate. Returns `null` if the fiche vanished.
 */
export async function readCustomerCampaignFields(
  ctx: QueryCtx | MutationCtx,
  customerId: Id<"customers">,
): Promise<CustomerCampaignFields | null> {
  const fiche = await ctx.db.get(customerId);
  if (fiche === null) return null;
  return {
    email: fiche.email,
    pushEnrollment: fiche.pushEnrollment,
    cgvAcceptedAt: fiche.cgvAcceptedAt,
    marketingOptOutDate: fiche.marketingOptOutDate,
    lastCheckoutAt: fiche.lastCheckoutAt,
  };
}

/**
 * ALL customer ids linked to a tenant (a tenant campaign's candidate audience).
 * Keyed on the tenant-scoped `customerOrdersPerTenant.by_tenant` index, so a resto
 * only ever reaches the ids of its OWN customers — never a foreign tenant's.
 */
export async function listTenantCustomerIds(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Id<"customers">[]> {
  const links = await ctx.db
    .query("customerOrdersPerTenant")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  return links.map((l) => l.customerId);
}

/**
 * The DISTINCT customer ids linked to a tenant, for a CROSS-TENANT (KB root)
 * campaign fired AT that tenant. Reached only under the root `kb_admin` gate; the
 * upstream geo-filter (PRD 80 §2 "géo-filtrage amont") is the campaign caller's
 * responsibility — this seam only enumerates the tenant's candidate audience.
 */
export async function listCrossTenantCustomerIds(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Id<"customers">[]> {
  return listTenantCustomerIds(ctx, tenantId);
}

// ── Rate-limit read (GLOBAL across tenants) ───────────────────────────────────

/**
 * The timestamps of ALL of a customer's prior CAMPAIGN sends, across EVERY tenant
 * (the GLOBAL rate-limit input, PRD 80 §6). Keyed on `notificationEvents.by_customer`
 * (which spans tenants); filtered to `kind = "campaign"` so transactional sends
 * never count against the marketing limit. `queued` rows count too (they WILL go
 * out — a queued DNT send still consumes a slot).
 */
export async function listCustomerCampaignSendTimestamps(
  ctx: QueryCtx | MutationCtx,
  customerId: Id<"customers">,
): Promise<number[]> {
  const rows = await ctx.db
    .query("notificationEvents")
    .withIndex("by_customer", (q) => q.eq("customerId", customerId))
    .collect();
  return rows.filter((r) => r.kind === "campaign").map((r) => r.createdAt);
}

// ── Anti-anomaly history (per-resto launches) ─────────────────────────────────

/** One prior campaign launch of a tenant (anti-anomaly history element). */
export type TenantCampaignLaunch = {
  launchedAt: number;
  recipients: number;
};

/** A tenant's prior campaign launches, keyed on `campaignLaunches.by_tenant`. */
export async function listTenantCampaignLaunches(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<TenantCampaignLaunch[]> {
  const rows = await ctx.db
    .query("campaignLaunches")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  return rows.map((r) => ({
    launchedAt: r.launchedAt,
    recipients: r.recipients,
  }));
}

/**
 * Record one campaign LAUNCH for a tenant (anti-anomaly trail, PRD 80 §7). Stamps
 * `tenantId` from the caller's resolved scope; stores the recipient COUNT only —
 * never an identity (the MOAT).
 */
export async function insertCampaignLaunch(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  launch: { scope: TemplateScope; launchedAt: number; recipients: number },
): Promise<Id<"campaignLaunches">> {
  return ctx.db.insert("campaignLaunches", {
    tenantId,
    scope: launch.scope,
    launchedAt: launch.launchedAt,
    recipients: launch.recipients,
  });
}

// ── Campaign send journal write ───────────────────────────────────────────────

/** A campaign journal row to append (kind is fixed to `campaign`). */
export type NewCampaignEvent = {
  customerId: Id<"customers">;
  scope: TemplateScope;
  templateId?: Id<"notificationTemplates">;
  channel: NotificationChannel;
  status: NotificationStatus;
  createdAt: number;
  sentAt?: number;
};

/**
 * Append one CAMPAIGN `notificationEvents` row for `tenantId`. Stamps `tenantId`
 * from the caller's resolved scope (a cross-tenant campaign passes the tenant it is
 * fired AT). The `customerId` is carried BY ID ONLY — no nominative coordinate is
 * ever copied (the MOAT, ADR 0010 / 0012).
 */
export async function insertCampaignEvent(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  event: NewCampaignEvent,
): Promise<Id<"notificationEvents">> {
  return ctx.db.insert("notificationEvents", {
    tenantId,
    customerId: event.customerId,
    kind: "campaign",
    campaignScope: event.scope,
    ...(event.templateId !== undefined ? { templateId: event.templateId } : {}),
    channel: event.channel,
    status: event.status,
    createdAt: event.createdAt,
    ...(event.sentAt !== undefined ? { sentAt: event.sentAt } : {}),
  });
}

/** All tenant ids that have at least one customer link (cross-tenant fan-out). */
export async function listAllLinkedTenantIds(
  ctx: QueryCtx | MutationCtx,
): Promise<Id<"tenants">[]> {
  const links = await ctx.db.query("customerOrdersPerTenant").collect();
  const ids = new Set<Id<"tenants">>();
  for (const l of links) ids.add(l.tenantId);
  return [...ids];
}

// ── Template read ─────────────────────────────────────────────────────────────

/**
 * Read a pre-validated campaign template by id. SANCTIONED read of
 * `notificationTemplates`; the CALLER (a tenant campaign under `tenantMutation`)
 * verifies the returned template's `scope`/`tenantId` matches the resto before
 * using it — a KB-central library entry (no `tenantId`) is shared, a resto-scoped
 * one must match the caller's tenant. Returns `null` if absent.
 */
export async function readNotificationTemplate(
  ctx: QueryCtx | MutationCtx,
  templateId: Id<"notificationTemplates">,
): Promise<Doc<"notificationTemplates"> | null> {
  return ctx.db.get(templateId);
}
