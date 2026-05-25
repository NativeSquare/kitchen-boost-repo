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
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.customer.identity.*`; re-exporting here does not change that path, it
 * just states the module's contract in one place.
 */
export { getCurrentCustomer, getOrCreateCurrentCustomer } from "./identity";
