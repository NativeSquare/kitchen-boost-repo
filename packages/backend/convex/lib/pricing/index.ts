/**
 * Public API of the `pricing` backend module (chantier 2.4 — Pricing engine,
 * backend-only, ADR 0013).
 *
 * 2.4-B — the TENANT-SCOPED persisted rules + CRUD, sitting on top of the pure
 * evaluator in `@packages/shared/pricing` (#29, the rule shape is shared). Every
 * CRUD function goes through the tenancy wrappers (`tenantQuery` / `tenantMutation`,
 * `allow: ["kb_manager"]`) and reaches the `pricingRules` table ONLY through the
 * sanctioned `lib/tenancy/pricingRulesStore` seam — never raw `ctx.db` in this
 * business module (ADR 0010 / `no-untenanted-query`). No UI here (ADR 0013).
 *
 * Convex registers functions by their module PATH, so callers invoke the CRUD as
 * `api.lib.pricing.rules.{list,create,update,setActive,remove}`; re-exporting here
 * does not change that path — it states the module's contract in one place.
 *
 *  - `rules.*` — the CRUD (`list` / `create` / `update` / `setActive` / `remove`).
 *  - `installDefaultPricingRule` — the onboarding seam the provisioning wizard
 *    (2.9) calls to pre-install the 10 % default rule (PRD 35 §7).
 *  - `findConditionContradiction` — the pure save-time validator (PRD 35 edge case).
 */
export { create, list, remove, setActive, update } from "./rules";
export {
  DEFAULT_ONBOARDING_PERCENT,
  installDefaultPricingRule,
} from "./defaultRule";
export { findConditionContradiction } from "./contradictions";
