import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Tenant lifecycle status. Cf. Multi-Tenant CONTEXT + PRD 50. */
export const tenantStatus = v.union(
  v.literal("active"),
  v.literal("pending"),
  v.literal("suspended"),
  v.literal("disabled"),
);

// A Tenant = 1 physical établissement. Identity + lifecycle only here.
// stripeAccountId is added by its own chantier (2.5).
export const tenants = defineTable({
  slug: v.string(),
  name: v.string(),
  siret: v.string(),
  status: tenantStatus,
  branding: v.optional(
    v.object({
      logoUrl: v.optional(v.string()),
      primaryColor: v.optional(v.string()),
    }),
  ),
  customDomain: v.optional(v.string()),
  // 2.6-A — the tenant's Uber Direct sub-account id (`customer_id`, research
  // §1.1 / §3.1). One Uber Direct account per tenant — always (one pickup address
  // per account, NEVER shared even with a common SIRET; multi-tenant CONTEXT
  // "Uber Direct par tenant"). Set when the Uber credentials are stored (2.6-A).
  uberCustomerId: v.optional(v.string()),
  // 2.3-A — transient operational pause ("Pause exceptionnelle", PRD 20 §7 /
  // kb-orders CONTEXT). When set, the PWA checkout is disabled until `until`
  // (epoch ms). Absent = no pause (distinct from the `status`-driven `fermé` /
  // `ouvert` lifecycle above). The full open/closed schedule is the slice-F
  // concern; this slice lays only the transient pause domain field, leaving the
  // 1.x identity / lifecycle fields untouched.
  operationalPause: v.optional(v.object({ until: v.number() })),
  createdAt: v.number(),
}).index("by_slug", ["slug"]); // slug is unique (enforced applicatively)
