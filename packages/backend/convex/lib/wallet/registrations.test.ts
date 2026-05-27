import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";
import { walletPassAuthToken } from "./internalAuth";

// Module keys for convex-test: array-negation glob + normalise the same-dir "./x"
// keys into the convex/lib/wallet/** path the harness expects.
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
 * 2.8-B — the Apple Wallet Web Service device-registration plumbing, written
 * BEFORE the implementation (TDD red). The crypto-heavy / binary work lives in the
 * Next.js Node routes (`apps/admin/api/wallet/*`); the DB seam + the auth guard are
 * here in Convex, called from the verified Node route over the HMAC-signed internal
 * channel (US 23). These contracts are convex-test–testable; the real `.pkpass`
 * download + the live device install are HITL (POC #3 + e2e device).
 *
 * Apple PassKit Web Service:
 *  - register:   POST   …/registrations/{device}/{passType}/{serial}  body {pushToken}
 *  - unregister: DELETE …/registrations/{device}/{passType}/{serial}
 * Every call carries `Authorization: ApplePass {authenticationToken}` — KB verifies
 * the token (derived from the serial + the internal secret) BEFORE touching the DB.
 */

const SECRET = "kb-internal-shared-secret";

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

async function seedPass(
  t: ReturnType<typeof convexTest>,
  serialNumber: string,
): Promise<{ customerId: Id<"customers"> }> {
  return t.run(async (ctx) => {
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
    return { customerId };
  });
}

describe("2.8-B registerDevice — idempotent device↔pass registration (US 10)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("creates an active registration with the pushToken for a known pass + valid token", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-reg-1");
    const authToken = await walletPassAuthToken(SECRET, "kb-reg-1");

    const res = await t.mutation(
      internal.lib.wallet.registrations.registerDevice,
      {
        deviceLibraryIdentifier: "device-A",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        serialNumber: "kb-reg-1",
        pushToken: "apns-token-1",
        authToken,
      },
    );
    expect(res.created).toBe(true);

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("walletDeviceRegistrations")
        .withIndex("by_device_serial", (q) =>
          q
            .eq("deviceLibraryIdentifier", "device-A")
            .eq("serialNumber", "kb-reg-1"),
        )
        .unique(),
    );
    expect(row?.status).toBe("active");
    expect(row?.pushToken).toBe("apns-token-1");
  });

  it("is idempotent on the same (device, serial) couple — refreshes the token, no duplicate row", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-reg-2");
    const authToken = await walletPassAuthToken(SECRET, "kb-reg-2");

    const first = await t.mutation(
      internal.lib.wallet.registrations.registerDevice,
      {
        deviceLibraryIdentifier: "device-B",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        serialNumber: "kb-reg-2",
        pushToken: "tok-old",
        authToken,
      },
    );
    expect(first.created).toBe(true);

    const second = await t.mutation(
      internal.lib.wallet.registrations.registerDevice,
      {
        deviceLibraryIdentifier: "device-B",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        serialNumber: "kb-reg-2",
        pushToken: "tok-new",
        authToken,
      },
    );
    expect(second.created).toBe(false); // already existed → refresh, not create

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("walletDeviceRegistrations")
        .withIndex("by_device_serial", (q) =>
          q
            .eq("deviceLibraryIdentifier", "device-B")
            .eq("serialNumber", "kb-reg-2"),
        )
        .collect(),
    );
    expect(rows.length).toBe(1); // idempotent — exactly one row
    expect(rows[0].pushToken).toBe("tok-new"); // token refreshed
    expect(rows[0].status).toBe("active");
  });

  it("re-activates an inactive registration on re-register (install after uninstall)", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-reg-3");
    const authToken = await walletPassAuthToken(SECRET, "kb-reg-3");

    await t.mutation(internal.lib.wallet.registrations.registerDevice, {
      deviceLibraryIdentifier: "device-C",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-reg-3",
      pushToken: "tok",
      authToken,
    });
    await t.mutation(internal.lib.wallet.registrations.unregisterDevice, {
      deviceLibraryIdentifier: "device-C",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-reg-3",
      authToken,
    });
    await t.mutation(internal.lib.wallet.registrations.registerDevice, {
      deviceLibraryIdentifier: "device-C",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-reg-3",
      pushToken: "tok2",
      authToken,
    });

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("walletDeviceRegistrations")
        .withIndex("by_device_serial", (q) =>
          q
            .eq("deviceLibraryIdentifier", "device-C")
            .eq("serialNumber", "kb-reg-3"),
        )
        .unique(),
    );
    expect(row?.status).toBe("active");
  });

  it("refuses an invalid PassKit auth token — no row created (US 10 auth)", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-reg-4");

    await expect(
      t.mutation(internal.lib.wallet.registrations.registerDevice, {
        deviceLibraryIdentifier: "device-D",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        serialNumber: "kb-reg-4",
        pushToken: "tok",
        authToken: "forged-token",
      }),
    ).rejects.toThrow();

    const rows = await t.run(async (ctx) =>
      ctx.db.query("walletDeviceRegistrations").collect(),
    );
    expect(rows).toEqual([]);
  });

  it("refuses to register an unknown serial — no row created", async () => {
    const t = convexTest(schema, modules);
    const authToken = await walletPassAuthToken(SECRET, "kb-does-not-exist");
    await expect(
      t.mutation(internal.lib.wallet.registrations.registerDevice, {
        deviceLibraryIdentifier: "device-E",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        serialNumber: "kb-does-not-exist",
        pushToken: "tok",
        authToken,
      }),
    ).rejects.toThrow();
    const rows = await t.run(async (ctx) =>
      ctx.db.query("walletDeviceRegistrations").collect(),
    );
    expect(rows).toEqual([]);
  });
});

describe("2.8-B unregisterDevice — soft inactive on DELETE (US 10)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("flips the registration to inactive (never a hard delete)", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-unreg-1");
    const authToken = await walletPassAuthToken(SECRET, "kb-unreg-1");

    await t.mutation(internal.lib.wallet.registrations.registerDevice, {
      deviceLibraryIdentifier: "device-U",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-unreg-1",
      pushToken: "tok",
      authToken,
    });
    const res = await t.mutation(
      internal.lib.wallet.registrations.unregisterDevice,
      {
        deviceLibraryIdentifier: "device-U",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        serialNumber: "kb-unreg-1",
        authToken,
      },
    );
    expect(res.updated).toBe(true);

    const row = await t.run(async (ctx) =>
      ctx.db
        .query("walletDeviceRegistrations")
        .withIndex("by_device_serial", (q) =>
          q
            .eq("deviceLibraryIdentifier", "device-U")
            .eq("serialNumber", "kb-unreg-1"),
        )
        .unique(),
    );
    expect(row).not.toBeNull(); // soft — row survives
    expect(row?.status).toBe("inactive");
  });

  it("refuses an invalid PassKit auth token on unregister", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-unreg-2");
    const authToken = await walletPassAuthToken(SECRET, "kb-unreg-2");
    await t.mutation(internal.lib.wallet.registrations.registerDevice, {
      deviceLibraryIdentifier: "device-V",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-unreg-2",
      pushToken: "tok",
      authToken,
    });
    await expect(
      t.mutation(internal.lib.wallet.registrations.unregisterDevice, {
        deviceLibraryIdentifier: "device-V",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        serialNumber: "kb-unreg-2",
        authToken: "forged",
      }),
    ).rejects.toThrow();
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("walletDeviceRegistrations")
        .withIndex("by_device_serial", (q) =>
          q
            .eq("deviceLibraryIdentifier", "device-V")
            .eq("serialNumber", "kb-unreg-2"),
        )
        .unique(),
    );
    expect(row?.status).toBe("active"); // untouched
  });
});

describe("2.8-B wallet registrations — audited (US 24, logAudit)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("writes an audit row on register and on unregister", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-audit-1");
    const authToken = await walletPassAuthToken(SECRET, "kb-audit-1");

    await t.mutation(internal.lib.wallet.registrations.registerDevice, {
      deviceLibraryIdentifier: "device-AU",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-audit-1",
      pushToken: "tok",
      authToken,
    });
    await t.mutation(internal.lib.wallet.registrations.unregisterDevice, {
      deviceLibraryIdentifier: "device-AU",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      serialNumber: "kb-audit-1",
      authToken,
    });

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) =>
          q.or(
            q.eq(q.field("action"), "wallet.device.register"),
            q.eq(q.field("action"), "wallet.device.unregister"),
          ),
        )
        .collect(),
    );
    expect(audits.map((a) => a.action).sort()).toEqual([
      "wallet.device.register",
      "wallet.device.unregister",
    ]);
    expect(
      audits.every((a) => a.targetType === "walletDeviceRegistration"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz (ADR 0010) — the public auth guard rejects every forged token
// ---------------------------------------------------------------------------

describe("2.8-B wallet registrations — cross-tenant / forged-token fuzz (ADR 0010)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("the public verifyDeviceAuth guard throws for every actor presenting a forged token", async () => {
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);
    await seedPass(t, "kb-fuzz-1");

    // The card is GLOBAL (no tenantId), so the boundary protected here is the
    // PassKit auth token, not a tenantId. The public query refuses every caller
    // that presents a forged token — no actor (manager of A or B, detached,
    // anonymous) can pass the guard. Replays the reusable fuzz harness with a
    // wrong token injected as the extra arg.
    const actors: FuzzActor[] = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.wallet.registrations.verifyDeviceAuth],
      isQuery: () => true,
      tenantId: undefined,
      actors,
      extraArgs: {
        serialNumber: "kb-fuzz-1",
        authToken: "forged-by-attacker",
      },
    });
    expect(leaks).toEqual([]);
  });
});
