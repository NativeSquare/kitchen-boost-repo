import { ConvexError, v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { internalMutation, query } from "../../_generated/server";
import type { MutationCtx } from "../../_generated/server";
import {
  logAudit,
  patchCustomerPushEnrollment,
  readWalletPassBySerial,
  setWalletPassInstalled,
} from "../tenancy";
import { withIdempotence } from "../webhooks/idempotent";
import type { WebhookProvider } from "../webhooks/idempotent";
import { deliverIncentive } from "./incentive";
import { verifyWalletPassAuthToken } from "./internalAuth";

/**
 * 2.8-C — `linkSerialToCustomer`, the cross-device IDENTITY BRIDGE (ADR 0008 /
 * ADR 0012), + the `pass_installed` event (PRD 80, ADR 0003 carte commune marque
 * neutre, US 13 / US 20).
 *
 * ── What this slice owns vs what it does NOT (ADR 0012) ────────────────────────
 * When a pass is REALLY installed, the Wallet `serial → customer_id` is written
 * into the 2.1 Customer Data store (`customers.pushEnrollment.walletSerialNumber`,
 * the AUTHORITATIVE bridge), and the per-channel WALLET push enrollment status is
 * flipped to `enrolled` — because "qui est joignable et par quel id" is the source
 * of vérité of 2.1, NOT duplicated here (ADR 0012). 2.8 stores NOTHING authoritative
 * of its own: it only writes onto the 2.1 fiche and flips its OWN technical pass row
 * (`walletPasses.status → installed` + `installedAt`). The pass's `customerId` was
 * fixed at GENERATION (2.8-A), so a 2ⁿᵈ device installing the SAME pass resolves to
 * the SAME `customerId` — that IS the cross-device (and cross-resto) recognition
 * surface of ADR 0008, achieved with NO login.
 *
 * ── Where the install signal comes from (same seam as 2.8-B) ───────────────────
 * The install is a SYSTEM webhook (Apple PassKit `register` / Google Wallet add),
 * forwarded by the verified Next.js Node route over the HMAC-signed internal
 * channel (US 23, `internalAuth.ts`). So `handlePassInstalled` is `internal*` (never
 * client-callable), RE-verifies the per-pass PassKit token (`verifyWalletPassAuthToken`
 * — the GLOBAL card's ONLY auth boundary; it has no `tenantId`), and wraps the work
 * in the foundation `withIdempotence(provider, eventId, …)` so a redelivered event
 * counts/writes exactly once (US 20). The public `verifyInstallAuth` query exposes
 * exactly the token guard — the mandatory cross-tenant / forged-token fuzz target
 * (ADR 0010): every actor presenting a wrong token is rejected.
 *
 * ── GLOBAL, sanctioned seam (ADR 0003 / ADR 0010 / ADR 0011) ───────────────────
 * The pass + customer tables are GLOBAL (no authoritative `tenantId`): every read/
 * write goes through the sanctioned `lib/tenancy` seam (`readWalletPassBySerial` /
 * `setWalletPassInstalled` / `patchCustomerPushEnrollment`), never raw `ctx.db` in
 * this business module. Identity flows only via `getCurrentActor` (inside the
 * wrappers / the system-side PassKit guard), never `getAuthUserId` (ADR 0011). The
 * install touches the MOAT customer store but NEVER returns a raw `customer` object
 * — it writes a narrow push-enrollment patch and returns only the `customerId`.
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
 * Assert the presented PassKit auth token matches the serial. Throws `FORBIDDEN`
 * on a forged token. Shared by the install write path + the public
 * `verifyInstallAuth` query, so the auth rule lives in ONE place (same discipline
 * as 2.8-B `assertDeviceAuthorized`).
 */
async function assertPassAuthorized(
  serialNumber: string,
  authToken: string,
): Promise<void> {
  const ok = await verifyWalletPassAuthToken({
    secret: internalSecret(),
    serialNumber,
    presentedToken: authToken,
  });
  if (!ok) {
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "Invalid Apple PassKit authentication token.",
    });
  }
}

/**
 * The cross-device identity BRIDGE (ADR 0008/0012). Resolve the pass by its serial
 * (sanctioned GLOBAL seam), then:
 *  1. write the Wallet `serial → customer_id` onto the pass's customer fiche in 2.1
 *     (`pushEnrollment.walletSerialNumber`) + flip `walletStatus` to `enrolled`
 *     (joignabilité = source de vérité 2.1, US 13). The seam MERGES, so the other
 *     push channels (web-push / A2HS) are preserved (US #16);
 *  2. flip the LOCAL technical pass row to `installed` + stamp `installedAt`.
 * Returns the bridged `customerId` (NEVER a raw customer object — the MOAT). Throws
 * `NOT_FOUND` for an unknown serial (no fabricated link). The caller has already
 * verified the PassKit token. Idempotent at the data level: the same serial written
 * twice merges to the same value + re-stamps installed (harmless) — the event-level
 * exactly-once is `withIdempotence`'s job.
 */
export async function linkSerialToCustomer(
  ctx: MutationCtx,
  args: { serialNumber: string; at: number },
): Promise<{ customerId: Id<"customers"> }> {
  const pass = await readWalletPassBySerial(ctx, args.serialNumber);
  if (pass === null) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Unknown pass serial.",
    });
  }

  // 1. Write the authoritative serial→customer bridge + reachability into 2.1.
  await patchCustomerPushEnrollment(ctx, pass.customerId, {
    walletSerialNumber: args.serialNumber,
    walletStatus: "enrolled",
  });

  // 2. Flip the LOCAL technical pass state (no authoritative identity stored here).
  await setWalletPassInstalled(ctx, pass._id, args.at);

  await logAudit(ctx, {
    actorRole: "system",
    action: "wallet.pass.installed",
    targetType: "walletPass",
    targetId: args.serialNumber,
    metadata: { customerId: pass.customerId },
  });

  // 3. Deliver the Incentive (2.8-E) — the SINGLE generation path of the reward
  //    code, gated on THIS constated install (no fake reward, US 19). It is
  //    idempotent at the data level (one reward per pass serial, US 20), so a 2ⁿᵈ
  //    device on the same pass — or a redelivered event riding `withIdempotence` —
  //    never issues a second reward.
  await deliverIncentive(ctx, {
    serialNumber: args.serialNumber,
    customerId: pass.customerId,
    at: args.at,
  });

  return { customerId: pass.customerId };
}

/**
 * PUBLIC guard query — verifies the PassKit auth token for a serial and returns
 * `{ authorized: true }`, or THROWS `FORBIDDEN` for a forged token. Deliberately
 * PUBLIC (no auth wrapper): the boundary it protects is the PassKit token, not a
 * Convex session — the GLOBAL card has no `tenantId`. The mandatory cross-tenant /
 * forged-token fuzz target (ADR 0010): every actor presenting a wrong token is
 * rejected (mirrors 2.8-B `verifyDeviceAuth`).
 */
export const verifyInstallAuth = query({
  args: { serialNumber: v.string(), authToken: v.string() },
  returns: v.object({ authorized: v.literal(true) }),
  handler: async (_ctx, args): Promise<{ authorized: true }> => {
    await assertPassAuthorized(args.serialNumber, args.authToken);
    return { authorized: true };
  },
});

/** The Wallet ecosystems whose install callbacks land here (dedup providers). */
const walletProvider = v.union(
  v.literal("apple_wallet"),
  v.literal("google_wallet"),
);

/**
 * INTERNAL — handle a `pass_installed` event (Apple PassKit register / Google
 * Wallet add), forwarded by the verified Node route over the HMAC channel. RE-verifies
 * the per-pass PassKit token BEFORE any write (a forged token ⇒ FORBIDDEN, the whole
 * transaction rolls back), then runs `linkSerialToCustomer` inside
 * `withIdempotence(provider, eventId, …)` so a redelivered `(provider, eventId)` is a
 * clean no-op (US 20). The dedup mark + the link + the audit commit in ONE Convex
 * transaction — on a throw NOTHING (mark included) is persisted, so the provider can
 * safely retry.
 */
export const handlePassInstalled = internalMutation({
  args: {
    provider: walletProvider,
    eventId: v.string(),
    serialNumber: v.string(),
    authToken: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    // Auth FIRST — a forged token must not even reach the idempotence ledger.
    await assertPassAuthorized(args.serialNumber, args.authToken);

    await withIdempotence(
      ctx,
      args.provider as WebhookProvider,
      args.eventId,
      async () => {
        await linkSerialToCustomer(ctx, {
          serialNumber: args.serialNumber,
          at: Date.now(),
        });
      },
    );
    return null;
  },
});
