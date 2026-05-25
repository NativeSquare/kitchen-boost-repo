import { v } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import {
  anonymizeCustomerFiche,
  kbAdminMutation,
  kbAdminQuery,
  readCustomerFicheById,
} from "../tenancy";

/**
 * 2.1-F — Effacement RGPD par anonymisation IRRÉVERSIBLE (PRD 90 §6, customer-data
 * CONTEXT "Effacement RGPD = anonymisation irréversible", ADR 0008/0012).
 *
 * When a customer exercises their right to erasure (processed at
 * `privacy@kitchenboost.fr`, SLA 30j), KB — the responsable de traitement RGPD
 * (contrat Article 2 ter) — anonymises the fiche IRREVERSIBLY rather than
 * hard-deleting it:
 *
 *  - NULLIFIES, with no backup copy, every personal field: email / phone /
 *    firstName / address / lat / lng AND the whole `pushEnrollment` object (wallet
 *    serial = cross-device identity bridge per ADR 0008, web-push id, per-channel
 *    statuses). Stamps `anonymizedAt`.
 *  - PRESERVES `customerOrdersPerTenant` (totalOrders / lastOrderAt / ltv) — kept
 *    for accounting (Code de commerce L123-22, 10 ans) + resto KPI not broken — and
 *    keeps the fiche row (ghost customer, NO hard delete V1). The CNIL validates
 *    anonymisation precisely because it is irreversible.
 *
 * Surface (root only, KB support/RGPD):
 *  - `anonymizeCustomer(customerId)` via `kbAdminMutation` (auto-audited).
 *  - `getCustomerForSupport(customerId)` via `kbAdminQuery` (US #22) — root reads
 *    any fiche. The SELF read is the separate `getCurrentCustomer` (identity.ts,
 *    US #21). A `kb_manager` NEVER reaches either: the resto sees only aggregates
 *    (`aggregateCustomerKPIs`) — the MOAT (ADR 0010).
 *
 * Identity flows ONLY through `getCurrentActor` (inside the kbAdmin wrappers,
 * ADR 0011). The GLOBAL `customers` table is reached ONLY through the sanctioned
 * tenancy seam (`anonymizeCustomerFiche` / `readCustomerFicheById`), never raw
 * `ctx.db` in this business module (ADR 0010 / `no-untenanted-query`).
 */

/**
 * Irreversibly anonymise a customer's fiche (root). Nullifies all PII + push
 * enrollment ids/statuses and stamps `anonymizedAt`, while leaving
 * `customerOrdersPerTenant` and the fiche row untouched (no hard delete). Root-gated
 * + auto-audited by `kbAdminMutation`. Idempotent: re-anonymising an already-ghost
 * fiche re-applies the same nullification (a safe no-op on already-empty fields).
 */
export const anonymizeCustomer = kbAdminMutation({
  args: { customerId: v.id("customers") },
  action: "customer.rgpd.anonymize",
  handler: async (ctx, { customerId }): Promise<void> => {
    await anonymizeCustomerFiche(ctx, customerId, Date.now());
  },
});

/**
 * Read any customer fiche by id (root — support / RGPD, US #22). Returns the full
 * fiche (or the anonymised ghost after erasure), or `null` if it vanished. Reached
 * ONLY through the root `kbAdminQuery` gate; a `kb_manager` is refused (the MOAT,
 * ADR 0010). The customer's OWN self-read is `getCurrentCustomer` (identity.ts).
 */
export const getCustomerForSupport = kbAdminQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, { customerId }): Promise<Doc<"customers"> | null> =>
    readCustomerFicheById(ctx, customerId),
});
