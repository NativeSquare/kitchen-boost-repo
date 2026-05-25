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
// stripeAccountId / uberCustomerId are added by their own chantiers (2.5 / 2.6).
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
  createdAt: v.number(),
}).index("by_slug", ["slug"]); // slug is unique (enforced applicatively)
