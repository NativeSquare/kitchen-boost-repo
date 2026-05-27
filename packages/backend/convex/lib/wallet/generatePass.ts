"use node";

import crypto from "node:crypto";
import { ConvexError, v } from "convex/values";
import { api, internal } from "../../_generated/api";
import { action } from "../../_generated/server";
import {
  type ApplePassJson,
  buildApplePassJson,
  buildGoogleWalletClaims,
  googleWalletSaveLink,
} from "./passBuilders";

/**
 * 2.8-A — generate the COMMON neutral Wallet card (ADR 0003) in BOTH ecosystems,
 * no UI. The first slice of the Wallet chantier (PRD 80 Notifications).
 *
 * ── Where it runs (POC #3 / Phase B) ──────────────────────────────────────────
 * A Convex `"use node"` action. The POC validated the REAL signing here: a signed
 * `.pkpass` (PKCS#7 via `passkit-generator` + node-forge, pure JS) AND a Google
 * "Save to Wallet" JWT (RS256, Node `crypto`) — so NO Next.js Node plan B is
 * needed (STACK §2.3, `docs/spikes/poc-wallet-real-sign.md`). The action↔mutation
 * split (STACK §2.3): the signing runs in THIS action, the query/mutation seams it
 * calls live in `passDb.ts` (Convex forbids queries/mutations in a `"use node"`
 * module), and the DB write is ordered AFTER the signing.
 *
 * ── Secrets server-side only (US 22) ──────────────────────────────────────────
 * The Apple p12 / passphrase and the Google service-account JSON are read from ENV
 * vars HERE (server-side) — NEVER committed, NEVER returned by a query. There is
 * deliberately NO query that returns them; this module's ONLY exposed entry is the
 * action below.
 *
 * ── Common neutral card (ADR 0003) ────────────────────────────────────────────
 * FIXED `passTypeIdentifier` (invisible client); NO authoritative `tenantId` on the
 * pass; the visible branding (header = last resto ordered, "Membre [Nom carte]") is
 * a USAGE carried by `lastBrandTenantId`. The pass references the Customer for
 * technical state only — the authoritative serial→customer bridge lives in 2.1
 * (`customers.pushEnrollment`, ADR 0008/0012), not duplicated here.
 *
 * ── Scope self (ADR 0010/0011) ────────────────────────────────────────────────
 * Customer-scoped: a client generates only its OWN card. The guard query
 * `resolveOwnPassContext` (in `passDb.ts`, a `customerQuery` — refuses PRO /
 * anonymous, keyed on `ctx.actor.userId`) resolves the caller's own fiche +
 * validates the optional brand tenant BEFORE any signing. It is the mandatory
 * cross-tenant fuzz target.
 */

// ---------------------------------------------------------------------------
// Signing — private helpers (real certs from env; absent in CI ⇒ unsigned struct)
// ---------------------------------------------------------------------------

/** Base64url-encode a JSON value (JWT segment encoding). */
function b64urlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/**
 * Sign the Google "Save to Wallet" JWT (RS256) with the service-account private key
 * read from `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` (base64 of the SA JSON). Runs for
 * real in `"use node"` (Node `crypto`), exactly like the POC. Returns the full save
 * link. Throws MISCONFIGURED if the SA / issuer env is absent.
 */
function signGoogleSaveLink(
  serialNumber: string,
  brandTenantName: string | null,
): string {
  const saB64 = process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON;
  const issuerId = process.env.GOOGLE_WALLET_ISSUER_ID;
  if (!saB64 || !issuerId) {
    throw new ConvexError({
      code: "MISCONFIGURED",
      message: "Google Wallet service account / issuer id is not configured.",
    });
  }
  const sa = JSON.parse(Buffer.from(saB64, "base64").toString("utf8")) as {
    client_email: string;
    private_key: string;
  };
  const origins = (process.env.WALLET_SAVE_ORIGINS ?? "")
    .split(",")
    .map((o: string) => o.trim())
    .filter((o: string) => o.length > 0);

  const claims = buildGoogleWalletClaims({
    serialNumber,
    issuerId,
    classId: `${issuerId}.kb-card`,
    serviceAccountEmail: sa.client_email,
    origins,
    brandTenantName: brandTenantName ?? undefined,
  });

  const header = { alg: "RS256", typ: "JWT" };
  const signingInput = `${b64urlJson(header)}.${b64urlJson(claims)}`;
  const signature = crypto
    .sign("RSA-SHA256", Buffer.from(signingInput), sa.private_key)
    .toString("base64url");
  return googleWalletSaveLink(`${signingInput}.${signature}`);
}

/**
 * Sign the `.pkpass` (PKCS#7) with the real Apple certs read from env
 * (`WALLET_PASS_CERT_P12_BASE64` + `WALLET_PASS_CERT_PASSWORD` + `WALLET_WWDR_CERT_BASE64`),
 * via `passkit-generator` (POC #3 / Phase B). Returns the signed bundle bytes, or
 * `null` when the certs are absent (CI / dev): the structure is still testable +
 * mergeable, the real signature is validated by the POC + a device e2e (HITL).
 */
async function signApplePkpass(
  pass: ApplePassJson,
): Promise<Uint8Array | null> {
  const p12B64 = process.env.WALLET_PASS_CERT_P12_BASE64;
  const passphrase = process.env.WALLET_PASS_CERT_PASSWORD;
  const wwdrB64 = process.env.WALLET_WWDR_CERT_BASE64;
  if (!p12B64 || !passphrase || !wwdrB64) return null;

  const { PKPass } = await import("passkit-generator");
  const instance = new PKPass(
    { "pass.json": Buffer.from(JSON.stringify(pass)) },
    {
      wwdr: Buffer.from(wwdrB64, "base64"),
      signerCert: Buffer.from(p12B64, "base64"),
      signerKey: Buffer.from(p12B64, "base64"),
      signerKeyPassphrase: passphrase,
    },
  );
  return instance.getAsBuffer();
}

// ---------------------------------------------------------------------------
// generatePass — the public action
// ---------------------------------------------------------------------------

export const generatePass = action({
  args: {
    // Consumed by the customer wrapper of the guard query (scope self).
    tenantId: v.id("tenants"),
    // The LAST resto ordered → the visible brand on the card (a USAGE, ADR 0003).
    brandTenantId: v.optional(v.id("tenants")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    serialNumber: string;
    applePass: ApplePassJson;
    /** True iff the real Apple certs were present and the `.pkpass` was signed. */
    appleSigned: boolean;
    googleSaveLink: string;
  }> => {
    // Scope self + resolve the OWN fiche + userId + validate the optional brand
    // tenant, BEFORE any signing. A PRO / anonymous / unknown-tenant caller is
    // refused here (identity from the guard's getCurrentActor, ADR 0011 — the action
    // never touches ctx.auth directly).
    const { userId, brandTenantName, brandTenantId } = await ctx.runQuery(
      api.lib.wallet.passDb.resolveOwnPassContext,
      { tenantId: args.tenantId, brandTenantId: args.brandTenantId },
    );

    // Opaque, unguessable serial — the pass primary key + the update address.
    const serialNumber = `kb-${crypto.randomUUID()}`;

    // Build the Apple structure + (when real certs present) sign the `.pkpass`.
    const applePass = buildApplePassJson({
      serialNumber,
      brandTenantName: brandTenantName ?? undefined,
    });
    const signedApple = await signApplePkpass(applePass);

    // Build + sign the Google "Save to Wallet" JWT (RS256, runs for real).
    const googleSaveLink = signGoogleSaveLink(serialNumber, brandTenantName);

    // DB write OUT of the action, ordered after the signing.
    await ctx.runMutation(internal.lib.wallet.passDb.recordGeneratedPass, {
      userId,
      serialNumber,
      brandTenantId: brandTenantId ?? undefined,
    });

    return {
      serialNumber,
      applePass,
      appleSigned: signedApple !== null,
      googleSaveLink,
    };
  },
});
