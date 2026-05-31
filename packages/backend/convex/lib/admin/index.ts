/**
 * Public API of the `admin` backend module (chantier 2.9 — KB Admin backend,
 * PRD 70, kb-admin CONTEXT).
 *
 * 2.9-D — contract generation (the TypeScript port of `generate_contract.py` over
 * the canonical `docs/legal/contrat_template.md`) and the contract lifecycle
 * `draft → sent → signed` (+ `expired`) over the KB-ADMIN-GLOBAL `contracts`
 * table. Every mutation goes through the ROOT wrapper (`kbAdminMutation`) and
 * reaches the table ONLY through the sanctioned `lib/tenancy/contractsStore`
 * seam — never raw `ctx.db` in this business module (ADR 0010 /
 * `no-untenanted-query`). No UI here (the "Générer contrat" button is front
 * Train B). This index states the module's contract in one place (BMAD
 * convention: no cross-module import outside this index).
 *
 *  - `generateContractHtml` / `PartnerFiche` / `Prestation` — the PURE renderer
 *    (input → HTML; no DB, no ctx): conditional-block resolution (handling nested
 *    markers) + Partenaire placeholder substitution, from the canonical template.
 *  - lifecycle state machine — `CONTRACT_STATUS_TRANSITIONS` /
 *    `isLegalContractTransition` / `assertLegalContractTransition` /
 *    `ContractStatus`. The single source of truth for legal status transitions.
 *  - `contracts.*` — the `kbAdminMutation`s (generate → draft, send → sent +
 *    odooLink, refreshContractStatus → signed, expire → expired; each dated +
 *    auto-audited) and reads (getContract / listContractsForProspect). Convex
 *    registers them by module path, so callers invoke
 *    `api.lib.admin.contracts.{...}`; re-exporting here states the contract.
 *
 * 2.9-F — monitoring hooks (PRD 70 §3.8, kb-admin CONTEXT "Monitoring
 * incidents"): the PURE incident detectors + Slack text formatter (input →
 * `Incident[]`; no DB, no ctx — testable in isolation), the root-only
 * `previewIncidents` query, and the scheduled `runMonitoringScan` ops action
 * (scan → one Slack ops alert per incident). Detections: webhook latency > 30 s,
 * KYC pending > 48 h, paid order with no Uber course. The 2.5/2.6 sources are
 * feature-flagged off until they land; the alerting plumbing is live today.
 */
export {
  type GenerateContractInput,
  type PartnerFiche,
  type Prestation,
  generateContractHtml,
} from "./generateContract";
export {
  type ContractStatus,
  CONTRACT_STATUS_TRANSITIONS,
  assertLegalContractTransition,
  isLegalContractTransition,
} from "./lifecycle";
// B-TENANT-LIFECYCLE [2/4] — pure tenant lifecycle state machine + settings
// validation helpers, co-located with the contract lifecycle (same pattern).
// Consumed by the upcoming `tenant.updateSettings` (D5) and `tenant.activate`
// (D6) mutations. NO DB, NO ctx — both modules are trivially unit-testable.
export {
  TENANT_STATUS_TRANSITIONS,
  type TenantStatus,
  assertLegalTenantTransition,
  isLegalTenantTransition,
} from "./tenantLifecycle";
export {
  assertNonEmptyString,
  isValidHexColor,
  normalisePhone,
} from "./tenantSettingsValidation";
// B-TENANT-LIFECYCLE [3/4] — `tenant.updateSettings` mutation (D5 élargi,
// PRD 70 §3.6 step 4 + §4.8). Wrapper: tenantMutation({ allow: ["kb_manager"],
// audit: true, action: "tenant.updateSettings" }); kb_admin root override
// (withTenant.ts) covers the wizard caller — one mutation, two callers.
// Convex registers it as `api.lib.admin.tenantSettings.updateSettings`.
//
// B-TENANT-LIFECYCLE [4/4] — `tenant.activate` mutation (D6, PRD 70 §3.6
// step 8). Wrapper: kbAdminMutation({ action: "tenant.activate" }) — root-only,
// flips a freshly-provisioned tenant `pending → active`. Defers to
// assertLegalTenantTransition (V1 strict: only `pending → active`); double
// audit (wrapper auto + explicit metadata.fromStatus). Convex registers it as
// `api.lib.admin.tenantSettings.activate`.
export { activate, updateSettings } from "./tenantSettings";
export {
  expireContract,
  generateContract,
  getContract,
  listContractsForProspect,
  refreshContractStatus,
  sendContract,
} from "./contracts";
// B-AUTH-4 (#204, EPIC #134) — `inviteManager` mutation, root-only manager
// pendant of `inviteAdmin`. Routes through `kbAdminMutation` + the sanctioned
// `lib/tenancy/adminInvitesStore` seam (ADR 0010 / `no-untenanted-query`).
// Convex registers it by module path, so callers invoke
// `api.lib.admin.managerInvites.inviteManager`.
// F-WIZARD [9/10] (#273) — `getLatestManagerInviteForTenant` root-only read
// used by the wizard's Step 7 + `useWizardState` (canonical step-7 completion
// gate per the issue spec: « marque step 7 complete si une ligne managerInvites
// existe pour le tenant, peu importe acceptedAt »). Same sanctioned store seam
// as `inviteManager` (ADR 0010 / `no-untenanted-query`).
export {
  getLatestManagerInviteForTenant,
  inviteManager,
} from "./managerInvites";
export {
  type CourseScanDelivery,
  type Incident,
  KYC_PENDING_THRESHOLD_MS,
  type KycProvider,
  type KycScanProspect,
  type PaidScanOrder,
  type ScanInput,
  WEBHOOK_LATENCY_THRESHOLD_MS,
  type WebhookLatencySample,
  collectIncidents,
  detectKycPendingIncidents,
  detectPaidOrdersWithoutCourse,
  detectWebhookLatencyIncidents,
  formatIncidentSlackText,
  previewIncidents,
  runMonitoringScan,
  scanIncidents,
} from "./monitoring";
