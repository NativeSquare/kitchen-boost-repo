/**
 * Public API of the `customer` business module (chantier 2.1 — Customer Data,
 * the MOAT).
 *
 * 2.1-B — Anonymous Customer identity. The Convex Auth Anonymous provider is
 * wired in `auth.ts` (`anonymousProfile` stamps every anonymous sign-in as the
 * global role `customer` + `isAnonymous`); the `customers` fiche is then
 * provisioned silently by `getOrCreateCurrentCustomer`. Both functions are
 * self-scoped and reach the GLOBAL `customers` table only through the sanctioned
 * `lib/tenancy/customerFiche` seam (ADR 0008 / 0010 / 0011).
 *
 * 2.1-C — Consent at click-Payer (no checkbox, ADR 0007) + CGV versioned
 * archival (ADR 0007) + the pure `marketingEligible` rule (re-consent par achat,
 * ADR 0005). `recordConsentAtCheckout` / `optOutMarketing` are self-scoped
 * (`customerMutation`); `publishCgvVersion` is root (`kbAdminMutation`). All reach
 * the GLOBAL `customers` / `cgvVersions` tables only through the sanctioned
 * tenancy seam (ADR 0010). The REAL legal CGV wording (Q90-Q1) is NOT invented
 * here — it is injected later through `publishCgvVersion`.
 *
 * 2.1-D — Segments (Actif / Inactif / VIP) + joignabilité par canal (push /
 * email / SMS), READ-ONLY on `customerOrdersPerTenant` (written by 2.3). The pure
 * rules `computeSegment` / `channelReachability` are unit-testable seams; the
 * per-tenant aggregates `segmentCounts` / `reachabilityCounts` expose ONLY counts
 * to a `kb_manager` — never a raw `customer` (the MOAT, ADR 0010). Push
 * enrollment (`setPushEnrollment`, ADR 0012) is self-scoped (also the seam
 * Notifications 2.7 drives). All reads/writes go through the sanctioned tenancy
 * seam (`lib/tenancy/customerOrdersStore`), never raw `ctx.db`.
 *
 * 2.1-E — `aggregateCustomerKPIs`, the SINGLE resto-facing surface on the MOAT
 * (PRD 90 §3 / Q90-Q2). A `kb_manager` reads ONLY aggregates for their tenant
 * (segments + reachability + total + new-this-month + return rate) — NEVER a raw
 * `customer`, coordinate, name or individual id, and the module exposes NO export
 * / bulk / nominative-list surface (the technical lock, ADR 0010). The companion
 * `logKpiConsultation` mutation carries the consultation audit (PRD 90 §4) since
 * a Convex query cannot write. Both go through `tenantQuery` / `tenantMutation`
 * scoped to the tenant; cross-tenant fuzzed (ADR 0010).
 *
 * 2.1-F — RGPD erasure by IRREVERSIBLE anonymisation (PRD 90 §6, ADR 0008/0012).
 * `anonymizeCustomer(customerId)` (root via `kbAdminMutation`, auto-audited)
 * nullifies — no backup copy — every PII field (email / phone / firstName /
 * address / lat / lng) AND the whole `pushEnrollment` object (wallet serial =
 * cross-device identity bridge + web-push id + statuses), stamps `anonymizedAt`,
 * and PRESERVES `customerOrdersPerTenant` (accounting 10 ans + KPI resto) without
 * hard-deleting the fiche (ghost customer kept). `getCustomerForSupport` (root via
 * `kbAdminQuery`, US #22) reads any fiche; the customer's OWN read is
 * `getCurrentCustomer` (identity, US #21); a `kb_manager` reaches NEITHER (MOAT).
 * Both reach the GLOBAL `customers` table ONLY through the sanctioned tenancy seam;
 * cross-tenant fuzzed (ADR 0010).
 *
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.customer.identity.*` / `api.lib.customer.consent.*` /
 * `api.lib.customer.cgv.*` / `api.lib.customer.segments.*` /
 * `api.lib.customer.reachability.*` / `api.lib.customer.kpi.*` /
 * `api.lib.customer.rgpd.*`; re-exporting here does not change that path, it just
 * states the module's contract in one place.
 */
export { getCurrentCustomer, getOrCreateCurrentCustomer } from "./identity";
export {
  marketingEligible,
  type MarketingEligibilityInput,
  optOutMarketing,
  recordConsentAtCheckout,
} from "./consent";
export { publishCgvVersion, sha256Hex } from "./cgv";
export {
  type CustomerOrderStats,
  type Segment,
  type SegmentCounts,
  computeSegment,
  segmentCounts,
} from "./segments";
export {
  type ChannelReachability,
  type ReachabilityCounts,
  type ReachabilityInput,
  channelReachability,
  reachabilityCounts,
  setPushEnrollment,
} from "./reachability";
export {
  type CustomerKPIs,
  type KpiReachabilityCounts,
  type KpiSegmentCounts,
  aggregateCustomerKPIs,
  logKpiConsultation,
} from "./kpi";
export { anonymizeCustomer, getCustomerForSupport } from "./rgpd";
