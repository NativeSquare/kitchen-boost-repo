import { ConvexError, v } from "convex/values";
import { api } from "../../_generated/api";
import { action } from "../../_generated/server";
import { tenantMutation, tenantQuery } from "../tenancy";
import {
  type EncryptedBlob,
  decryptForTenant,
  encryptForTenant,
} from "./envelope";

/**
 * 1.x-E — per-tenant credential storage built on the tenancy wrappers (1.x-C)
 * and the envelope crypto (`./envelope`).
 *
 * Three pieces, each respecting a guardrail:
 *  - `storeTenantCredential` — a GUARDED `tenantMutation`: it encrypts the
 *    plaintext (so plaintext NEVER reaches the datastore) and upserts the sealed
 *    blob into `tenantCredentials`. Returns the row id only.
 *  - `getTenantCredentialBlob` — a GUARDED `tenantQuery` returning ONLY the
 *    encrypted envelope (`iv`, `authTag`, `ciphertext`, `keyVersion`). It NEVER
 *    decrypts — the plaintext secret never transits an exposed query (MOAT /
 *    STACK.md §2.5: "decrypt à la volée dans Convex actions seulement").
 *  - `getDecryptedTenantCredential` — an `action`: the ONLY place decryption
 *    happens. It re-uses the guarded query (via `ctx.runQuery`, which inherits
 *    the caller's auth identity, so the tenant gate still applies) to fetch the
 *    blob, then decrypts in-memory and returns the plaintext to its (server-side)
 *    caller. No exposed query ever returns plaintext.
 *
 * Provider for V1 is `uber_direct` (Uber Direct credentials). The
 * `tenantCredentials` table enforces one row per (tenantId, provider)
 * applicatively (its index `by_tenant_provider`), so `storeTenantCredential`
 * upserts.
 */

const notFound = (provider: string) =>
  new ConvexError({
    code: "NOT_FOUND",
    message: `No credential stored for provider "${provider}" on this tenant.`,
  });

// ---------------------------------------------------------------------------
// Write — guarded mutation, encrypts before persisting. (default allow:
// kb_manager; kb_admin root override). Plaintext never touches the datastore.
// ---------------------------------------------------------------------------

export const storeTenantCredential = tenantMutation()({
  args: { provider: v.string(), plaintext: v.string() },
  handler: async (ctx, args) => {
    const blob = await encryptForTenant(args.plaintext);
    const now = Date.now();

    const existing = await ctx.db
      .query("tenantCredentials")
      .withIndex("by_tenant_provider", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("provider", args.provider),
      )
      .unique();

    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        ciphertext: blob.ciphertext,
        iv: blob.iv,
        authTag: blob.authTag,
        keyVersion: blob.keyVersion,
        updatedAt: now,
      });
      return existing._id;
    }

    return ctx.db.insert("tenantCredentials", {
      tenantId: ctx.tenantId,
      provider: args.provider,
      ciphertext: blob.ciphertext,
      iv: blob.iv,
      authTag: blob.authTag,
      keyVersion: blob.keyVersion,
      createdAt: now,
      updatedAt: now,
    });
  },
});

// ---------------------------------------------------------------------------
// Read (encrypted) — guarded query. Returns ONLY the envelope, never plaintext.
// ---------------------------------------------------------------------------

export const getTenantCredentialBlob = tenantQuery()({
  args: { provider: v.string() },
  handler: async (ctx, args): Promise<EncryptedBlob | null> => {
    const row = await ctx.db
      .query("tenantCredentials")
      .withIndex("by_tenant_provider", (q) =>
        q.eq("tenantId", ctx.tenantId).eq("provider", args.provider),
      )
      .unique();
    if (row === null) return null;
    // Project to the envelope only — deliberately no plaintext, no decrypt here.
    return {
      iv: row.iv,
      authTag: row.authTag,
      ciphertext: row.ciphertext,
      keyVersion: row.keyVersion,
    };
  },
});

// ---------------------------------------------------------------------------
// Decrypt — ACTION ONLY. The single place plaintext is produced.
// ---------------------------------------------------------------------------

export const getDecryptedTenantCredential = action({
  args: { tenantId: v.id("tenants"), provider: v.string() },
  handler: async (ctx, args): Promise<string> => {
    // The guarded query inherits this action's auth identity, so the tenant
    // access gate (Forbidden for an unauthorised caller) still applies here.
    const blob = await ctx.runQuery(
      api.lib.crypto.credentials.getTenantCredentialBlob,
      { tenantId: args.tenantId, provider: args.provider },
    );
    if (blob === null) throw notFound(args.provider);
    return decryptForTenant(blob);
  },
});
