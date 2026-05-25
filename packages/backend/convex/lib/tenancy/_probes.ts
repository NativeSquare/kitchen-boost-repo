import { v } from "convex/values";
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
