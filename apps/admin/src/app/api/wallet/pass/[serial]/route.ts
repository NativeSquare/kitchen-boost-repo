import { NextResponse } from "next/server";
import {
  convexSiteUrl,
  parseApplePassAuthorization,
  signInternalRequest,
  verifyWalletPassAuthToken,
  walletInternalSecret,
} from "@/lib/wallet-auth";

/**
 * 2.8-B — Apple Wallet Web Service pass download (PRD 80, ADR 0003, STACK §5.4,
 * US 9). Node runtime: the binary `.pkpass` response + `Authorization: ApplePass …`
 * handling does not belong in the Convex V8 runtime (STACK §2.3).
 *
 * Apple's servers call `GET …/pass/{serialNumber}` with
 * `Authorization: ApplePass {authenticationToken}` to (re-)download the latest
 * version of a pass. This route:
 *  1. verifies the PassKit auth token against the one derived from the serial
 *     (`HMAC(secret, "wallet-pass-auth:" + serial)`, US 10) — a forged token ⇒ 401,
 *  2. forwards the serial to Convex over the HMAC-signed internal channel (US 23,
 *     `POST {convex.site}/wallet/pass`), which re-builds + signs the latest pass
 *     through slice A's `"use node"` seam and returns the base64 bytes,
 *  3. streams the decoded `.pkpass` with `Content-Type: application/vnd.apple.pkpass`.
 *
 * Secrets / certs are read server-side only (US 22). The real signed `.pkpass` is
 * served only with the prod Apple certs (HITL, POC #3 + device e2e); without them
 * Convex answers 503 and this route relays it.
 */
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ serial: string }> };

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { serial } = await context.params;
  if (!serial) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const secret = walletInternalSecret();
  const presentedToken = parseApplePassAuthorization(
    request.headers.get("authorization"),
  );
  const authorized = await verifyWalletPassAuthToken({
    secret,
    serialNumber: serial,
    presentedToken,
  });
  if (!authorized || presentedToken === null) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = JSON.stringify({ serialNumber: serial });
  const { timestamp, signature } = await signInternalRequest(secret, body);
  const res = await fetch(`${convexSiteUrl()}/wallet/pass`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kb-timestamp": timestamp,
      "x-kb-signature": signature,
    },
    body,
  });

  if (res.status === 404) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!res.ok) {
    // 503 (certs absent in this env) or any upstream failure — relay the status.
    return new NextResponse("Pass unavailable", { status: res.status });
  }

  const { pkpassBase64 } = (await res.json()) as { pkpassBase64?: unknown };
  if (typeof pkpassBase64 !== "string" || pkpassBase64 === "") {
    return new NextResponse("Pass unavailable", { status: 503 });
  }

  const bytes = Buffer.from(pkpassBase64, "base64");
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="${serial}.pkpass"`,
    },
  });
}
