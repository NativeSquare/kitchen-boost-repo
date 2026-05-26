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
export {
  expireContract,
  generateContract,
  getContract,
  listContractsForProspect,
  refreshContractStatus,
  sendContract,
} from "./contracts";
