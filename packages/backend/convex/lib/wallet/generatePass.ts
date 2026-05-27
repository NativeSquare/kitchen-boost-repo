"use node";

import crypto from "node:crypto";
import { ConvexError, v } from "convex/values";
import { api, internal } from "../../_generated/api";
import { action, internalAction } from "../../_generated/server";
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
 * Extract the PEM signer certificate + (encrypted) private key from a PKCS#12
 * bundle. `passkit-generator` wants a PEM cert + PEM key, NOT a raw p12, so the
 * env `WALLET_PASS_CERT_P12_BASE64` (the Pass Type ID p12 the POC round-tripped)
 * is unpacked here with `node-forge` (the pure-JS lib passkit-generator already
 * relies on — POC #3, no native OpenSSL binding). The key stays PEM-encrypted; we
 * hand its passphrase to passkit-generator via `signerKeyPassphrase`.
 */
async function pemFromP12(
  p12Base64: string,
  passphrase: string,
): Promise<{ signerCert: string; signerKey: string }> {
  const forge = (await import("node-forge")).default;
  const der = forge.util.decode64(p12Base64);
  const asn1 = forge.asn1.fromDer(der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, passphrase);

  const certBag = p12.getBags({ bagType: forge.pki.oids.certBag })[
    forge.pki.oids.certBag
  ]?.[0];
  const keyBag = p12.getBags({
    bagType: forge.pki.oids.pkcs8ShroudedKeyBag,
  })[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!certBag?.cert || !keyBag?.key) {
    throw new ConvexError({
      code: "MISCONFIGURED",
      message: "Pass Type ID p12 is missing its certificate or private key.",
    });
  }

  return {
    signerCert: forge.pki.certificateToPem(certBag.cert),
    // Re-encrypt the key with the same passphrase so it travels PEM-encrypted;
    // passkit-generator decrypts it with `signerKeyPassphrase`.
    signerKey: forge.pki.encryptRsaPrivateKey(keyBag.key, passphrase),
  };
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

  const { signerCert, signerKey } = await pemFromP12(p12B64, passphrase);
  const { PKPass } = await import("passkit-generator");
  const instance = new PKPass(
    { "pass.json": Buffer.from(JSON.stringify(pass)) },
    {
      wwdr: Buffer.from(wwdrB64, "base64"),
      signerCert,
      signerKey,
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

// ---------------------------------------------------------------------------
// signPkpassForSerial — re-serve the latest .pkpass for an EXISTING serial (US 9)
// ---------------------------------------------------------------------------

/**
 * 2.8-B — INTERNAL `"use node"` action that REBUILDS + signs the latest `.pkpass`
 * for an EXISTING serial (US 9, the Web Service `GET pass/[serial]` re-download).
 *
 * The device-facing HTTP route (`apps/admin/api/wallet/pass/[serial]`, Node
 * runtime) verifies the PassKit auth token, then asks this seam for the signed
 * bytes — REUSING slice A's signing (`signApplePkpass`, POC #3) and the pure
 * builder (`buildApplePassJson`), so the binary path lives in ONE place (the
 * `"use node"` runtime, STACK §2.3) and is never duplicated/forked.
 *
 * The pass content is deterministic from the persisted `walletPasses` row
 * (`getPassRebuildContext`: serial + the brand resto name, ADR 0003) — NOT a fresh
 * generation, NO new serial, NO customer scope (the device re-downloads a card it
 * already owns; the auth is the PassKit token checked in the Node route). An unknown
 * serial throws NOT_FOUND (the route answers 404 — no fabricated pass).
 *
 * Returns the Apple `pass.json` structure + the signed bytes as base64 (or `null`
 * in CI / dev when the real certs are absent — the structure is still
 * mergeable/testable, the real signature is HITL: POC #3 + device e2e).
 */
export const signPkpassForSerial = internalAction({
  args: { serialNumber: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    applePass: ApplePassJson;
    signed: boolean;
    pkpassBase64: string | null;
  }> => {
    const rebuild = await ctx.runQuery(
      internal.lib.wallet.passDb.getPassRebuildContext,
      { serialNumber: args.serialNumber },
    );
    if (rebuild === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Unknown pass serial.",
      });
    }

    const applePass = buildApplePassJson({
      serialNumber: rebuild.serialNumber,
      brandTenantName: rebuild.brandTenantName ?? undefined,
    });
    const signed = await signApplePkpass(applePass);

    return {
      applePass,
      signed: signed !== null,
      pkpassBase64:
        signed === null ? null : Buffer.from(signed).toString("base64"),
    };
  },
});
