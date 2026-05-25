/**
 * Public API of the `uberDirect` backend module (chantier 2.6 — Delivery via
 * Uber Direct, PRD 40, delivery CONTEXT).
 *
 * 2.6-A — the credential persistence + delivery store socle. No real Uber call,
 * no UI: this slice lays the tenant-scoped `deliveries` table access + the
 * per-tenant Uber credential storage (REUSING the foundation `lib/crypto`
 * envelope encryption, `provider = "uber_direct"`, master key `KMS_MASTER_KEY`).
 *
 * Isolation (ADR 0010): every function goes through a tenancy wrapper and reaches
 * the datastore only through the sanctioned `lib/tenancy` / `lib/crypto` seams —
 * no raw `ctx.db` in this module. Decryption of the Uber credential is
 * ACTION-ONLY (never an exposed query — MOAT). Both sub-modules ship cross-tenant
 * fuzz suites.
 *
 * Convex registers functions by their module PATH, so callers invoke them as
 * `api.lib.uberDirect.credentials.*` / `api.lib.uberDirect.deliveries.*`;
 * re-exporting here does not change that path — it states the module's contract
 * in one place. The guarded query/mutation/action functions are therefore NOT
 * re-exported (a barrel re-export would not change their callable address); only
 * the shared TYPES + validators are surfaced here.
 *
 *  - credentials: `setUberCredentials` (write/rotate, audited), `getUberCredentialBlob`
 *    (encrypted envelope only), `getDecryptedUberCredentials` (ACTION — the only
 *    decrypt). Credential shape: `UberCredentials` / `uberCredentials`.
 *  - deliveries: `createDelivery`, `patchDelivery`, `listDeliveries`,
 *    `getDeliveryByOrder`.
 */
export { type UberCredentials, uberCredentials } from "./credentials";
