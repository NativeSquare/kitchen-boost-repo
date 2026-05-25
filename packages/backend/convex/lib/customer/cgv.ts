import { v } from "convex/values";
import {
  closeActiveCgvVersions,
  insertCgvVersion,
  kbAdminMutation,
} from "../tenancy";

/**
 * 2.1-C — CGV versioned archival (PRD 90 §1, ADR 0007).
 *
 * KB publishes the consumer-side CGV wording as a sequence of timestamped,
 * SHA-256-hashed versions. Each `recordConsentAtCheckout` stamps the customer's
 * fiche with the hash of the version ACTIVE at that moment, so KB can prove to
 * the CNIL WHICH exact wording a given customer accepted (ADR 0005 re-consent par
 * achat). INVARIANT: exactly one active version (no `endedAt`) at a time.
 *
 * The REAL legal wording (Q90-Q1) is a parallel lawyer task and is deliberately
 * NOT invented here: this slice ships the MECHANISM, and the real text is
 * injected later through `publishCgvVersion`. Tests use a fixture wording.
 *
 * The GLOBAL `cgvVersions` table is reached ONLY through the sanctioned tenancy
 * seam (`lib/tenancy/cgvArchive`), never raw `ctx.db` in this business module
 * (ADR 0010 / `no-untenanted-query`). Identity flows ONLY through the
 * `kbAdminMutation` wrapper (which uses `getCurrentActor`, ADR 0011).
 */

/**
 * SHA-256 of `wording`, lowercase hex (64 chars). Pure: Web Crypto `crypto.subtle`
 * (available in the Convex V8 runtime + the edge-runtime test env, same as the
 * envelope crypto of 1.x-E). The hash — not the text — is what gets stamped on
 * each customer fiche, so the wording can be matched back to its archived version.
 */
export async function sha256Hex(wording: string): Promise<string> {
  const data = new TextEncoder().encode(wording);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Publish a new CGV version (root only). Hashes the wording, closes the previous
 * active version (`endedAt`), and inserts the new one as the single active
 * version. Returns its SHA-256 hash (the value stamped on customer fiches at
 * checkout). Root-gated + auto-audited by `kbAdminMutation`.
 */
export const publishCgvVersion = kbAdminMutation({
  args: { wording: v.string() },
  action: "cgv.publish",
  handler: async (ctx, { wording }): Promise<string> => {
    const now = Date.now();
    const hash = await sha256Hex(wording);
    // Close the previous active version FIRST → exactly one active at a time.
    await closeActiveCgvVersions(ctx, now);
    await insertCgvVersion(ctx, { wording, hash, activatedAt: now });
    return hash;
  },
});
