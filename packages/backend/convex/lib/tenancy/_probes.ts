import { v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { logAudit } from "./audit";
import { customerMutation, customerQuery, publicTenantQuery } from "./customer";
import {
  kbAdminMutation,
  kbAdminQuery,
  tenantMutation,
  tenantQuery,
} from "./withTenant";

/**
 * 1.x-C — test-only probe functions built with each tenancy wrapper.
 *
 * The wrappers can only be exercised end-to-end (identity resolution + access
 * gate) through the real Convex function pipeline, so the test suite and the
 * reusable fuzz harness drive these thin probes via `t.withIdentity(...)`.
 * They expose just enough of the enriched ctx to assert the contract; they hold
 * NO business logic and return no tenant data beyond echoing the resolved actor.
 *
 * These are real (public) Convex functions — harmless probes — kept in the
 * tenancy module precisely so the harness has stable, wrapper-built targets to
 * fuzz. Business chantiers add their own functions and fuzz them the same way.
 */

/** kb_admin-only read: echoes the resolved root actor. */
export const adminProbeQuery = kbAdminQuery({
  handler: async (ctx) => ({ userId: ctx.actor.userId, role: ctx.actor.role }),
});

/** kb_admin-only write: reads ANY tenant's name (root has no tenantId gate). */
export const adminReadTenantName = kbAdminMutation({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId);
    return tenant?.name ?? null;
  },
});

/** Default tenant scope (allow defaults to ["kb_manager"]). */
export const managerProbeQuery = tenantQuery()({
  args: {},
  handler: async (ctx) => ({
    tenantId: ctx.tenantId,
    effectiveRole: ctx.actor.effectiveRole,
  }),
});

/** Tenant write scope (default allow ["kb_manager"]). */
export const managerProbeMutation = tenantMutation()({
  args: {},
  handler: async (ctx) => ({
    tenantId: ctx.tenantId,
    effectiveRole: ctx.actor.effectiveRole,
  }),
});

/** Tenant scope that ALSO allows staff. */
export const staffProbeQuery = tenantQuery({ allow: ["kb_manager", "staff"] })({
  args: {},
  handler: async (ctx) => ({
    tenantId: ctx.tenantId,
    effectiveRole: ctx.actor.effectiveRole,
  }),
});

// --- 1.x-D client-side wrappers -------------------------------------------

/** customer read: echoes the caller's OWN actor + the tenant in scope. */
export const customerProbeQuery = customerQuery({
  args: {},
  handler: async (ctx) => ({
    userId: ctx.actor.userId,
    role: ctx.actor.role,
    tenantId: ctx.tenantId,
  }),
});

/** customer write: same shape, write path. */
export const customerProbeMutation = customerMutation({
  args: {},
  handler: async (ctx) => ({
    userId: ctx.actor.userId,
    role: ctx.actor.role,
    tenantId: ctx.tenantId,
  }),
});

/** public (no-auth) read of a tenant's public data — echoes name + id. */
export const publicTenantProbe = publicTenantQuery({
  args: {},
  handler: async (ctx) => ({
    tenantId: ctx.tenantId,
    tenantName: ctx.tenant.name,
  }),
});

// --- 1.x-G audit probes ----------------------------------------------------

/** Explicit logAudit call from a handler, with ALL optional fields populated. */
export const explicitLogProbe = kbAdminMutation({
  args: { tenantId: v.id("tenants") },
  // declare a distinct action so this probe's own auto-log doesn't collide.
  action: "probe.explicitWrapper",
  handler: async (ctx, args) => {
    await logAudit(ctx, {
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: "probe.explicit",
      tenantId: args.tenantId,
      targetType: "tenant",
      targetId: args.tenantId,
      metadata: { note: "hello" },
    });
  },
});

/** Explicit logAudit call with only the required fields (no tenant/target/meta). */
export const explicitLogMinimalProbe = kbAdminMutation({
  action: "probe.minimalWrapper",
  handler: async (ctx) => {
    await logAudit(ctx, {
      actorUserId: ctx.actor.userId,
      actorRole: ctx.actor.role,
      action: "probe.minimal",
    });
  },
});

/** kbAdminMutation that should AUTO-log (declares its action + takes a tenantId). */
export const adminAuditedMutation = kbAdminMutation({
  args: { tenantId: v.id("tenants") },
  action: "admin.audited",
  handler: async () => null,
});

/** kbAdminMutation with NO tenantId arg — still auto-logs (tenantId omitted). */
export const adminProbeNoTenantMutation = kbAdminMutation({
  action: "admin.noTenant",
  handler: async () => null,
});

/** tenantMutation tagged audit:true → MUST auto-log. */
export const tenantAuditedMutation = tenantMutation({ allow: ["kb_manager"] })({
  args: {},
  audit: true,
  action: "tenant.audited",
  handler: async () => null,
});

// --- 2.1-A Customer Data schema probes -------------------------------------
//
// These prove the new GLOBAL `customers` table + the per-tenant link table are
// reachable ONLY through the sanctioned wrappers (root / self / tenant). They
// live HERE (the exempt `lib/tenancy/**` path) precisely so no raw
// `ctx.db.query("customers")` is introduced in business code — the access
// contract of story 2.1-A. No business logic (consent/segments/KPI/RGPD).

/** root (kb_admin) writes a `customers` fiche — the sanctioned GLOBAL write. */
export const adminCreateCustomerProbe = kbAdminMutation({
  args: { userId: v.id("users"), firstName: v.optional(v.string()) },
  action: "customer.create",
  handler: async (ctx, args): Promise<Id<"customers">> =>
    ctx.db.insert("customers", {
      userId: args.userId,
      firstName: args.firstName,
      createdAt: Date.now(),
    }),
});

/** root (kb_admin) reads any `customers` fiche back — sanctioned GLOBAL read. */
export const adminGetCustomerProbe = kbAdminQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args) => ctx.db.get(args.customerId),
});

/**
 * self (customer) reads its OWN fiche via the customer wrapper. Self-scope is
 * structural: the handler only ever sees `ctx.actor.userId`, so it resolves the
 * fiche through the GLOBAL `by_user` index keyed on the caller's own id — no
 * other customer's fiche is reachable from here.
 */
export const customerGetSelfFicheProbe = customerQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("customers")
      .withIndex("by_user", (q) => q.eq("userId", ctx.actor.userId))
      .unique(),
});

/**
 * resto (kb_manager) reads the per-tenant customer stats — `tenantId` is scoped
 * by the wrapper, so the query is keyed on `ctx.tenantId` and can NEVER read
 * another tenant's link rows. This is the cross-tenant-fuzzed surface of 2.1-A
 * (the link table carries `tenantId`, ADR 0010).
 */
export const tenantCustomerStatsProbe = tenantQuery()({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("customerOrdersPerTenant")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect(),
});

// --- 2.2-A Menu schema probes ----------------------------------------------
//
// The menu slice (2.2-A) exports NO business function — it only lays the 5
// tenant-scoped tables. These test-only probes prove each menu table is reachable
// ONLY through `tenantQuery` (keyed on `ctx.tenantId`), so the cross-tenant fuzz
// harness can replay them under unauthorized actors and assert a Forbidden throw
// before any row is read (ADR 0010). They live HERE (the exempt `lib/tenancy/**`
// path), so no raw `ctx.db.query()` is introduced in business code. No business
// logic — each just collects the tenant's rows.

/** resto reads its OWN menu categories (tenant-scoped by the wrapper). */
export const tenantMenuCategoriesProbe = tenantQuery()({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("menuCategories")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect(),
});

/** resto reads its OWN menu items. */
export const tenantMenuItemsProbe = tenantQuery()({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("menuItems")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect(),
});

/** resto reads its OWN reusable modifier groups. */
export const tenantModifierGroupsProbe = tenantQuery()({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("modifierGroups")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect(),
});

/**
 * resto reads its OWN item↔group links. The link table's access paths are
 * by_item / by_group / by_item_group (issue spec, no by_tenant), so the probe
 * scopes through the tenant's own items first — it NEVER reads a row keyed on a
 * foreign tenant's data, which is exactly the property the fuzz asserts.
 */
export const tenantMenuItemModifierGroupsProbe = tenantQuery()({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db
      .query("menuItems")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect();
    const linksPerItem = await Promise.all(
      items.map((item) =>
        ctx.db
          .query("menuItemModifierGroups")
          .withIndex("by_item", (q) => q.eq("itemId", item._id))
          .collect(),
      ),
    );
    return linksPerItem.flat();
  },
});

/** resto reads its OWN service hours. */
export const tenantServiceHoursProbe = tenantQuery()({
  args: {},
  handler: async (ctx) =>
    ctx.db
      .query("serviceHours")
      .withIndex("by_tenant", (q) => q.eq("tenantId", ctx.tenantId))
      .collect(),
});

// --- 2.9-A KB Admin schema probes ------------------------------------------
//
// `prospects` + `contracts` are KB-ADMIN-GLOBAL (no tenantId scoping key, like
// `customers`/`cgvVersions`, ADR 0010): KB's OWN onboarding pipeline, owned by
// the `kb_admin` (root) role. These test-only probes prove both tables are
// reachable ONLY through `kbAdminQuery/Mutation` (root) — so the fuzz harness can
// replay the list probes under unauthorized actors and assert a Forbidden throw
// before any row is read. They live HERE (the exempt `lib/tenancy/**` path), so
// no raw `ctx.db.query("prospects"|"contracts")` is introduced in business code.
// No business logic (CRM CRUD, pipeline transitions, contract generation #64).

/** root (kb_admin) creates a minimal `prospects` row — the sanctioned write. */
export const adminCreateProspectProbe = kbAdminMutation({
  args: {
    name: v.string(),
    phone: v.string(),
    source: v.union(
      v.literal("cold_call"),
      v.literal("whatsapp"),
      v.literal("referral"),
      v.literal("visite_physique"),
    ),
  },
  action: "prospect.create",
  handler: async (ctx, args): Promise<Id<"prospects">> => {
    const now = Date.now();
    return ctx.db.insert("prospects", {
      name: args.name,
      phone: args.phone,
      phase: "acquisition",
      source: args.source,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** root (kb_admin) reads any `prospects` row back — sanctioned root read. */
export const adminGetProspectProbe = kbAdminQuery({
  args: { prospectId: v.id("prospects") },
  handler: async (ctx, args) => ctx.db.get(args.prospectId),
});

/** root (kb_admin) lists prospects (root-only — the fuzzed surface). */
export const adminListProspectsProbe = kbAdminQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("prospects").collect(),
});

/** root (kb_admin) creates a minimal draft `contracts` row — sanctioned write. */
export const adminCreateContractProbe = kbAdminMutation({
  args: {
    prospectId: v.id("prospects"),
    prestation: v.union(v.literal("A"), v.literal("B"), v.literal("A_AND_B")),
  },
  action: "contract.create",
  handler: async (ctx, args): Promise<Id<"contracts">> => {
    const now = Date.now();
    return ctx.db.insert("contracts", {
      prospectId: args.prospectId,
      prestation: args.prestation,
      status: "draft",
      statusUpdatedAt: now,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** root (kb_admin) reads any `contracts` row back — sanctioned root read. */
export const adminGetContractProbe = kbAdminQuery({
  args: { contractId: v.id("contracts") },
  handler: async (ctx, args) => ctx.db.get(args.contractId),
});

/** root (kb_admin) lists contracts (root-only — the fuzzed surface). */
export const adminListContractsProbe = kbAdminQuery({
  args: {},
  handler: async (ctx) => ctx.db.query("contracts").collect(),
});
