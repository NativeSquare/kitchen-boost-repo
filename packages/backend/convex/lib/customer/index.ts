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
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.customer.identity.*` / `api.lib.customer.consent.*` /
 * `api.lib.customer.cgv.*`; re-exporting here does not change that path, it just
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
