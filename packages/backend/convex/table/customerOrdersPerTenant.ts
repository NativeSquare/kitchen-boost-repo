import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.1-A — `customerOrdersPerTenant` (PRD 90 §1, customer-data CONTEXT). The N-N
 * link between the GLOBAL `customers` table and `tenants`: it is the seam that
 * carries `tenantId`, so the per-tenant view ("mes clients" KPI, segments) is
 * reconstructed from HERE — never from a `tenantId` on `customers` (which has
 * none by design, the MOAT, ADR 0010).
 *
 * Carrying `tenantId`, every read of this table is tenant-scoped and goes through
 * `tenantQuery` / `kbAdminQuery`; the `no-untenanted-query` rule (1.x-H) applies,
 * and any module reading it ships a cross-tenant fuzz test (ADR 0010).
 *
 * Per-row stats are WRITTEN by chantier 2.3 (Orders) when an order completes;
 * this slice only lays the table + indexes (no writer / aggregation here).
 */
export const customerOrdersPerTenant = defineTable({
  customerId: v.id("customers"),
  tenantId: v.id("tenants"),
  totalOrders: v.number(),
  lastOrderAt: v.number(),
  ltv: v.number(), // cumulative lifetime value, in euros
})
  .index("by_customer", ["customerId"]) // all tenants a customer ordered at
  .index("by_tenant", ["tenantId"]) // all customers of a tenant (KPI/segments)
  // composite — the unique (tenant, customer) link, the upsert key for 2.3.
  .index("by_tenant_customer", ["tenantId", "customerId"]);
