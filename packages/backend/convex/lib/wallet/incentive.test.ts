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
// keys into the convex/lib/wallet/** path the harness expects (project memory).
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
 * 2.8-E — the Incentive Wallet CONDITIONAL delivery mechanism, written BEFORE the
 * implementation (TDD red).
 *
 * NON-NEGOTIABLE CONTRACT (ADR 0002, US 19): the Incentive reward code is delivered
 * ONLY when the pass is REALLY installed — captured by the `pass_installed` event of
 * slice C (#70). NO fake reward: there is NO alternative generation path; the only
 * way a delivery row exists is a real install flowing through `handlePassInstalled`.
 *
 * EXACTLY ONCE per install (US 20): the delivery rides inside the SAME
 * `withIdempotence(provider, eventId, …)` block as the link, so a redelivered event
 * (or a 2nd device on the SAME pass) never issues a second reward. The delivery is
 * also self-guarded at the data level (one row per serial), so it cannot double-issue.
 *
 * AUDITED (US 24): every delivery writes a `wallet.incentive.delivered` audit row.
 *
 * The PARAMETRISATION (the resto's hook text + the promo code value, edited in KB
 * Admin Phase C) is a Phase-3 front — OUT OF SCOPE here (#72). This slice owns only
 * the conditional DELIVERY mechanism, so it records the delivery FACT (no invented
 * promo string), keyed on the pass serial.
 */

const SECRET = "kb-internal-shared-secret";

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** Seed a customer + a generated pass for it; returns ids. */
async function seedPass(
  t: ReturnType<typeof convexTest>,
  serialNumber: string,
): Promise<{ customerId: Id<"customers">; userId: Id<"users"> }> {
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
    return { customerId, userId };
  });
}

/** All incentive delivery rows for a serial. */
async function deliveriesFor(
  t: ReturnType<typeof convexTest>,
  serialNumber: string,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("walletIncentiveDeliveries")
      .withIndex("by_serial", (q) => q.eq("serialNumber", serialNumber))
      .collect(),
  );
}

describe("2.8-E Incentive — delivered ONLY on a real pass_installed (US 19, no fake reward)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("a real install delivers the Incentive exactly once for the right customer", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedPass(t, "kb-inc-1");
    const authToken = await walletPassAuthToken(SECRET, "kb-inc-1");

    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "apple_wallet",
      eventId: "evt-inc-1",
      serialNumber: "kb-inc-1",
      authToken,
    });

    const rows = await deliveriesFor(t, "kb-inc-1");
    expect(rows.length).toBe(1);
    expect(rows[0].customerId).toBe(customerId);
    expect(typeof rows[0].deliveredAt).toBe("number");
  });

  it("NO install ⇒ NO Incentive ever delivered (no fake reward)", async () => {
    const t = convexTest(schema, modules);
    // Seed a customer + pass but NEVER fire pass_installed.
    await seedPass(t, "kb-inc-noinstall");

    const rows = await deliveriesFor(t, "kb-inc-noinstall");
    expect(rows).toEqual([]);
    // And globally: not a single delivery row exists without an install.
    const all = await t.run(async (ctx) =>
      ctx.db.query("walletIncentiveDeliveries").collect(),
    );
    expect(all).toEqual([]);
  });

  it("a forged token ⇒ install rolls back ⇒ NO Incentive delivered", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-inc-forge");

    await expect(
      t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
        provider: "apple_wallet",
        eventId: "evt-inc-forge",
        serialNumber: "kb-inc-forge",
        authToken: "forged-token",
      }),
    ).rejects.toThrow();

    const rows = await deliveriesFor(t, "kb-inc-forge");
    expect(rows).toEqual([]);
  });

  it("an unknown serial ⇒ NOT_FOUND ⇒ NO Incentive delivered", async () => {
    const t = convexTest(schema, modules);
    const authToken = await walletPassAuthToken(SECRET, "kb-inc-nope");

    await expect(
      t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
        provider: "apple_wallet",
        eventId: "evt-inc-nf",
        serialNumber: "kb-inc-nope",
        authToken,
      }),
    ).rejects.toThrow();

    const all = await t.run(async (ctx) =>
      ctx.db.query("walletIncentiveDeliveries").collect(),
    );
    expect(all).toEqual([]);
  });
});

describe("2.8-E Incentive — exactly once per install (US 20, withIdempotence)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("a redelivered (provider, eventId) does NOT double-deliver the Incentive", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-inc-dup");
    const authToken = await walletPassAuthToken(SECRET, "kb-inc-dup");

    const call = () =>
      t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
        provider: "apple_wallet",
        eventId: "evt-inc-dup",
        serialNumber: "kb-inc-dup",
        authToken,
      });

    await call();
    await call(); // redelivery — must NOT re-deliver

    const rows = await deliveriesFor(t, "kb-inc-dup");
    expect(rows.length).toBe(1);
  });

  it("a 2nd device installing the SAME pass does NOT issue a 2nd reward (1 reward per pass)", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-inc-2dev");
    const authToken = await walletPassAuthToken(SECRET, "kb-inc-2dev");

    // Device 1 install.
    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "apple_wallet",
      eventId: "evt-inc-2dev-a",
      serialNumber: "kb-inc-2dev",
      authToken,
    });
    // Device 2 install of the SAME pass — distinct event id, same serial.
    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "apple_wallet",
      eventId: "evt-inc-2dev-b",
      serialNumber: "kb-inc-2dev",
      authToken,
    });

    const rows = await deliveriesFor(t, "kb-inc-2dev");
    expect(rows.length).toBe(1); // one reward per pass, not per device
  });
});

describe("2.8-E Incentive — audited (US 24, logAudit)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("writes a wallet.incentive.delivered audit row scoped to the serial, exactly once", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-inc-audit");
    const authToken = await walletPassAuthToken(SECRET, "kb-inc-audit");

    const call = () =>
      t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
        provider: "apple_wallet",
        eventId: "evt-inc-audit",
        serialNumber: "kb-inc-audit",
        authToken,
      });
    await call();
    await call(); // redelivery — no second audit row

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "wallet.incentive.delivered"))
        .collect(),
    );
    expect(audits.length).toBe(1);
    expect(audits[0].targetType).toBe("walletIncentive");
    expect(audits[0].targetId).toBe("kb-inc-audit");
    expect(audits[0].actorRole).toBe("system");
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz (ADR 0010). The Incentive delivery is driven exclusively by
// the GLOBAL, common-card install path (no authoritative tenantId — ADR 0003), so
// the boundary protected is the PassKit token (same as slice C): no actor —
// manager of A or B, detached, anonymous — can drive a delivery through the public
// guard with a forged token, and no function leaks one tenant's data to another.
// ---------------------------------------------------------------------------

describe("2.8-E Incentive — cross-tenant / forged-token fuzz (ADR 0010)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("the public incentiveDeliveryStatus guard throws for every actor presenting a forged token", async () => {
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);
    await seedPass(t, "kb-inc-fuzz");

    const actors: FuzzActor[] = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.wallet.incentive.incentiveDeliveryStatus],
      isQuery: () => true,
      tenantId: undefined,
      actors,
      extraArgs: {
        serialNumber: "kb-inc-fuzz",
        authToken: "forged-by-attacker",
      },
    });
    expect(leaks).toEqual([]);
  });
});
