import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.2-A — `menuCategories` (PRD 10 §5, client-ordering CONTEXT "Category", ADR
 * 0010).
 *
 * An editorial grouping of items in a tenant's menu (e.g. "Smashs", "Sides",
 * "Boissons"), ordered for display. NO multi-level hierarchy in V1 (Q10-Q8b) —
 * flat categories navigated by scrollable side anchors, no search V1.
 *
 * TENANT-SCOPED (carries `tenantId`, ADR 0010): every read/write goes through
 * the tenancy wrappers, the `no-untenanted-query` rule applies, and the module
 * ships cross-tenant fuzz coverage. Indexed `by_tenant` — the only access path
 * (a resto only ever sees its OWN categories).
 */
export const menuCategories = defineTable({
  tenantId: v.id("tenants"),
  name: v.string(),
  order: v.number(), // display order (integer)
  createdAt: v.number(),
}).index("by_tenant", ["tenantId"]);
