import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * 2.8-A — `walletPasses`, the TECHNICAL state of the common Wallet card (PRD 80
 * Notifications / ADR 0003 wallet pass commun marque neutre).
 *
 * ── GLOBAL, NO authoritative `tenantId` (ADR 0003) ────────────────────────────
 * The KitchenBoost Wallet card is ONE common card under a neutral consumer brand
 * for ALL participating restaurants — NOT one card per resto. So this table, like
 * `customers` (the MOAT, ADR 0010), is deliberately GLOBAL: a pass carries NO
 * `tenantId` that "owns" it. The visible branding (header logo of the LAST resto
 * ordered + "Membre [Nom carte]") is a USAGE, carried by `lastBrandTenantId`, NOT
 * a tenancy boundary — switching the brand resto is a content update, never a
 * change of ownership. Tenant-scoping the card would destroy the cross-tenant push
 * moat (1 channel → N restos). The `no-untenanted-query` rule therefore does NOT
 * apply by tenant here: there is no `tenantId` to scope on. Access still goes
 * EXCLUSIVELY through the sanctioned tenancy seam (`lib/tenancy/walletPassesStore`,
 * alongside `customerFiche`) — never a raw `ctx.db.query("walletPasses")` in the
 * `lib/wallet` business module (which gets NO exemption).
 *
 * ── Does NOT duplicate 2.1 (Customer Data) ────────────────────────────────────
 * The AUTHORITATIVE `serial_number → customer_id` identity bridge (the cross-device
 * + cross-resto recognition surface, ADR 0008/0012) lives in 2.1
 * (`customers.pushEnrollment.walletSerialNumber`). THIS table holds only the
 * TECHNICAL pass state: the `serialNumber` (its own primary key, `by_serial`), the
 * FIXED `passTypeIdentifier` (invisible to the client), a reference to the Customer
 * the pass was generated for, the current visible brand resto, install state, and
 * lifecycle `status`. No reachability, no consent, no per-channel status — those
 * stay in 2.1.
 *
 * `serialNumber` is UNIQUE (enforced applicatively on the `by_serial` index — Convex
 * indexes are not DB-unique, same convention as `customers.by_user` /
 * `tenantCredentials.by_tenant_provider`). It is the value embedded in the signed
 * `.pkpass` / Google Wallet object and the key APNs / Google Wallet updates address.
 */
export const walletPasses = defineTable({
  // The pass primary key — a stable, opaque, unguessable id embedded in the signed
  // pass and used to address it for updates. UNIQUE (applicative, by_serial).
  serialNumber: v.string(),

  // The FIXED Apple Pass Type ID (e.g. `pass.com.kitchen-boost.card`) — invisible
  // to the client, identical on every pass (ADR 0003). Stored per-row so a future
  // pass-type migration is auditable, but it is a constant in V1.
  passTypeIdentifier: v.string(),

  // The Customer the pass was generated for (technical state only — the
  // AUTHORITATIVE serial→customer link is on `customers.pushEnrollment`, 2.1).
  customerId: v.id("customers"),

  // The VISIBLE branding usage: header logo = the LAST resto ordered, "Membre [Nom
  // carte]" in the footer. A usage, NOT an ownership (ADR 0003) — optional because
  // a freshly-generated card may have no brand resto yet.
  lastBrandTenantId: v.optional(v.id("tenants")),

  // Set once the device confirms the install (Apple PassKit Web Service register /
  // Google Wallet add). Absent while merely `generated`.
  installedAt: v.optional(v.number()),

  // Lifecycle of the pass. `generated` = signed, link/file produced, not yet on a
  // device; `installed` = the device registered it; `inactive` = unregistered /
  // expired endpoint.
  status: v.union(
    v.literal("generated"),
    v.literal("installed"),
    v.literal("inactive"),
  ),

  createdAt: v.number(),
}).index("by_serial", ["serialNumber"]); // unique (enforced applicatively)
