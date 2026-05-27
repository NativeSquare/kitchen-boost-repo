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
 * 2.8-C — `linkSerialToCustomer` + the `pass_installed` event, written BEFORE the
 * implementation (TDD red).
 *
 * The cross-device identity BRIDGE (ADR 0008/0012): once a pass is REALLY installed,
 * the Wallet `serial → customer_id` is written into the 2.1 Customer Data store
 * (`customers.pushEnrollment.walletSerialNumber`), and the per-channel push
 * enrollment status flips to `enrolled` (joignabilité = source de vérité 2.1).
 * 2.8 stores NOTHING authoritative (no identity/joignabilité table of its own) — it
 * only writes the serial onto the 2.1 fiche + marks its OWN technical pass row
 * `installed`.
 *
 * The install signal is a SYSTEM webhook (Apple PassKit register / Google Wallet
 * add) forwarded over the HMAC-signed internal channel (same seam as 2.8-B), so the
 * mutation is `internal*`, re-verifies the per-pass PassKit token (the GLOBAL card's
 * only auth boundary — no `tenantId`), and is made effectively exactly-once per
 * `(provider, eventId)` via the foundation `withIdempotence` (US 20).
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

describe("2.8-C handlePassInstalled — links serial → customer in 2.1 (ADR 0008/0012)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("writes the walletSerialNumber + enrolled status onto the RIGHT customer fiche (2.1)", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedPass(t, "kb-link-1");
    const authToken = await walletPassAuthToken(SECRET, "kb-link-1");

    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "apple_wallet",
      eventId: "evt-1",
      serialNumber: "kb-link-1",
      authToken,
    });

    const fiche = await t.run(async (ctx) => ctx.db.get(customerId));
    expect(fiche?.pushEnrollment?.walletSerialNumber).toBe("kb-link-1");
    expect(fiche?.pushEnrollment?.walletStatus).toBe("enrolled");
  });

  it("nothing authoritative is stored on the pass side — only the local technical state flips to installed", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-link-2");
    const authToken = await walletPassAuthToken(SECRET, "kb-link-2");

    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "apple_wallet",
      eventId: "evt-2",
      serialNumber: "kb-link-2",
      authToken,
    });

    const pass = await t.run(async (ctx) =>
      ctx.db
        .query("walletPasses")
        .withIndex("by_serial", (q) => q.eq("serialNumber", "kb-link-2"))
        .unique(),
    );
    expect(pass?.status).toBe("installed");
    expect(typeof pass?.installedAt).toBe("number");
    // The pass row never gains an authoritative tenantId / identity field.
    expect(pass).not.toHaveProperty("tenantId");
  });

  it("a 2nd device installing the SAME pass attaches to the SAME customerId (cross-device bridge, ADR 0008)", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedPass(t, "kb-link-3");
    const authToken = await walletPassAuthToken(SECRET, "kb-link-3");

    // Device 1 install.
    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "apple_wallet",
      eventId: "evt-3a",
      serialNumber: "kb-link-3",
      authToken,
    });
    // Device 2 install of the SAME pass (same serial) — distinct event id.
    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "apple_wallet",
      eventId: "evt-3b",
      serialNumber: "kb-link-3",
      authToken,
    });

    // Still exactly ONE customer carries the serial — the same one (no new fiche).
    const fiches = await t.run(async (ctx) =>
      ctx.db.query("customers").collect(),
    );
    const withSerial = fiches.filter(
      (f) => f.pushEnrollment?.walletSerialNumber === "kb-link-3",
    );
    expect(withSerial.length).toBe(1);
    expect(withSerial[0]._id).toBe(customerId);
  });

  it("preserves the other push channels when stamping the wallet enrollment (US #16 merge)", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedPass(t, "kb-link-merge");
    // Pre-existing web-push enrollment on the fiche.
    await t.run(async (ctx) => {
      await ctx.db.patch(customerId, {
        pushEnrollment: {
          webPushSubscriptionId: "sub-xyz",
          webPushStatus: "enrolled",
        },
      });
    });
    const authToken = await walletPassAuthToken(SECRET, "kb-link-merge");

    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "apple_wallet",
      eventId: "evt-merge",
      serialNumber: "kb-link-merge",
      authToken,
    });

    const fiche = await t.run(async (ctx) => ctx.db.get(customerId));
    // Wallet stamped...
    expect(fiche?.pushEnrollment?.walletSerialNumber).toBe("kb-link-merge");
    expect(fiche?.pushEnrollment?.walletStatus).toBe("enrolled");
    // ...without clobbering the web-push channel.
    expect(fiche?.pushEnrollment?.webPushSubscriptionId).toBe("sub-xyz");
    expect(fiche?.pushEnrollment?.webPushStatus).toBe("enrolled");
  });
});

describe("2.8-C pass_installed — idempotent via withIdempotence (US 20)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("a redelivered (provider, eventId) is a clean no-op — processed exactly once", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-idem-1");
    const authToken = await walletPassAuthToken(SECRET, "kb-idem-1");

    const call = () =>
      t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
        provider: "apple_wallet",
        eventId: "evt-dup",
        serialNumber: "kb-idem-1",
        authToken,
      });

    await call();
    await call(); // redelivery — must NOT re-process

    const ledger = await t.run(async (ctx) =>
      ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_provider_event", (q) =>
          q.eq("provider", "apple_wallet").eq("externalId", "evt-dup"),
        )
        .collect(),
    );
    expect(ledger.length).toBe(1); // exactly one ledger row for the event

    // Exactly one audit row for the install (not double-counted).
    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "wallet.pass.installed"))
        .collect(),
    );
    expect(audits.length).toBe(1);
  });

  it("two DIFFERENT providers may reuse the same eventId without colliding", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-idem-2");
    const authToken = await walletPassAuthToken(SECRET, "kb-idem-2");

    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "apple_wallet",
      eventId: "shared-id",
      serialNumber: "kb-idem-2",
      authToken,
    });
    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "google_wallet",
      eventId: "shared-id",
      serialNumber: "kb-idem-2",
      authToken,
    });

    const ledger = await t.run(async (ctx) =>
      ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_provider_event", (q) =>
          q.eq("provider", "apple_wallet").eq("externalId", "shared-id"),
        )
        .collect(),
    );
    expect(ledger.length).toBe(1);
    const ledger2 = await t.run(async (ctx) =>
      ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_provider_event", (q) =>
          q.eq("provider", "google_wallet").eq("externalId", "shared-id"),
        )
        .collect(),
    );
    expect(ledger2.length).toBe(1);
  });
});

describe("2.8-C handlePassInstalled — auth + unknown serial", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("rejects a forged PassKit token — nothing linked, no ledger row", async () => {
    const t = convexTest(schema, modules);
    const { customerId } = await seedPass(t, "kb-forge-1");

    await expect(
      t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
        provider: "apple_wallet",
        eventId: "evt-forge",
        serialNumber: "kb-forge-1",
        authToken: "forged-token",
      }),
    ).rejects.toThrow();

    const fiche = await t.run(async (ctx) => ctx.db.get(customerId));
    expect(fiche?.pushEnrollment).toBeUndefined();
    const ledger = await t.run(async (ctx) =>
      ctx.db.query("processedWebhookEvents").collect(),
    );
    expect(ledger).toEqual([]); // rolled back — event NOT marked processed
  });

  it("rejects an unknown serial (NOT_FOUND) — nothing linked", async () => {
    const t = convexTest(schema, modules);
    const authToken = await walletPassAuthToken(SECRET, "kb-nope");
    await expect(
      t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
        provider: "apple_wallet",
        eventId: "evt-nf",
        serialNumber: "kb-nope",
        authToken,
      }),
    ).rejects.toThrow();
    const ledger = await t.run(async (ctx) =>
      ctx.db.query("processedWebhookEvents").collect(),
    );
    expect(ledger).toEqual([]);
  });
});

describe("2.8-C handlePassInstalled — audited (US 24, logAudit)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("writes a wallet.pass.installed audit row scoped to the serial", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-audit-c");
    const authToken = await walletPassAuthToken(SECRET, "kb-audit-c");

    await t.mutation(internal.lib.wallet.linkSerial.handlePassInstalled, {
      provider: "apple_wallet",
      eventId: "evt-audit",
      serialNumber: "kb-audit-c",
      authToken,
    });

    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "wallet.pass.installed"))
        .collect(),
    );
    expect(audits.length).toBe(1);
    expect(audits[0].targetType).toBe("walletPass");
    expect(audits[0].targetId).toBe("kb-audit-c");
    expect(audits[0].actorRole).toBe("system");
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz (ADR 0010) — the install touches the MOAT customer store.
// The card is GLOBAL by design (no authoritative tenantId), so the boundary
// protected here is the PassKit token (same as 2.8-B): no actor — manager of A
// or B, detached, anonymous — can drive a link with a forged token, and no
// function exposes one tenant's data to another tenant's manager.
// ---------------------------------------------------------------------------

describe("2.8-C link serial — cross-tenant / forged-token fuzz (ADR 0010)", () => {
  beforeEach(() => {
    process.env.WALLET_INTERNAL_HMAC_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.WALLET_INTERNAL_HMAC_SECRET;
  });

  it("the public verifyInstallAuth guard throws for every actor presenting a forged token", async () => {
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);
    await seedPass(t, "kb-fuzz-c");

    const actors: FuzzActor[] = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.wallet.linkSerial.verifyInstallAuth],
      isQuery: () => true,
      tenantId: undefined,
      actors,
      extraArgs: {
        serialNumber: "kb-fuzz-c",
        authToken: "forged-by-attacker",
      },
    });
    expect(leaks).toEqual([]);
  });
});
