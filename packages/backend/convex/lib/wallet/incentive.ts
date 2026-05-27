import { ConvexError, v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { query } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import {
  logAudit,
  readIncentiveDeliveryBySerial,
  recordIncentiveDeliveryOnce,
} from "../tenancy";
import { verifyWalletPassAuthToken } from "./internalAuth";

/**
 * 2.8-E — the Incentive Wallet CONDITIONAL delivery mechanism (PRD 80, ADR 0002,
 * [[Incentive Wallet]] glossaire client-ordering, US 19 / US 20 / US 24).
 *
 * ── The non-negotiable contract: NO fake reward (ADR 0002, US 19) ───────────────
 * The Incentive reward code is delivered ONLY when the pass is REALLY installed —
 * captured by the `pass_installed` event of slice C (#70). This module exposes the
 * delivery as a reusable seam (`deliverIncentive`) that the install handler
 * (`linkSerialToCustomer`) calls AFTER it has resolved the serial to a real,
 * installed pass. There is NO alternative generation path: `deliverIncentive` never
 * issues a reward on its own — it only RECORDS one for an install the caller has
 * already proven real. So a delivery row cannot exist without a constated install.
 *
 * ── Exactly once per install (US 20) ───────────────────────────────────────────
 * Because `linkSerialToCustomer` runs inside the install handler's
 * `withIdempotence(provider, eventId, …)` block, a redelivered `(provider, eventId)`
 * never re-runs the delivery. As a SECOND, data-level guard (defence in depth, and
 * the right semantics for a 2ⁿᵈ device on the SAME pass = same serial, distinct
 * event id), the sanctioned seam `recordIncentiveDeliveryOnce` inserts at most ONE
 * row per pass serial — ONE reward per pass, never per device.
 *
 * ── Audited (US 24) ────────────────────────────────────────────────────────────
 * The FIRST delivery for a pass writes a `wallet.incentive.delivered` audit row
 * (system actor, scoped to the serial). A no-op (already delivered) writes nothing,
 * so the trail counts each reward exactly once.
 *
 * ── GLOBAL, sanctioned seam (ADR 0003 / ADR 0010) ──────────────────────────────
 * The Incentive rides the COMMON neutral card (no authoritative `tenantId`): the
 * ledger is GLOBAL and every read/write goes through the sanctioned `lib/tenancy`
 * seam (`recordIncentiveDeliveryOnce` / `readIncentiveDeliveryBySerial`), never raw
 * `ctx.db` here. The delivery touches the MOAT customer store BY ID only — it never
 * returns a raw `customer` object.
 *
 * ── Parametrisation is OUT OF SCOPE (#72) ──────────────────────────────────────
 * The resto's hook text + the promo code VALUE are edited in KB Admin Phase C (a
 * Phase-3 front). This slice owns only the conditional DELIVERY: it records the
 * delivery FACT (which Customer / which pass / when), no invented promo string.
 */

/** Read the shared internal secret server-side (US 22 — never via a query). */
function internalSecret(): string {
  const secret = process.env.WALLET_INTERNAL_HMAC_SECRET;
  if (!secret || secret === "") {
    throw new ConvexError({
      code: "MISCONFIGURED",
      message: "WALLET_INTERNAL_HMAC_SECRET is not configured.",
    });
  }
  return secret;
}

/**
 * Deliver the Incentive reward for a REALLY-installed pass — the reusable seam the
 * install handler calls. The caller (`linkSerialToCustomer`) has ALREADY resolved
 * the serial to a real, installed pass, so this never fabricates a reward (US 19).
 * Idempotent at the data level: at most ONE delivery per pass serial (US 20). On the
 * FIRST delivery it appends a `wallet.incentive.delivered` audit row (US 24); a no-op
 * (already delivered) writes nothing. Returns whether a NEW delivery was recorded.
 */
export async function deliverIncentive(
  ctx: MutationCtx,
  args: {
    serialNumber: string;
    customerId: Id<"customers">;
    at: number;
  },
): Promise<{ delivered: boolean }> {
  const delivered = await recordIncentiveDeliveryOnce(ctx, {
    serialNumber: args.serialNumber,
    customerId: args.customerId,
    deliveredAt: args.at,
  });

  // Audit ONLY a real (first) delivery, so the trail counts each reward once.
  if (delivered) {
    await logAudit(ctx, {
      actorRole: "system",
      action: "wallet.incentive.delivered",
      targetType: "walletIncentive",
      targetId: args.serialNumber,
      metadata: { customerId: args.customerId },
    });
  }

  return { delivered };
}

/**
 * PUBLIC guard query — verifies the per-pass PassKit auth token for a serial, then
 * reports whether the Incentive has been delivered for that pass. THROWS `FORBIDDEN`
 * for a forged token. Deliberately PUBLIC (no auth wrapper): the boundary it protects
 * is the PassKit token, not a Convex session — the GLOBAL common card has no
 * `tenantId` (ADR 0003). The mandatory cross-tenant / forged-token fuzz target (ADR
 * 0010): every actor presenting a wrong token is rejected (mirrors slice C's
 * `verifyInstallAuth` / slice B's `verifyDeviceAuth`). Returns only the delivery FACT
 * (a boolean) — never a raw customer object (the MOAT).
 */
export const incentiveDeliveryStatus = query({
  args: { serialNumber: v.string(), authToken: v.string() },
  returns: v.object({ delivered: v.boolean() }),
  handler: async (ctx, args): Promise<{ delivered: boolean }> => {
    const ok = await verifyWalletPassAuthToken({
      secret: internalSecret(),
      serialNumber: args.serialNumber,
      presentedToken: args.authToken,
    });
    if (!ok) {
      throw new ConvexError({
        code: "FORBIDDEN",
        message: "Invalid Apple PassKit authentication token.",
      });
    }

    const row = await readIncentiveDeliveryBySerial(ctx, args.serialNumber);
    return { delivered: row !== null };
  },
});
