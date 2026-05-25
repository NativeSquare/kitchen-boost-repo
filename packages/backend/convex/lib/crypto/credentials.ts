import { ConvexError, v } from "convex/values";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  action,
} from "../../_generated/server";
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
// Reusable seam helpers — the sanctioned `ctx.db` access to `tenantCredentials`
// (this `lib/crypto/**` path is exempt from `no-untenanted-query`, ADR 0010).
// They take an ALREADY-GATED `tenantId` (sourced from `ctx.tenantId` inside a
// tenant wrapper handler), so a business module can reuse the per-tenant secret
// store WITHOUT raw `ctx.db` of its own. The encryption itself is done by the
// caller via `encryptForTenant` so plaintext never crosses this boundary.
// ---------------------------------------------------------------------------

/**
 * Upsert one provider's sealed blob for `tenantId` (one row per
 * (tenantId, provider), index `by_tenant_provider`). Returns the row id.
 */
export async function upsertTenantCredentialBlob(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  provider: string,
  blob: EncryptedBlob,
): Promise<Id<"tenantCredentials">> {
  const now = Date.now();
  const existing = await ctx.db
    .query("tenantCredentials")
    .withIndex("by_tenant_provider", (q) =>
      q.eq("tenantId", tenantId).eq("provider", provider),
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
    tenantId,
    provider,
    ciphertext: blob.ciphertext,
    iv: blob.iv,
    authTag: blob.authTag,
    keyVersion: blob.keyVersion,
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Read ONLY the encrypted envelope (never plaintext) for `tenantId` + provider,
 * or `null`. The single tenant-scoped read seam shared by the guarded query and
 * any business module's blob reader.
 */
export async function readTenantCredentialBlob(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  provider: string,
): Promise<EncryptedBlob | null> {
  const row = await ctx.db
    .query("tenantCredentials")
    .withIndex("by_tenant_provider", (q) =>
      q.eq("tenantId", tenantId).eq("provider", provider),
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
}

// ---------------------------------------------------------------------------
// Write — guarded mutation, encrypts before persisting. (default allow:
// kb_manager; kb_admin root override). Plaintext never touches the datastore.
// ---------------------------------------------------------------------------

export const storeTenantCredential = tenantMutation()({
  args: { provider: v.string(), plaintext: v.string() },
  handler: async (ctx, args) => {
    const blob = await encryptForTenant(args.plaintext);
    return upsertTenantCredentialBlob(ctx, ctx.tenantId, args.provider, blob);
  },
});

// ---------------------------------------------------------------------------
// Read (encrypted) — guarded query. Returns ONLY the envelope, never plaintext.
// ---------------------------------------------------------------------------

export const getTenantCredentialBlob = tenantQuery()({
  args: { provider: v.string() },
  handler: async (ctx, args): Promise<EncryptedBlob | null> =>
    readTenantCredentialBlob(ctx, ctx.tenantId, args.provider),
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
