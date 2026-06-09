import { ConvexError, type Infer, v } from "convex/values";
import { api, internal } from "../../_generated/api";
import { action, internalAction, internalQuery } from "../../_generated/server";
import {
  type EncryptedBlob,
  decryptForTenant,
  encryptForTenant,
  readTenantCredentialBlob,
  upsertTenantCredentialBlob,
} from "../crypto";
import {
  setTenantUberCustomerId,
  tenantMutation,
  tenantQuery,
} from "../tenancy";

/**
 * 2.6-A — Uber Direct per-tenant credential storage (PRD 40 §1, delivery
 * CONTEXT, ADR 0010 / 0011).
 *
 * Uber Direct is ALWAYS per-tenant — one account per pickup address, never shared
 * even with a common SIRET (multi-tenant CONTEXT "Uber Direct par tenant"). This
 * module REUSES the foundation crypto seam (1.x-E): the structured credential is
 * JSON-serialised, sealed with `encryptForTenant`, and upserted into the EXISTING
 * `tenantCredentials` row `provider = "uber_direct"` (NOT a new table). Plaintext
 * never touches the datastore; decryption happens ONLY inside an action.
 *
 * The credential FIELD NAMES are the documented Uber Direct ones, not invented:
 * `client_id` / `client_secret` / `customer_id` and the webhook signing key
 * (research/uber_direct_deep_dive §1.1 "Developer → Management" + §1.3 "Webhook
 * Signing Key" + §3.1). The OAuth token exchange / Organizations API calls that
 * USE these are deferred to later 2.6 stories — this slice is the credential
 * persistence + isolation + encryption socle only.
 *
 * Writing credentials goes through a guarded `tenantMutation`
 * (`allow: ["kb_manager"]`; kb_admin passes via root override, staff does not),
 * is AUDITED via `logAudit`, and links the tenant to its Uber sub-account by
 * stamping `tenants.uberCustomerId` (= `customer_id`). All `ctx.db` access is
 * delegated to the sanctioned `lib/crypto` / `lib/tenancy` seams — no raw
 * `ctx.db` here (`no-untenanted-query`).
 */

const PROVIDER = "uber_direct";

/**
 * The structured Uber Direct credential. `webhookSigningKey` is optional (the
 * resto adds it after registering the webhook in the Uber dashboard — research
 * §1.3 notes there is no API to register webhooks programmatically).
 */
export const uberCredentials = v.object({
  clientId: v.string(),
  clientSecret: v.string(),
  customerId: v.string(),
  webhookSigningKey: v.optional(v.string()),
});

export type UberCredentials = Infer<typeof uberCredentials>;

/**
 * Patch shape (all optional) for `patchUberCredentials` — partial update that
 * MERGES with the existing stored blob. Lets the admin UI update ONE field
 * (e.g. just the `webhookSigningKey` after configuring the Uber webhook)
 * without re-typing the 3 secrets. Refused if NO credentials exist yet (the
 * first set MUST use `setUberCredentials` with all 3 required fields, to
 * avoid persisting a malformed envelope).
 */
export const uberCredentialsPatch = v.object({
  clientId: v.optional(v.string()),
  clientSecret: v.optional(v.string()),
  customerId: v.optional(v.string()),
  webhookSigningKey: v.optional(v.string()),
});

const missingCredentials = () =>
  new ConvexError({
    code: "NOT_FOUND",
    message: "No Uber Direct credentials stored for this tenant.",
  });

// ---------------------------------------------------------------------------
// Write / rotate — guarded mutation. Encrypts before persisting (plaintext never
// reaches the datastore), links the Uber sub-account, and audits the write.
// ---------------------------------------------------------------------------

export const setUberCredentials = tenantMutation()({
  args: { credentials: uberCredentials },
  // Sensitive write — audited (the wrapper logs after the handler commits).
  audit: true,
  action: "uber.credentials.set",
  handler: async (ctx, args): Promise<void> => {
    // Seal the whole credential object as one opaque secret.
    const blob = await encryptForTenant(JSON.stringify(args.credentials));
    await upsertTenantCredentialBlob(ctx, ctx.tenantId, PROVIDER, blob);
    // Link the tenant to its Uber sub-account (one account per tenant).
    await setTenantUberCustomerId(
      ctx,
      ctx.tenantId,
      args.credentials.customerId,
    );
  },
});

/**
 * Partial update — merges `patch` with the existing decrypted blob, re-encrypts,
 * persists. Used by the admin UI to flip ONE field (typically the webhook
 * signing key, added after webhook setup on Uber side) without re-typing the
 * 3 secrets (UX gripe). Refuses `NOT_FOUND` if no creds exist (first-time
 * setup must use `setUberCredentials` to avoid persisting a partial envelope).
 *
 * Empty-string patch values are TREATED AS « unchanged » (the UI sends blanks
 * for the secrets the user didn't re-type — see `uber-direct-settings-view.tsx`).
 * To clear a field, the caller must explicitly clear it (not exposed in V1 —
 * the only field that could legitimately be cleared is `webhookSigningKey`,
 * which has no UI clear path today).
 */
export const patchUberCredentials = tenantMutation()({
  args: { patch: uberCredentialsPatch },
  audit: true,
  action: "uber.credentials.patch",
  handler: async (ctx, args): Promise<void> => {
    const existing = await readTenantCredentialBlob(
      ctx,
      ctx.tenantId,
      PROVIDER,
    );
    if (existing === null) throw missingCredentials();
    const plaintext = await decryptForTenant(existing);
    const current = JSON.parse(plaintext) as UberCredentials;

    // Empty string = « don't change » (the UI never sends a deliberate empty
    // string for a field the user wants cleared — see view comment above).
    const nonEmpty = (s: string | undefined): string | undefined =>
      s !== undefined && s.trim().length > 0 ? s.trim() : undefined;
    const merged: UberCredentials = {
      clientId: nonEmpty(args.patch.clientId) ?? current.clientId,
      clientSecret: nonEmpty(args.patch.clientSecret) ?? current.clientSecret,
      customerId: nonEmpty(args.patch.customerId) ?? current.customerId,
      webhookSigningKey:
        nonEmpty(args.patch.webhookSigningKey) ?? current.webhookSigningKey,
    };

    const newBlob = await encryptForTenant(JSON.stringify(merged));
    await upsertTenantCredentialBlob(ctx, ctx.tenantId, PROVIDER, newBlob);
    // Stamp customerId again only if it changed (cheap idempotent write).
    if (merged.customerId !== current.customerId) {
      await setTenantUberCustomerId(ctx, ctx.tenantId, merged.customerId);
    }
  },
});

// ---------------------------------------------------------------------------
// Read (encrypted) — guarded query. Returns ONLY the envelope, never plaintext.
// (Exposed for the fuzz suite + any server-side reader that wants the blob.)
// ---------------------------------------------------------------------------

export const getUberCredentialBlob = tenantQuery()({
  args: {},
  handler: async (ctx): Promise<EncryptedBlob | null> =>
    readTenantCredentialBlob(ctx, ctx.tenantId, PROVIDER),
});

// ---------------------------------------------------------------------------
// Decrypt — ACTION ONLY. The single place the plaintext credential is produced;
// the structured object is parsed back here. Never an exposed query (MOAT).
// ---------------------------------------------------------------------------

export const getDecryptedUberCredentials = action({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<UberCredentials> => {
    // The guarded blob query inherits THIS action's auth identity, so the tenant
    // access gate (Forbidden for an unauthorised caller) still applies; decrypt
    // happens in-memory here, the only place plaintext is produced.
    const blob = await ctx.runQuery(
      api.lib.uberDirect.credentials.getUberCredentialBlob,
      { tenantId: args.tenantId },
    );
    if (blob === null) throw missingCredentials();
    const plaintext = await decryptForTenant(blob);
    return JSON.parse(plaintext) as UberCredentials;
  },
});

// ---------------------------------------------------------------------------
// SYSTEM-SIDE decrypt — INTERNAL action for the no-actor flows (course creation
// at payment-confirmed, 2.6-C). Same MOAT discipline: decryption happens ONLY in
// an action, via an INTERNAL blob query (never the public gated query). The
// `tenantId` here is STRUCTURAL — it comes from a row the system already resolved
// (the seeded `deliveries`/`payments` row), never a user-supplied/forgeable arg —
// so isolation is structural (the same model as 2.5-B `confirmPaymentSucceeded`).
// Not callable from the client (internal), so it is NOT an unguarded public leak.
// ---------------------------------------------------------------------------

/** INTERNAL system-side blob read (structural tenantId). Envelope only. */
export const readUberCredentialBlobSystem = internalQuery({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<EncryptedBlob | null> =>
    readTenantCredentialBlob(ctx, args.tenantId, PROVIDER),
});

export const getDecryptedUberCredentialsSystem = internalAction({
  args: { tenantId: v.id("tenants") },
  handler: async (ctx, args): Promise<UberCredentials> => {
    const blob = await ctx.runQuery(
      internal.lib.uberDirect.credentials.readUberCredentialBlobSystem,
      { tenantId: args.tenantId },
    );
    if (blob === null) throw missingCredentials();
    const plaintext = await decryptForTenant(blob);
    return JSON.parse(plaintext) as UberCredentials;
  },
});
