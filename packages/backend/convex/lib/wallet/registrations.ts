import { ConvexError, v } from "convex/values";
import { internalMutation, query } from "../../_generated/server";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  deactivateDeviceRegistration,
  insertDeviceRegistration,
  logAudit,
  readDeviceRegistration,
  readWalletPassBySerial,
  refreshDeviceRegistration,
} from "../tenancy";
import { verifyWalletPassAuthToken } from "./internalAuth";

/**
 * 2.8-B — the Apple Wallet Web Service device-registration plumbing (PRD 80, ADR
 * 0003 carte commune marque neutre, STACK §5.4, US 10).
 *
 * ── Where the work splits (STACK §2.3/§5.4) ────────────────────────────────────
 * A device installing the `.pkpass` calls the pass's `webServiceURL`, served by the
 * Next.js Node routes (`apps/admin/api/wallet/*`, `runtime = "nodejs"`) — that is
 * where the binary `.pkpass` + the `Authorization: ApplePass …` HTTP handling live,
 * because the crypto-heavy / binary work does not belong in the Convex V8 runtime.
 * The DATA (this registry) lives in Convex. The Node route, after parsing the
 * PassKit auth header, calls THESE internal functions over the HMAC-signed internal
 * channel (US 23, `internalAuth.ts`) — so only authenticated KB traffic reaches
 * them. They are `internal*` (never directly client-callable).
 *
 * ── The PassKit auth token (US 10) ─────────────────────────────────────────────
 * Every Web Service call carries `Authorization: ApplePass {authenticationToken}`,
 * where the token is the one embedded in the pass. We derive it deterministically
 * from the serial + `WALLET_INTERNAL_HMAC_SECRET` (`walletPassAuthToken`), so the
 * pass needs no per-row secret; both `registerDevice` / `unregisterDevice`
 * RE-VERIFY the presented token against the serial BEFORE any DB write, and the
 * public `verifyDeviceAuth` query exposes exactly that guard (the cross-tenant /
 * forged-token fuzz target, ADR 0010). The secret is read server-side, never
 * returned by a query (US 22).
 *
 * ── GLOBAL registry, sanctioned seam (ADR 0003 / ADR 0010) ─────────────────────
 * `walletDeviceRegistrations` carries NO `tenantId` (the common card is one channel
 * for all restos). Every read/write goes through the sanctioned
 * `lib/tenancy/walletDeviceRegistrationsStore` seam — never raw `ctx.db` in this
 * business module. Register is an idempotent upsert on the `(device, serial)`
 * couple; unregister is a SOFT flip to `inactive` (no hard delete). Both are
 * audited (US 24). This slice does NOT capture the serial→customer identity (slice
 * C) nor push to the stored token (slice D).
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
 * Assert the presented PassKit auth token matches the serial, and that the pass
 * exists. Throws `FORBIDDEN` on a forged / absent token, `NOT_FOUND` on an unknown
 * serial. The single guard both write paths + the public `verifyDeviceAuth` query
 * share, so the auth rule lives in ONE place.
 */
async function assertDeviceAuthorized(
  ctx: QueryCtx | MutationCtx,
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
  // The token verified ⇒ the caller knows the serial's secret; still require the
  // pass to actually exist (a token for a non-existent serial is meaningless).
  const pass = await readWalletPassBySerial(ctx, serialNumber);
  if (pass === null) {
    throw new ConvexError({
      code: "NOT_FOUND",
      message: "Unknown pass serial.",
    });
  }
}

/**
 * PUBLIC guard query — verifies the PassKit auth token for a serial and returns
 * `{ authorized: true }`, or THROWS (`FORBIDDEN` / `NOT_FOUND`) for a forged token
 * or unknown serial. Deliberately PUBLIC (no auth wrapper): the boundary it
 * protects is the PassKit token, not a Convex session — the GLOBAL card has no
 * `tenantId`. It is the mandatory cross-tenant / forged-token fuzz target (ADR
 * 0010): every actor presenting a wrong token is rejected.
 */
export const verifyDeviceAuth = query({
  args: { serialNumber: v.string(), authToken: v.string() },
  returns: v.object({ authorized: v.literal(true) }),
  handler: async (ctx, args): Promise<{ authorized: true }> => {
    await assertDeviceAuthorized(ctx, args.serialNumber, args.authToken);
    return { authorized: true };
  },
});

/**
 * INTERNAL — register a device↔pass couple for APNs pushes (US 10, the Web Service
 * `POST …/registrations/{device}/{passType}/{serial}`). Called from the verified
 * Node route over the HMAC channel. Idempotent on the `(device, serial)` couple:
 * a re-register refreshes the `pushToken` + re-activates instead of duplicating.
 * Returns `{ created }` (true = a new row, false = refreshed an existing one) so
 * the route can answer the PassKit 201 vs 200 contract. Audited (US 24).
 */
export const registerDevice = internalMutation({
  args: {
    deviceLibraryIdentifier: v.string(),
    passTypeIdentifier: v.string(),
    serialNumber: v.string(),
    pushToken: v.string(),
    authToken: v.string(),
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args): Promise<{ created: boolean }> => {
    await assertDeviceAuthorized(ctx, args.serialNumber, args.authToken);

    const existing = await readDeviceRegistration(
      ctx,
      args.deviceLibraryIdentifier,
      args.serialNumber,
    );

    let created: boolean;
    if (existing === null) {
      await insertDeviceRegistration(ctx, {
        serialNumber: args.serialNumber,
        passTypeIdentifier: args.passTypeIdentifier,
        deviceLibraryIdentifier: args.deviceLibraryIdentifier,
        pushToken: args.pushToken,
      });
      created = true;
    } else {
      await refreshDeviceRegistration(ctx, existing._id, args.pushToken);
      created = false;
    }

    await logAudit(ctx, {
      actorRole: "system",
      action: "wallet.device.register",
      targetType: "walletDeviceRegistration",
      targetId: args.serialNumber,
      metadata: {
        deviceLibraryIdentifier: args.deviceLibraryIdentifier,
        passTypeIdentifier: args.passTypeIdentifier,
        created,
      },
    });

    return { created };
  },
});

/**
 * INTERNAL — unregister a device↔pass couple (US 10, the Web Service `DELETE
 * …/registrations/{device}/{passType}/{serial}`). Called from the verified Node
 * route over the HMAC channel. SOFT: flips the registration to `inactive` (never a
 * hard delete — history kept). Returns `{ updated }` (false when there was no such
 * registration, so the route can answer the PassKit 200 regardless). Audited (US 24).
 */
export const unregisterDevice = internalMutation({
  args: {
    deviceLibraryIdentifier: v.string(),
    passTypeIdentifier: v.string(),
    serialNumber: v.string(),
    authToken: v.string(),
  },
  returns: v.object({ updated: v.boolean() }),
  handler: async (ctx, args): Promise<{ updated: boolean }> => {
    await assertDeviceAuthorized(ctx, args.serialNumber, args.authToken);

    const existing = await readDeviceRegistration(
      ctx,
      args.deviceLibraryIdentifier,
      args.serialNumber,
    );
    if (existing === null) return { updated: false };

    await deactivateDeviceRegistration(ctx, existing._id);

    await logAudit(ctx, {
      actorRole: "system",
      action: "wallet.device.unregister",
      targetType: "walletDeviceRegistration",
      targetId: args.serialNumber,
      metadata: {
        deviceLibraryIdentifier: args.deviceLibraryIdentifier,
        passTypeIdentifier: args.passTypeIdentifier,
      },
    });

    return { updated: true };
  },
});
