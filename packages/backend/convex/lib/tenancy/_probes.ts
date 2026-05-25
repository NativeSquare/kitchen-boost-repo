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
