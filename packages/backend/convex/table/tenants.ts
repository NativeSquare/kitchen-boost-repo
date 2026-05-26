import { defineTable } from "convex/server";
import { v } from "convex/values";

/** Tenant lifecycle status. Cf. Multi-Tenant CONTEXT + PRD 50. */
export const tenantStatus = v.union(
  v.literal("active"),
  v.literal("pending"),
  v.literal("suspended"),
  v.literal("disabled"),
);

/**
 * 2.5-A — the tenant's Stripe Connect Express account status (PRD 30 §2,
 * payment CONTEXT). NOT the tenant lifecycle `status` above — this reflects ONLY
 * the connected-account onboarding/KYC state as derived from Stripe
 * `account.updated`:
 *  - `pending` — account created / onboarding started but not chargeable yet
 *    (KYC `pending`: details not fully submitted, or verification outstanding).
 *  - `ready`   — KYC verified, the account can take charges AND payouts
 *    (Stripe `charges_enabled && payouts_enabled`). The ONLY status that lets a
 *    direct charge be created (PRD 30 §1/§2).
 *  - `disabled`— Stripe disabled the account (KYC `rejected` / a blocking
 *    requirement). A rejected KYC NEVER maps to `ready` (PRD 30 §1, issue #35).
 */
export const stripeAccountStatus = v.union(
  v.literal("pending"),
  v.literal("ready"),
  v.literal("disabled"),
);

// A Tenant = 1 physical établissement. Identity + lifecycle only here.
export const tenants = defineTable({
  slug: v.string(),
  name: v.string(),
  siret: v.string(),
  status: tenantStatus,
  // 2.5-A — Stripe Connect Express link (PRD 30 §2, payment CONTEXT, STACK §3
  // reserves this addition to 2.5). BOTH optional: a fresh tenant has no Stripe
  // account; once the KB Admin generates the `account_link` and Stripe creates
  // the connected account, `stripeAccountId` (`acct_xxx`) is stamped here and
  // `stripeStatus` tracks the KYC/account state from the `account.updated`
  // webhook. KB is NOT merchant of record — this is just the link to the resto's
  // OWN Stripe account (direct charges, payment CONTEXT).
  stripeAccountId: v.optional(v.string()),
  stripeStatus: v.optional(stripeAccountStatus),
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
})
  .index("by_slug", ["slug"]) // slug is unique (enforced applicatively)
  // 2.5-A — resolve the tenant from a Stripe `account.updated` webhook payload
  // (which only carries the connected `acct_xxx`). `stripeAccountId` is unique per
  // tenant (one Stripe account per resto), enforced applicatively on stamp.
  .index("by_stripe_account", ["stripeAccountId"]);
