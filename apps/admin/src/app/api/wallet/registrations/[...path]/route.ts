import { NextResponse } from "next/server";
import {
  convexSiteUrl,
  parseApplePassAuthorization,
  signInternalRequest,
  verifyWalletPassAuthToken,
  walletInternalSecret,
} from "@/lib/wallet-auth";

/**
 * 2.8-B — Apple Wallet Web Service device-registration routes (PRD 80, ADR 0003,
 * STACK §5.4, US 10). Node runtime: the binary / `Authorization: ApplePass …` HTTP
 * handling does not belong in the Convex V8 runtime (STACK §2.3).
 *
 * Apple's servers call:
 *   POST   …/registrations/{deviceLibraryIdentifier}/{passTypeIdentifier}/{serial}
 *          body { pushToken }
 *   DELETE …/registrations/{deviceLibraryIdentifier}/{passTypeIdentifier}/{serial}
 * with `Authorization: ApplePass {authenticationToken}` on every call.
 *
 * This route:
 *  1. parses the `{device}/{passType}/{serial}` catch-all path,
 *  2. verifies the PassKit auth token against the one derived from the serial
 *     (`HMAC(secret, "wallet-pass-auth:" + serial)`, US 10) — a forged token ⇒ 401,
 *  3. forwards the verified register/unregister to Convex over the HMAC-signed
 *     internal channel (US 23, `POST {convex.site}/wallet/registrations`), which
 *     persists it through the sanctioned tenancy seam.
 *
 * The secret / certs are read server-side only (US 22). The real `.pkpass` install
 * + the live device round-trip are validated HITL (POC #3 + e2e device), not in CI.
 */
export const runtime = "nodejs";

/** Parse `{device}/{passType}/{serial}` from the catch-all segments. */
function parsePath(
  path: string[] | undefined,
): { device: string; passType: string; serial: string } | null {
  if (!path || path.length !== 3) return null;
  const [device, passType, serial] = path;
  if (!device || !passType || !serial) return null;
  return { device, passType, serial };
}

/** Forward a verified registration op to Convex over the HMAC channel (US 23). */
async function forwardToConvex(payload: {
  op: "register" | "unregister";
  deviceLibraryIdentifier: string;
  passTypeIdentifier: string;
  serialNumber: string;
  authToken: string;
  pushToken?: string;
}): Promise<Response> {
  const secret = walletInternalSecret();
  const body = JSON.stringify(payload);
  const { timestamp, signature } = await signInternalRequest(secret, body);
  return fetch(`${convexSiteUrl()}/wallet/registrations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-kb-timestamp": timestamp,
      "x-kb-signature": signature,
    },
    body,
  });
}

type RouteContext = { params: Promise<{ path?: string[] }> };

/** POST — register a device↔pass couple for APNs pushes. PassKit expects 201. */
export async function POST(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { path } = await context.params;
  const parsed = parsePath(path);
  if (parsed === null) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const secret = walletInternalSecret();
  const presentedToken = parseApplePassAuthorization(
    request.headers.get("authorization"),
  );
  const authorized = await verifyWalletPassAuthToken({
    secret,
    serialNumber: parsed.serial,
    presentedToken,
  });
  if (!authorized || presentedToken === null) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let pushToken = "";
  try {
    const json = (await request.json()) as { pushToken?: unknown };
    if (typeof json.pushToken === "string") pushToken = json.pushToken;
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }
  if (pushToken === "") {
    return new NextResponse("Bad request", { status: 400 });
  }

  const res = await forwardToConvex({
    op: "register",
    deviceLibraryIdentifier: parsed.device,
    passTypeIdentifier: parsed.passType,
    serialNumber: parsed.serial,
    authToken: presentedToken,
    pushToken,
  });
  if (!res.ok) {
    return new NextResponse("Registration failed", { status: res.status });
  }
  // PassKit: 201 = new registration created. We answer 201 on success (a re-
  // register is idempotent and equally acceptable to the device).
  return new NextResponse(null, { status: 201 });
}

/** DELETE — unregister a device↔pass couple (soft inactive). PassKit expects 200. */
export async function DELETE(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { path } = await context.params;
  const parsed = parsePath(path);
  if (parsed === null) {
    return new NextResponse("Bad request", { status: 400 });
  }

  const secret = walletInternalSecret();
  const presentedToken = parseApplePassAuthorization(
    request.headers.get("authorization"),
  );
  const authorized = await verifyWalletPassAuthToken({
    secret,
    serialNumber: parsed.serial,
    presentedToken,
  });
  if (!authorized || presentedToken === null) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const res = await forwardToConvex({
    op: "unregister",
    deviceLibraryIdentifier: parsed.device,
    passTypeIdentifier: parsed.passType,
    serialNumber: parsed.serial,
    authToken: presentedToken,
  });
  if (!res.ok) {
    return new NextResponse("Unregistration failed", { status: res.status });
  }
  return new NextResponse(null, { status: 200 });
}
