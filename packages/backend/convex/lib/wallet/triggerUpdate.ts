import { ConvexError, v } from "convex/values";
import { internal } from "../../_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "../../_generated/server";
import {
  deactivateDeviceRegistration,
  listActiveRegistrationsBySerial,
  logAudit,
  readCustomerAggregateFields,
  readWalletPassBySerial,
} from "../tenancy";
import { WALLET_PASS_TYPE_IDENTIFIER } from "./_constants";
import { signInternalRequest } from "./internalAuth";
import { buildWalletPushPayload } from "./pushPayload";

/**
 * 2.8-D — `triggerUpdate`, the Wallet push-update CHANNEL (PRD 80, ADR 0003 carte
 * commune marque neutre, STACK §2.3/§5.4, US 15/16/17/22/27).
 *
 * ── Where the crypto runs (STACK §2.3/§5.4) ────────────────────────────────────
 * The APNs HTTP/2 transport (and the Google Wallet API) is crypto-heavy / binary,
 * so it lives in the Next.js Node route (`apps/admin/api/wallet/push`, `runtime =
 * "nodejs"`) where the APNs auth key is read server-side (US 22) — NEVER in this
 * Convex action. `triggerUpdate` runs in the DEFAULT Convex runtime: it is the
 * SOURCE OF TRUTH for the data (resolve the pass + its active device tokens), then
 * signs the payload with the internal-channel HMAC (`crypto.subtle`, same primitive
 * as 2.8-B, no `"use node"`) and `fetch`es the Node route — "Convex reste la source
 * de vérité data, déclenche via fetch HMAC-signé" (STACK §2.3). There is
 * deliberately NO APNs key read here and NO query returning one.
 *
 * ── Exposed to 2.7 as a cascade channel (US 15) ───────────────────────────────
 * The Notifications moteur (2.7) materialises its Wallet cascade channel by calling
 * `triggerUpdate(customerId, silent)` — it knows NOTHING of the signature / APNs
 * plumbing (ADR 0012: 2.1 owns identity/joignabilité, 2.7 owns "we send", 2.8 owns
 * the Wallet transport). The customer is referenced strictly BY ID; the action
 * returns only an aggregate count — NEVER a raw customer object (the MOAT, PRD 90).
 * It is an `internalAction` (the 2.7 dispatcher calls it system-side; NOT
 * client-callable), addressed by its module path
 * (`internal.lib.wallet.triggerUpdate.triggerUpdate`) like `generatePass` /
 * `registrations` / `linkSerial` — so the barrel does NOT re-export it.
 *
 * ── Silent vs lock-screen (US 16) ──────────────────────────────────────────────
 * `silent: true` = "Wallet update silencieux" (Info statut — the card content
 * updates without a lock-screen push; also the channel for a visible RE-BRAND, US
 * 17 / ADR 0003, pushed without re-install since the serial / passTypeIdentifier
 * stay fixed). `silent: false` = an effective lock-screen Wallet push (Temps-réel /
 * Archive). The flag rides the payload; the Node route maps it to APNs semantics.
 *
 * ── Robustness on uninstall / expiry (US 27) ───────────────────────────────────
 * Targeting a pass with NO active device (never installed, all unregistered) is a
 * clean no-op (no fetch). When the Node route reports a token as Unregistered /
 * BadDeviceToken (APNs 410-equivalent), that device registration is flipped to
 * `inactive` (soft, slice B's `deactivateDeviceRegistration`) so it is never
 * targeted again — no infinite retry, no crash.
 *
 * ── GLOBAL, sanctioned seam (ADR 0003 / ADR 0010 / ADR 0011) ───────────────────
 * The pass + registration + customer tables are GLOBAL (no authoritative
 * `tenantId`): every read/write goes through the sanctioned `lib/tenancy` seam,
 * never raw `ctx.db` in this business module. The resolve query reads the wallet
 * serial off 2.1's narrow reachability projection (no nominative field crosses
 * out). Identity flows only via the wrappers' `getCurrentActor`, never
 * `getAuthUserId` (ADR 0011). Audited via `logAudit` (sensitive action).
 */

/** Read the internal-channel secret server-side (US 22 — never via a query). */
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

/** The Node push route URL, read server-side. The fetch TARGET (STACK §5.4). */
function pushRouteUrl(): string {
  const url = process.env.WALLET_PUSH_ROUTE_URL;
  if (!url || url === "") {
    throw new ConvexError({
      code: "MISCONFIGURED",
      message: "WALLET_PUSH_ROUTE_URL is not configured.",
    });
  }
  return url;
}

/** The NARROW push targets of a customer's Wallet pass — no nominative field. */
type PushTargets = {
  serialNumber: string;
  pushTokens: string[];
};

/**
 * INTERNAL — resolve a customer's Wallet push targets BY ID (system-side; the 2.7
 * dispatcher / the `triggerUpdate` action call it, never a client). Reads the
 * AUTHORITATIVE wallet serial off 2.1's reachability projection (ADR 0012 — the
 * serial is NOT duplicated in 2.8), then lists the pass's ACTIVE device push tokens
 * through the sanctioned slice-B seam. Returns `null` when the customer is not
 * Wallet-enrolled (no serial / status not `enrolled`) or the pass vanished — the
 * caller treats that as "nothing to push" (US 27). NARROW by construction: only the
 * technical targets, never the customer's email / phone / name (the MOAT).
 */
export const resolvePushTargets = internalQuery({
  args: { customerId: v.id("customers") },
  handler: async (ctx, args): Promise<PushTargets | null> => {
    const fields = await readCustomerAggregateFields(ctx, args.customerId);
    const enrollment = fields?.pushEnrollment;
    const serialNumber = enrollment?.walletSerialNumber;
    if (
      serialNumber === undefined ||
      serialNumber === "" ||
      enrollment?.walletStatus !== "enrolled"
    ) {
      return null;
    }

    // The pass must still exist (defensive — the serial is the 2.1 source of truth).
    const pass = await readWalletPassBySerial(ctx, serialNumber);
    if (pass === null) return null;

    const regs = await listActiveRegistrationsBySerial(ctx, serialNumber);
    return {
      serialNumber,
      pushTokens: regs.map((r) => r.pushToken),
    };
  },
});

/**
 * INTERNAL — flip the dead device registrations of a pass to `inactive` (US 27),
 * and audit the push. Runs in ONE mutation transaction so the soft-deactivations +
 * the audit commit together. The dead tokens are the ones the Node route reported as
 * Unregistered / BadDeviceToken; we resolve each by serial (sanctioned seam) and
 * soft-flip it (never a hard delete — history kept). Returns how many were flipped.
 */
export const recordPushResult = internalMutation({
  args: {
    serialNumber: v.string(),
    silent: v.boolean(),
    pushed: v.number(),
    inactiveTokens: v.array(v.string()),
  },
  returns: v.object({ deactivated: v.number() }),
  handler: async (ctx, args): Promise<{ deactivated: number }> => {
    let deactivated = 0;
    if (args.inactiveTokens.length > 0) {
      const dead = new Set(args.inactiveTokens);
      const regs = await listActiveRegistrationsBySerial(
        ctx,
        args.serialNumber,
      );
      for (const reg of regs) {
        if (dead.has(reg.pushToken)) {
          await deactivateDeviceRegistration(ctx, reg._id);
          deactivated += 1;
        }
      }
    }

    await logAudit(ctx, {
      actorRole: "system",
      action: "wallet.pass.push",
      targetType: "walletPass",
      targetId: args.serialNumber,
      metadata: {
        silent: args.silent,
        pushed: args.pushed,
        deactivated,
      },
    });

    return { deactivated };
  },
});

/** The shape the Node push route answers (the tokens APNs rejected as gone). */
type PushRouteResult = { inactiveTokens?: unknown };

/**
 * The Wallet push-update channel exposed to 2.7 (US 15). Resolves the customer's
 * pass + its active device tokens, signs the payload with the internal-channel HMAC
 * and forwards it to the Node APNs route, then records the result (soft-deactivating
 * any token APNs reported gone, US 27) + audits. Returns an aggregate count only
 * (`{ pushed, deactivated }`) — never a raw customer (the MOAT).
 */
export const triggerUpdate = internalAction({
  args: {
    customerId: v.id("customers"),
    /** `true` = silent card update (Info statut, US 16); `false` = lock-screen push. */
    silent: v.boolean(),
  },
  returns: v.object({ pushed: v.number(), deactivated: v.number() }),
  handler: async (
    ctx,
    args,
  ): Promise<{ pushed: number; deactivated: number }> => {
    const targets = await ctx.runQuery(
      internal.lib.wallet.triggerUpdate.resolvePushTargets,
      { customerId: args.customerId },
    );

    // Not enrolled, pass gone, or no active device ⇒ nothing to push (US 27).
    if (targets === null || targets.pushTokens.length === 0) {
      return { pushed: 0, deactivated: 0 };
    }

    const payload = buildWalletPushPayload({
      serialNumber: targets.serialNumber,
      passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
      pushTokens: targets.pushTokens,
      silent: args.silent,
    });

    // HMAC-sign the body for the internal Convex→Node channel (US 23) and forward
    // to the Node route — the APNs key lives THERE, never here (US 22).
    const body = JSON.stringify(payload);
    const { timestamp, signature } = await signInternalRequest(
      internalSecret(),
      body,
    );
    const res = await fetch(pushRouteUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kb-timestamp": timestamp,
        "x-kb-signature": signature,
      },
      body,
    });

    // The Node route reports which tokens APNs rejected as gone (Unregistered /
    // BadDeviceToken). A non-OK response yields no dead tokens (we don't soft-delete
    // on a transient transport error — no infinite retry either, US 27).
    let inactiveTokens: string[] = [];
    if (res.ok) {
      const parsed = (await res.json()) as PushRouteResult;
      if (Array.isArray(parsed.inactiveTokens)) {
        inactiveTokens = parsed.inactiveTokens.filter(
          (t): t is string => typeof t === "string",
        );
      }
    }

    const pushed = targets.pushTokens.length;
    const { deactivated } = await ctx.runMutation(
      internal.lib.wallet.triggerUpdate.recordPushResult,
      {
        serialNumber: targets.serialNumber,
        silent: args.silent,
        pushed,
        inactiveTokens,
      },
    );

    return { pushed, deactivated };
  },
});
