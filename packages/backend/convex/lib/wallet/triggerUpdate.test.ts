import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { WALLET_PASS_TYPE_IDENTIFIER } from "./index";
import { verifyInternalRequest } from "./internalAuth";

// convex-test module keys: array-negation glob + normalise same-dir "./x".
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
 * 2.8-D — `triggerUpdate`, the Wallet push-update CHANNEL, written BEFORE the
 * implementation (TDD red).
 *
 * The action lives in the DEFAULT Convex runtime: it decides WHAT to push (which
 * serial, on which active device tokens, alert vs silent) and signs + forwards an
 * HMAC request to the Next.js Node route (`apps/admin/api/wallet/push`) — but the
 * crypto-heavy APNs HTTP/2 transport lives in that Node route, NEVER in Convex
 * (STACK §2.3/§5.4, US 22). So here we assert the CONTRACT: the right HMAC-signed
 * fetch to the right URL with the right payload, the silent/alert distinction
 * (US 16), the dead-device robustness (US 27), and that no APNs key is ever read
 * Convex-side. The real APNs send is HITL (device e2e, off CI).
 */

const SECRET = "kb-internal-shared-secret";
const PUSH_URL = "https://admin.kitchen-boost.com/api/wallet/push";

/** Seed a customer + an installed pass + N active device registrations. */
async function seedEnrolledPass(
  t: ReturnType<typeof convexTest>,
  serialNumber: string,
  pushTokens: string[],
): Promise<{ customerId: Id<"customers">; userId: Id<"users"> }> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: "eater@x.fr",
      role: "customer",
    });
    const customerId = await ctx.db.insert("customers", {
      userId,
      createdAt: Date.now(),
      pushEnrollment: {
        walletSerialNumber: serialNumber,
        walletStatus: "enrolled",
      },
    });
    await ctx.db.insert("walletPasses", {
      serialNumber,
      passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
      customerId,
      status: "installed",
      installedAt: Date.now(),
      createdAt: Date.now(),
    });
    for (const pushToken of pushTokens) {
      await ctx.db.insert("walletDeviceRegistrations", {
        serialNumber,
        passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
        deviceLibraryIdentifier: `dev-${pushToken}`,
        pushToken,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
    return { customerId, userId };
  });
}

/** A fetch stub that records the call and answers a fixed body. */
function stubFetch(response: {
  ok?: boolean;
  status?: number;
  body?: unknown;
}): {
  calls: { url: string; init: RequestInit }[];
} {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(response.body ?? {}), {
        status: response.status ?? (response.ok === false ? 502 : 200),
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  return { calls };
}

describe("2.8-D triggerUpdate — HMAC-signed fetch to the Node APNs route", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WALLET_PUSH_ROUTE_URL = PUSH_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.WALLET_PUSH_ROUTE_URL;
  });

  it("posts to the push route URL with a VALID internal HMAC signature", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedEnrolledPass(t, "kb-td-1", ["tok-a"]);
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    await t.action(internal.lib.wallet.triggerUpdate.triggerUpdate, {
      customerId,
      silent: false,
    });

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe(PUSH_URL);
    expect(calls[0].init.method).toBe("POST");

    const headers = new Headers(calls[0].init.headers);
    const body = String(calls[0].init.body);
    const ok = await verifyInternalRequest({
      secret: SECRET,
      body,
      timestamp: headers.get("x-kb-timestamp"),
      signature: headers.get("x-kb-signature"),
    });
    expect(ok).toBe(true);
  });

  it("forwards the serial, passTypeIdentifier and the ACTIVE push tokens", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedEnrolledPass(t, "kb-td-2", [
      "tok-a",
      "tok-b",
    ]);
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    await t.action(internal.lib.wallet.triggerUpdate.triggerUpdate, {
      customerId,
      silent: false,
    });

    const payload = JSON.parse(String(calls[0].init.body)) as {
      serialNumber: string;
      passTypeIdentifier: string;
      pushTokens: string[];
      silent: boolean;
    };
    expect(payload.serialNumber).toBe("kb-td-2");
    expect(payload.passTypeIdentifier).toBe(WALLET_PASS_TYPE_IDENTIFIER);
    expect(payload.pushTokens.sort()).toEqual(["tok-a", "tok-b"]);
  });

  it("does NOT read any APNs auth key in the Convex runtime (US 22)", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedEnrolledPass(t, "kb-td-key", ["tok"]);
    stubFetch({ body: { inactiveTokens: [] } });

    // No APNs key in env — the action must still succeed (the key lives in the
    // Node route only). If the action tried to read/sign with it, this would throw.
    delete process.env.WALLET_APNS_AUTH_KEY;
    await expect(
      t.action(internal.lib.wallet.triggerUpdate.triggerUpdate, {
        customerId,
        silent: false,
      }),
    ).resolves.toBeDefined();
  });
});

describe("2.8-D triggerUpdate — silent (Info statut) vs lock-screen push (US 16)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WALLET_PUSH_ROUTE_URL = PUSH_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.WALLET_PUSH_ROUTE_URL;
  });

  it("marks silent=true for an Info statut update (no lock-screen push)", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedEnrolledPass(t, "kb-td-silent", ["tok"]);
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    await t.action(internal.lib.wallet.triggerUpdate.triggerUpdate, {
      customerId,
      silent: true,
    });

    const payload = JSON.parse(String(calls[0].init.body)) as {
      silent: boolean;
    };
    expect(payload.silent).toBe(true);
  });

  it("marks silent=false for an effective lock-screen push", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedEnrolledPass(t, "kb-td-alert", ["tok"]);
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    await t.action(internal.lib.wallet.triggerUpdate.triggerUpdate, {
      customerId,
      silent: false,
    });

    const payload = JSON.parse(String(calls[0].init.body)) as {
      silent: boolean;
    };
    expect(payload.silent).toBe(false);
  });
});

describe("2.8-D triggerUpdate — re-branding pushable without re-install (US 17 / ADR 0003)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WALLET_PUSH_ROUTE_URL = PUSH_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.WALLET_PUSH_ROUTE_URL;
  });

  it("a re-brand reuses the SAME serial/pass (no new pass, install preserved)", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedEnrolledPass(t, "kb-td-brand", ["tok"]);
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    // A visible re-brand is just a silent content push on the existing pass.
    await t.action(internal.lib.wallet.triggerUpdate.triggerUpdate, {
      customerId,
      silent: true,
    });

    const payload = JSON.parse(String(calls[0].init.body)) as {
      serialNumber: string;
    };
    // Same serial → the device pulls the rebuilt (re-branded) pass; no re-install.
    expect(payload.serialNumber).toBe("kb-td-brand");
    const pass = await t.run(async (ctx) =>
      ctx.db
        .query("walletPasses")
        .withIndex("by_serial", (q) => q.eq("serialNumber", "kb-td-brand"))
        .unique(),
    );
    expect(pass?.status).toBe("installed"); // install intact
  });
});

describe("2.8-D triggerUpdate — dead / inactive device robustness (US 27)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WALLET_PUSH_ROUTE_URL = PUSH_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.WALLET_PUSH_ROUTE_URL;
  });

  it("an unenrolled customer (no wallet serial) is a clean no-op — no fetch", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "e@x.fr",
        role: "customer",
      });
      const cid = await ctx.db.insert("customers", {
        userId,
        createdAt: Date.now(),
      });
      return { customerId: cid };
    });
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    const res = await t.action(
      internal.lib.wallet.triggerUpdate.triggerUpdate,
      { customerId, silent: false },
    );
    expect(calls.length).toBe(0); // nothing to push
    expect(res.pushed).toBe(0);
  });

  it("a token the route reports inactive is flipped to inactive — no infinite retry", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedEnrolledPass(t, "kb-td-dead", [
      "tok-live",
      "tok-dead",
    ]);
    // The Node route answers: tok-dead is Unregistered / BadDeviceToken.
    stubFetch({ body: { inactiveTokens: ["tok-dead"] } });

    await t.action(internal.lib.wallet.triggerUpdate.triggerUpdate, {
      customerId,
      silent: false,
    });

    const regs = await t.run(async (ctx) =>
      ctx.db
        .query("walletDeviceRegistrations")
        .withIndex("by_serial", (q) => q.eq("serialNumber", "kb-td-dead"))
        .collect(),
    );
    const dead = regs.find((r) => r.pushToken === "tok-dead");
    const live = regs.find((r) => r.pushToken === "tok-live");
    expect(dead?.status).toBe("inactive"); // marked, won't be targeted again
    expect(live?.status).toBe("active"); // healthy device untouched
  });

  it("targeting a serial whose only device is already inactive does not crash and pushes nothing", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedEnrolledPass(t, "kb-td-allgone", []);
    // The pass has an inactive (soft-deleted) registration only.
    await t.run(async (ctx) => {
      await ctx.db.insert("walletDeviceRegistrations", {
        serialNumber: "kb-td-allgone",
        passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
        deviceLibraryIdentifier: "dev-old",
        pushToken: "tok-old",
        status: "inactive",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    });
    const { calls } = stubFetch({ body: { inactiveTokens: [] } });

    const res = await t.action(
      internal.lib.wallet.triggerUpdate.triggerUpdate,
      { customerId, silent: false },
    );
    expect(calls.length).toBe(0); // no active token → nothing to push
    expect(res.pushed).toBe(0);
  });
});

describe("2.8-D triggerUpdate — audited (logAudit, sensitive action)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WALLET_PUSH_ROUTE_URL = PUSH_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.WALLET_PUSH_ROUTE_URL;
  });

  it("writes a wallet.pass.push audit row scoped to the serial", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedEnrolledPass(t, "kb-td-audit", ["tok"]);
    stubFetch({ body: { inactiveTokens: [] } });

    await t.action(internal.lib.wallet.triggerUpdate.triggerUpdate, {
      customerId,
      silent: false,
    });

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "wallet.pass.push"))
        .collect(),
    );
    expect(audits.length).toBe(1);
    expect(audits[0].targetType).toBe("walletPass");
    expect(audits[0].targetId).toBe("kb-td-audit");
    expect(audits[0].actorRole).toBe("system");
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz (ADR 0010). triggerUpdate is INTERNAL (the 2.7 dispatcher
// calls it system-side; it is NOT client-callable) and references the customer
// strictly BY ID, returning only an aggregate count — NEVER a raw customer (the
// MOAT). The card is GLOBAL (no authoritative tenantId). The public surface of
// THIS module is the resolve query, which must leak nothing to any tenant actor.
// ---------------------------------------------------------------------------

describe("2.8-D triggerUpdate — internal-only + no-customer-leak (MOAT, ADR 0010)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
    process.env.WALLET_PUSH_ROUTE_URL = PUSH_URL;
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
    delete process.env.WALLET_PUSH_ROUTE_URL;
  });

  it("the barrel (index.ts) does NOT re-export the Convex action (internal-only, addressed by module path)", async () => {
    // Same convention as generatePass/registrations/linkSerial: a barrel re-export
    // of a Convex function would drag it into the public default graph. The PURE
    // payload builder IS surfaced; the action is reached via internal.* only.
    const barrel = (await import("./index")) as Record<string, unknown>;
    expect(barrel.triggerUpdate).toBeUndefined();
    expect(typeof barrel.buildWalletPushPayload).toBe("function");
  });

  it("returns an aggregate count only — never a raw customer object (MOAT)", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedEnrolledPass(t, "kb-td-moat", ["tok"]);
    stubFetch({ body: { inactiveTokens: [] } });

    const res = await t.action(
      internal.lib.wallet.triggerUpdate.triggerUpdate,
      { customerId, silent: false },
    );
    expect(res).toEqual({ pushed: 1, deactivated: 0 });
    expect(res).not.toHaveProperty("customer");
    expect(res).not.toHaveProperty("email");
    expect(res).not.toHaveProperty("phone");
  });

  it("the internal resolve seam returns NARROW push targets only — no nominative field (MOAT)", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "leak@x.fr",
        role: "customer",
      });
      const cid = await ctx.db.insert("customers", {
        userId,
        email: "leak@x.fr",
        phone: "+33600000000",
        firstName: "Leaky",
        createdAt: Date.now(),
        pushEnrollment: {
          walletSerialNumber: "kb-fuzz-d",
          walletStatus: "enrolled",
        },
      });
      await ctx.db.insert("walletPasses", {
        serialNumber: "kb-fuzz-d",
        passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
        customerId: cid,
        status: "installed",
        installedAt: Date.now(),
        createdAt: Date.now(),
      });
      await ctx.db.insert("walletDeviceRegistrations", {
        serialNumber: "kb-fuzz-d",
        passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
        deviceLibraryIdentifier: "dev-1",
        pushToken: "tok",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      return { customerId: cid };
    });

    const targets = await t.query(
      internal.lib.wallet.triggerUpdate.resolvePushTargets,
      { customerId },
    );
    // Only the technical push targets — never the customer's nominative fields.
    expect(targets?.serialNumber).toBe("kb-fuzz-d");
    expect(targets?.pushTokens).toEqual(["tok"]);
    expect(targets).not.toHaveProperty("email");
    expect(targets).not.toHaveProperty("phone");
    expect(targets).not.toHaveProperty("firstName");
    expect(targets).not.toHaveProperty("customer");
  });
});
