import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Resto-scoped role, carried PER-TENANT here (not on users). Cf. ADR 0011. */
export const tenantRole = v.union(v.literal("kb_manager"), v.literal("staff"));

// N-N link: which tenants a user can access, and with which role.
// kb_admin (root) and customer have NO row here. Soft-detach via detachedAt.
export const userTenants = defineTable({
  userId: v.id("users"),
  tenantId: v.id("tenants"),
  role: tenantRole,
  attachedAt: v.number(),
  attachedBy: v.id("users"),
  detachedAt: v.optional(v.number()),
})
  .index("by_user", ["userId"])
  .index("by_tenant", ["tenantId"])
  .index("by_user_tenant", ["userId", "tenantId"]); // unique (enforced applicatively)
