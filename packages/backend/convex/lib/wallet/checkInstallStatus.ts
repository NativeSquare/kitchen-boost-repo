import { v } from "convex/values";
import { customerQuery } from "../tenancy/customer";
import { readCustomerFicheByUser, readWalletPassBySerial } from "../tenancy";

/**
 * PWA-S6a (#455) — `checkInstallStatus`, the "Tester sans attendre" poll surface
 * of the Wallet install loader (decisions-log Q8 « Flow async install Wallet :
 * loader 30s + Tester sans attendre + J'ai changé d'avis », US 33).
 *
 * ── Source of truth ───────────────────────────────────────────────────────────
 * `walletPasses.status` (TECHNICAL state of the pass row) — flipped to
 * `"installed"` by 2.8-C `setWalletPassInstalled` once the Apple PassKit
 * `register` / Google Wallet add webhook is processed by `handlePassInstalled`
 * inside `withIdempotence`. The query returns the boolean derived from that
 * single field — NOT the raw row, NOT the customerId. The Convex sub on the
 * 2.1 customer fiche (`pushEnrollment.walletStatus`) is what auto-closes the
 * modal; THIS query is the EXPLICIT poll the loader's secondary button drives
 * when the user does not want to wait for the 30 s timeout.
 *
 * ── Self-scoped, no existence leak (ADR 0010 / 0012) ──────────────────────────
 * Built on `customerQuery` (anonymous + PRO refused by the wrapper). The poll
 * is allowed ONLY for a serial the caller OWNS: the pass row's `customerId`
 * must equal the fiche resolved by `readCustomerFicheByUser(ctx.actor.userId)`.
 * If the serial does not exist OR belongs to ANOTHER customer, the query
 * returns `{ installed: false }` rather than throwing — both cases reduce to
 * "keep waiting" from the UI's point of view, and throwing on a foreign serial
 * would let a probing attacker enumerate other customers' serials. The MOAT
 * (no raw `customer` to a manager) is structurally preserved: the return shape
 * is `{ installed: boolean }`, period.
 *
 * ── Sanctioned tenancy seam ───────────────────────────────────────────────────
 * Reads go through `readWalletPassBySerial` (the GLOBAL `walletPasses` table is
 * exempt from the tenant-scoping rule, ADR 0010) + `readCustomerFicheByUser`
 * (GLOBAL `customers` table, MOAT). Never raw `ctx.db.query("walletPasses")` /
 * `ctx.db.query("customers")` — the `lib/wallet` business module is NOT exempt
 * from `no-untenanted-query`.
 */
export const checkInstallStatus = customerQuery({
  args: { serialNumber: v.string() },
  returns: v.object({ installed: v.boolean() }),
  handler: async (ctx, args): Promise<{ installed: boolean }> => {
    const pass = await readWalletPassBySerial(ctx, args.serialNumber);
    if (pass === null) {
      // Unknown serial — answer "not installed" rather than throw so a probing
      // attacker learns nothing about which serials exist. The loader keeps
      // waiting (correct UX too: a serial we just minted may not be persisted
      // yet within the same request loop).
      return { installed: false };
    }

    // Self-scope: only the OWNER can learn the install state of a serial.
    // A foreign serial reduces to "not installed" (same wire shape as unknown
    // — no existence leak across customers).
    const fiche = await readCustomerFicheByUser(ctx, ctx.actor.userId);
    if (fiche === null || pass.customerId !== fiche._id) {
      return { installed: false };
    }

    return { installed: pass.status === "installed" };
  },
});
