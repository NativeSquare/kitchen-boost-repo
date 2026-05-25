import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.9-A — `contracts` (PRD 70 §3.5, kb-admin CONTEXT "Statut contrat" / "Contrat
 * HTML", contrat_template.md).
 *
 * The contract lifecycle of a [[Prospect]] / [[Tenant]]: KB GENERATES the HTML
 * (the TypeScript port of `generate_contract.py` is a LATER story, #64 — this
 * slice only lays the table), sends it to Odoo for signature, and TRACKS the
 * status. KB never signs (Odoo does, PRD 70 §3.5).
 *
 * ── KB-ADMIN-GLOBAL — same exemption as `prospects` (ADR 0010) ─────────────────
 * A contract belongs to KB's own onboarding pipeline (root-only). It is NOT
 * tenant-scoped: the optional `tenantId` is a BACK-LINK (set once the prospect is
 * provisioned), used by the `by_tenant` index, not a tenancy boundary — exactly
 * like `prospects`. Access goes EXCLUSIVELY through the sanctioned root wrappers
 * (`kbAdminQuery/Mutation`), never raw `ctx.db.query("contracts")` in business
 * code (`no-untenanted-query`, 1.x-H). The sanctioned `ctx.db` site is the exempt
 * `convex/lib/tenancy/**` path alongside this `convex/table/**` file.
 *
 * Vocabulary is NOT invented:
 *  - `prestation` — A / B / A&B (contrat_template.md §1.3, PRD 70 §3.5 selector).
 *  - `status` — the contract lifecycle draft → sent → signed → expired
 *    (kb-admin CONTEXT "Statut contrat"), with `statusUpdatedAt` = the dated
 *    timestamp of the CURRENT status (PRD 70 §3.5 "statut stocké … daté").
 */

/** The prestation bundle the contract covers (contrat_template.md §1.3). */
export const contractPrestation = v.union(
  v.literal("A"),
  v.literal("B"),
  v.literal("A_AND_B"),
);

/** Contract lifecycle (kb-admin CONTEXT "Statut contrat", PRD 70 §3.5). */
export const contractStatus = v.union(
  v.literal("draft"),
  v.literal("sent"),
  v.literal("signed"),
  v.literal("expired"),
);

export const contracts = defineTable({
  // The prospect this contract was generated for (always present). `tenantId` is
  // the BACK-LINK once provisioned (see module header).
  prospectId: v.id("prospects"),
  tenantId: v.optional(v.id("tenants")),

  prestation: contractPrestation,

  // Current lifecycle status + the instant it was reached (PRD 70 §3.5: status is
  // "daté"). A status change bumps `statusUpdatedAt` (later slice).
  status: contractStatus,
  statusUpdatedAt: v.number(),

  // The generated contract HTML (kb-admin CONTEXT "Contrat HTML"). Optional: a
  // `draft` row may exist before generation. The signed PDF stays in Odoo in V1
  // (Q70-Q9) — referenced via `odooLink`, not stored here.
  htmlContent: v.optional(v.string()),
  // Odoo signature deep-link, set when the contract is sent (PRD 70 §3.5).
  odooLink: v.optional(v.string()),

  createdAt: v.number(),
  updatedAt: v.number(),
})
  // contract → its prospect (PRD 70 §3.5 — the primary access path).
  .index("by_prospect", ["prospectId"])
  // contract → its tenant once provisioned.
  .index("by_tenant", ["tenantId"]);
