import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { signInternalRequest, walletPassAuthToken } from "./internalAuth";

// convex-test needs the function modules; array-negation glob + normalise the
// same-dir "./x" keys into the convex/lib/wallet/** path the harness expects.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/wallet/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.8-B — the Convex HTTP endpoint the Next.js Node Wallet routes call over the
 * HMAC-signed internal channel (US 23, STACK §2.3/§5.4), written BEFORE the
 * implementation (TDD red). The device-facing binary / `ApplePass` HTTP handling
 * lives in `apps/admin/api/wallet/*` (Node runtime); after parsing the PassKit
 * `Authorization`, the route forwards the registration over this HMAC-signed
 * channel. The endpoint verifies the channel HMAC on the RAW body FIRST (a forged
 * caller ⇒ 401, no DB write), then dispatches to register / unregister, which
 * RE-verify the PassKit token. Only authenticated KB traffic mutates the registry.
 */

const SECRET = "kb-internal-shared-secret";

async function seedPass(
  t: ReturnType<typeof convexTest>,
  serialNumber: string,
): Promise<void> {
  await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "eater@x.fr",
      role: "customer",
    });
    const customerId = await ctx.db.insert("customers", {
      userId,
      createdAt: Date.now(),
    });
    await ctx.db.insert("walletPasses", {
      serialNumber,
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      customerId,
      status: "generated",
      createdAt: Date.now(),
    });
  });
}

async function readReg(
  t: ReturnType<typeof convexTest>,
  device: string,
  serial: string,
): Promise<{ status: string; pushToken: string } | null> {
  return t.run(async (ctx) => {
    const row = await ctx.db
      .query("walletDeviceRegistrations")
      .withIndex("by_device_serial", (q) =>
        q.eq("deviceLibraryIdentifier", device).eq("serialNumber", serial),
      )
      .unique();
    return row ? { status: row.status, pushToken: row.pushToken } : null;
  });
}

/** Build the HMAC-signed forwarded request body for the internal channel. */
type Forwarded = {
  op: "register" | "unregister";
  deviceLibraryIdentifier: string;
  passTypeIdentifier: string;
  serialNumber: string;
  authToken: string;
  pushToken?: string;
};

describe("2.8-B wallet Web Service HTTP endpoint (HMAC channel, US 23)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    t = convexTest(schema, modules);
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  async function postForwarded(
    payload: Forwarded,
    opts: { sign?: boolean } = {},
  ): Promise<Response> {
    const raw = JSON.stringify(payload);
    const sign = opts.sign ?? true;
    const { timestamp, signature } = await signInternalRequest(SECRET, raw);
    return t.fetch("/wallet/registrations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kb-timestamp": timestamp,
        "x-kb-signature": sign ? signature : "deadbeef",
      },
      body: raw,
    });
  }

  it("registers a device on a valid HMAC + valid PassKit token (200)", async () => {
    await seedPass(t, "kb-ws-1");
    const authToken = await walletPassAuthToken(SECRET, "kb-ws-1");
    const res = await postForwarded({
      op: "register",
      deviceLibraryIdentifier: "dev-ws-1",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-ws-1",
      authToken,
      pushToken: "apns-ws-1",
    });
    expect(res.status).toBe(200);
    const row = await readReg(t, "dev-ws-1", "kb-ws-1");
    expect(row?.status).toBe("active");
    expect(row?.pushToken).toBe("apns-ws-1");
  });

  it("unregisters a device on a valid HMAC + valid PassKit token (200, soft inactive)", async () => {
    await seedPass(t, "kb-ws-2");
    const authToken = await walletPassAuthToken(SECRET, "kb-ws-2");
    await postForwarded({
      op: "register",
      deviceLibraryIdentifier: "dev-ws-2",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-ws-2",
      authToken,
      pushToken: "tok",
    });
    const res = await postForwarded({
      op: "unregister",
      deviceLibraryIdentifier: "dev-ws-2",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-ws-2",
      authToken,
    });
    expect(res.status).toBe(200);
    const row = await readReg(t, "dev-ws-2", "kb-ws-2");
    expect(row?.status).toBe("inactive");
  });

  it("rejects a forged channel HMAC (401, no DB write)", async () => {
    await seedPass(t, "kb-ws-3");
    const authToken = await walletPassAuthToken(SECRET, "kb-ws-3");
    const res = await postForwarded(
      {
        op: "register",
        deviceLibraryIdentifier: "dev-ws-3",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        serialNumber: "kb-ws-3",
        authToken,
        pushToken: "tok",
      },
      { sign: false },
    );
    expect(res.status).toBe(401);
    expect(await readReg(t, "dev-ws-3", "kb-ws-3")).toBeNull();
  });

  it("rejects a forged PassKit token even on a valid channel HMAC (401/403, no write)", async () => {
    await seedPass(t, "kb-ws-4");
    const res = await postForwarded({
      op: "register",
      deviceLibraryIdentifier: "dev-ws-4",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-ws-4",
      authToken: "forged-passkit-token",
      pushToken: "tok",
    });
    expect([401, 403]).toContain(res.status);
    expect(await readReg(t, "dev-ws-4", "kb-ws-4")).toBeNull();
  });
});

describe("2.8-B wallet pass download HTTP endpoint (HMAC channel, US 9)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    process.env.GOOGLE_WALLET_ISSUER_ID = "3388000000022222222";
    // No real Apple certs in CI ⇒ the endpoint reports the pass unsigned (503).
    delete process.env.WALLET_PASS_CERT_P12_BASE64;
    delete process.env.WALLET_PASS_CERT_PASSWORD;
    delete process.env.WALLET_WWDR_CERT_BASE64;
    t = convexTest(schema, modules);
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.GOOGLE_WALLET_ISSUER_ID;
  });

  async function getPass(
    serialNumber: string,
    opts: { sign?: boolean } = {},
  ): Promise<Response> {
    const raw = JSON.stringify({ serialNumber });
    const { timestamp, signature } = await signInternalRequest(SECRET, raw);
    return t.fetch("/wallet/pass", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kb-timestamp": timestamp,
        "x-kb-signature": (opts.sign ?? true) ? signature : "deadbeef",
      },
      body: raw,
    });
  }

  it("rejects a forged channel HMAC (401)", async () => {
    await seedPass(t, "kb-dl-1");
    const res = await getPass("kb-dl-1", { sign: false });
    expect(res.status).toBe(401);
  });

  it("404s an unknown serial on a valid HMAC", async () => {
    const res = await getPass("kb-dl-unknown");
    expect(res.status).toBe(404);
  });

  it("503s when the pass cannot be signed in this env (no real certs, CI)", async () => {
    await seedPass(t, "kb-dl-2");
    // Valid HMAC + known serial, but no Apple certs ⇒ unsigned ⇒ 503 (the real
    // signed binary is served only with the prod certs — HITL, POC #3 + device).
    const res = await getPass("kb-dl-2");
    expect(res.status).toBe(503);
  });
});
