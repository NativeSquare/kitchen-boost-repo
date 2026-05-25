import { defineTable } from "convex/server";
import { v } from "convex/values";

// Append-only audit trail. Written by logAudit / the guarded wrappers (1.x-G).
// actorRole kept as a free string so logs stay flexible across role evolutions.
export const auditLog = defineTable({
  actorUserId: v.id("users"),
  actorRole: v.string(),
  action: v.string(),
  tenantId: v.optional(v.id("tenants")),
  targetType: v.optional(v.string()),
  targetId: v.optional(v.string()),
  metadata: v.optional(v.any()),
  timestamp: v.number(),
})
  .index("by_tenant", ["tenantId"])
  .index("by_actor", ["actorUserId"])
  .index("by_timestamp", ["timestamp"]);
