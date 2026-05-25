/**
 * Public API of the `crypto` foundation module (1.x-E) — in-house envelope
 * encryption of per-tenant secrets (Uber Direct credentials in V1), STACK.md
 * §2.5. AES-256-GCM via Web Crypto `crypto.subtle`, master key from the Convex
 * env var `KMS_MASTER_KEY`.
 *
 * Consume the crypto primitives from HERE:
 *  - `encryptForTenant(plaintext) → EncryptedBlob` — seal a secret.
 *  - `decryptForTenant(blob) → plaintext` — open a secret. CALL FROM A CONVEX
 *    ACTION ONLY (never an exposed query); see `credentials.getDecrypted…`.
 *  - `packBlob` / `unpackBlob` — (de)serialise a blob to/from the single packed
 *    string `iv + authTag + ciphertext + keyVersion`.
 *  - `KEY_VERSION`, `EncryptedBlob` — the version stamp and at-rest shape.
 *
 * The Convex functions that store/read/decrypt credentials
 * (`storeTenantCredential`, `getTenantCredentialBlob`,
 * `getDecryptedTenantCredential`) are registered by their module path
 * (`api.lib.crypto.credentials.*`), not re-exported here — Convex registers
 * functions by path, and a barrel re-export of a guarded query/mutation/action
 * would not change its callable address.
 *
 * There is deliberately NO query that decrypts: decryption is action-only, so
 * the plaintext secret never transits an exposed query.
 */
export {
  KEY_VERSION,
  type EncryptedBlob,
  decryptForTenant,
  encryptForTenant,
  packBlob,
  unpackBlob,
} from "./envelope";

/**
 * Reusable per-tenant credential SEAMS (plain functions, not Convex functions):
 *  - `upsertTenantCredentialBlob` / `readTenantCredentialBlob` — the sanctioned
 *    `ctx.db` access to `tenantCredentials`, taking an already-gated `tenantId`.
 *    A business module (e.g. `lib/uberDirect`, 2.6-A) reuses the secret store
 *    through these instead of rolling its own raw `ctx.db` (which the
 *    `no-untenanted-query` rule forbids outside this exempt path).
 */
export {
  readTenantCredentialBlob,
  upsertTenantCredentialBlob,
} from "./credentials";
