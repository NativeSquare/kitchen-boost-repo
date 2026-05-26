/**
 * Public API of the `onboarding` backend module (chantier 2.9 — KB Admin
 * backend, PRD 70, kb-admin CONTEXT).
 *
 * 2.9-B — the minimalist CRM KB CRUD over the KB-ADMIN-GLOBAL `prospects` table,
 * plus the pure CSV parser the one-shot seed migration uses. Every CRM function
 * goes through the ROOT wrappers (`kbAdminQuery` / `kbAdminMutation`) and reaches
 * the table ONLY through the sanctioned `lib/tenancy/prospectsStore` seam — never
 * raw `ctx.db` in this business module (ADR 0010 / `no-untenanted-query`). No UI
 * here (the Kanban / CRM cards are front Train B).
 *
 * Convex registers functions by their module PATH, so callers invoke the CRUD as
 * `api.lib.onboarding.crm.{createProspect,editProspect,logInteraction,changePhase,
 * getProspect,listProspects}`; the seed migration itself lives in
 * `convex/migrations.ts` (`seedProspectsFromCsv`) next to the `@convex-dev/migrations`
 * runner. Re-exporting here does not change those paths — it states the module's
 * contract in one place (BMAD convention: no cross-module import outside this index).
 *
 *  - `crm.*` — the CRM CRUD (create / edit / logInteraction / changePhase) + reads
 *    (getProspect / listProspects). Manual phase change ONLY; the pipeline state
 *    machine (transitions + `evaluateClosing`) is slice C.
 *  - `parseProspectsCsv` / `SeedProspect` — the pure, deterministic CSV → prospect
 *    transform the seed uses (returns `[]` for an absent/empty CSV — never fabricates).
 *  - `bundledSeedProspects` / `CRM_PROSPECTS_CSV` — the bundled (currently empty)
 *    CSV payload (the real CSV is NOT versioned: PII must not be committed).
 *  - `missingMilestonesForPhase` — the pure indicative-gate check (PRD 70 §3.3,
 *    Q70-Q10) backing the bypass logging.
 *  - 2.9-C pipeline state machine + composite Closing auto-bascule:
 *    `evaluateClosing` (pure composite Closing evaluator), the ordered phase
 *    state machine (`PHASE_ORDER` / `isLegalPhaseTransition` /
 *    `assertLegalPhaseTransition`), and the `applyClosing` `kbAdminMutation` that
 *    wires the pure evaluator into the ONLY automatic transition (Acquisition →
 *    Préparation). Callers invoke the mutation as
 *    `api.lib.onboarding.pipeline.applyClosing`.
 *  - 2.9-E tenant provisioning wizard (PRD 70 §3.6, multi-tenant CONTEXT
 *    "Provisioning"): `provisionTenant` (`kbAdminMutation`, root-only) turns a
 *    prospect into a live tenant (unique slug → tenant → KB Manager via
 *    `userTenants` → customDomain public face + bootstrap sub-domain fallback →
 *    QR data → soft Stripe `account_link` flag → prospect back-link), invoked as
 *    `api.lib.onboarding.provisioning.provisionTenant`. Plus the pure helpers
 *    `generateSlug` / `tenantPwaUrl` / `tenantBootstrapUrl`.
 */
export {
  changePhase,
  createProspect,
  editProspect,
  getProspect,
  listProspects,
  logInteraction,
} from "./crm";
export { type SeedProspect, parseProspectsCsv } from "./csv";
export { CRM_PROSPECTS_CSV, bundledSeedProspects } from "./seedData";
export { missingMilestonesForPhase } from "./gates";
export {
  type ClosingEvaluation,
  PHASE_ORDER,
  applyClosing,
  assertLegalPhaseTransition,
  evaluateClosing,
  isLegalPhaseTransition,
} from "./pipeline";
export {
  generateSlug,
  provisionTenant,
  tenantBootstrapUrl,
  tenantPwaUrl,
} from "./provisioning";
