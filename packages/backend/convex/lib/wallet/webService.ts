import { ConvexError } from "convex/values";
import { internal } from "../../_generated/api";
import { httpAction } from "../../_generated/server";
import { verifyInternalRequest } from "./internalAuth";

/**
 * 2.8-B — the Convex HTTP endpoint the Next.js Node Wallet routes call over the
 * HMAC-signed internal channel (US 23, STACK §2.3/§5.4).
 *
 * Apple's servers call the device-facing Web Service routes in `apps/admin/api/
 * wallet/*` (Node runtime — the binary `.pkpass` + `Authorization: ApplePass …`
 * HTTP handling that does not belong in the Convex V8 runtime). After parsing the
 * PassKit auth header + the registration URL params, that route FORWARDS the
 * registration to THIS endpoint over the HMAC-signed channel: a `${timestamp}.
 * ${body}` HMAC keyed on `WALLET_INTERNAL_HMAC_SECRET`, in the `x-kb-timestamp` /
 * `x-kb-signature` headers — "seules des requêtes authentifiées de KB déclenchent
 * la génération" (issue). The handler:
 *  1. reads the RAW body FIRST (never parses before the channel HMAC check — same
 *     discipline as the Stripe / Uber webhooks, POC #1);
 *  2. verifies the channel HMAC with a freshness tolerance (replay protection); a
 *     forged / stale caller ⇒ 401, no DB touch;
 *  3. parses the forwarded op + params and dispatches to the internal
 *     `registerDevice` / `unregisterDevice` mutations, which RE-verify the per-pass
 *     PassKit token (a forged PassKit token ⇒ FORBIDDEN ⇒ 403).
 *
 * Mounted at `/wallet/registrations` in `http.ts`.
 */

/** Replay tolerance for the internal channel (seconds). */
const TOLERANCE_SECONDS = 300;

type ForwardedRegistration = {
  op: "register" | "unregister";
  deviceLibraryIdentifier: string;
  passTypeIdentifier: string;
  serialNumber: string;
  authToken: string;
  pushToken?: string;
};

function isForwarded(value: unknown): value is ForwardedRegistration {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.op === "register" || v.op === "unregister") &&
    typeof v.deviceLibraryIdentifier === "string" &&
    typeof v.passTypeIdentifier === "string" &&
    typeof v.serialNumber === "string" &&
    typeof v.authToken === "string"
  );
}

export const walletRegistrationWebhook = httpAction(async (ctx, request) => {
  // 1. RAW body FIRST — never parse before verifying the channel signature.
  const rawBody = await request.text();

  // 2. Verify the internal channel HMAC (US 23). The secret is read server-side
  //    only; a misconfiguration ⇒ 500, a forged / stale signature ⇒ 401.
  const secret = process.env.WALLET_INTERNAL_HMAC_SECRET;
  if (!secret || secret === "") {
    return new Response("Misconfigured", { status: 500 });
  }
  const channelOk = await verifyInternalRequest({
    secret,
    body: rawBody,
    timestamp: request.headers.get("x-kb-timestamp"),
    signature: request.headers.get("x-kb-signature"),
    toleranceSeconds: TOLERANCE_SECONDS,
  });
  if (!channelOk) {
    return new Response("Invalid signature", { status: 401 });
  }

  // 3. Safe to parse now.
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  if (!isForwarded(payload)) {
    return new Response("Malformed registration", { status: 400 });
  }

  // 4. Dispatch to the internal mutation (it RE-verifies the PassKit token). A
  //    forged PassKit token / unknown serial throws FORBIDDEN / NOT_FOUND → 403.
  try {
    if (payload.op === "register") {
      await ctx.runMutation(internal.lib.wallet.registrations.registerDevice, {
        deviceLibraryIdentifier: payload.deviceLibraryIdentifier,
        passTypeIdentifier: payload.passTypeIdentifier,
        serialNumber: payload.serialNumber,
        pushToken: payload.pushToken ?? "",
        authToken: payload.authToken,
      });
    } else {
      await ctx.runMutation(
        internal.lib.wallet.registrations.unregisterDevice,
        {
          deviceLibraryIdentifier: payload.deviceLibraryIdentifier,
          passTypeIdentifier: payload.passTypeIdentifier,
          serialNumber: payload.serialNumber,
          authToken: payload.authToken,
        },
      );
    }
  } catch (err) {
    // The PassKit auth guard (or unknown serial) rejected the request.
    if (err instanceof ConvexError) {
      return new Response(String(err.data?.message ?? "Forbidden"), {
        status: 403,
      });
    }
    throw err;
  }

  return new Response(null, { status: 200 });
});

/**
 * 2.8-B — the Convex HTTP endpoint serving the latest signed `.pkpass` bytes for an
 * EXISTING serial (US 9). The device-facing Node route (`apps/admin/api/wallet/
 * pass/[serial]`) verifies the PassKit token, then forwards the serial here over
 * the HMAC channel; this endpoint re-builds + signs the pass through slice A's
 * `"use node"` seam (`signPkpassForSerial`, POC #3) and returns the base64 bytes.
 *
 *  - forged / stale channel HMAC ⇒ 401 (no work),
 *  - unknown serial ⇒ 404,
 *  - certs absent in this env (CI / dev) ⇒ 503 (the real binary is served only with
 *    the prod certs — HITL, POC #3 + device e2e),
 *  - signed ⇒ 200 with `{ pkpassBase64 }` the Node route decodes + streams as
 *    `application/vnd.apple.pkpass`.
 *
 * Mounted at `/wallet/pass` in `http.ts`.
 */
export const walletPassDownload = httpAction(async (ctx, request) => {
  const rawBody = await request.text();

  const secret = process.env.WALLET_INTERNAL_HMAC_SECRET;
  if (!secret || secret === "") {
    return new Response("Misconfigured", { status: 500 });
  }
  const channelOk = await verifyInternalRequest({
    secret,
    body: rawBody,
    timestamp: request.headers.get("x-kb-timestamp"),
    signature: request.headers.get("x-kb-signature"),
    toleranceSeconds: TOLERANCE_SECONDS,
  });
  if (!channelOk) {
    return new Response("Invalid signature", { status: 401 });
  }

  let serialNumber: string;
  try {
    const parsed = JSON.parse(rawBody) as { serialNumber?: unknown };
    if (typeof parsed.serialNumber !== "string" || parsed.serialNumber === "") {
      return new Response("Malformed request", { status: 400 });
    }
    serialNumber = parsed.serialNumber;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  let result: { signed: boolean; pkpassBase64: string | null };
  try {
    result = await ctx.runAction(
      internal.lib.wallet.generatePass.signPkpassForSerial,
      { serialNumber },
    );
  } catch (err) {
    if (err instanceof ConvexError) {
      return new Response(String(err.data?.message ?? "Not found"), {
        status: 404,
      });
    }
    throw err;
  }

  if (!result.signed || result.pkpassBase64 === null) {
    // No real certs in this env — the signed binary is served only in prod (HITL).
    return new Response("Pass signing unavailable", { status: 503 });
  }

  return new Response(JSON.stringify({ pkpassBase64: result.pkpassBase64 }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
