import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";

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
 * PWA-S6a (#455) — `checkInstallStatus` query, written BEFORE the implementation
 * (TDD red).
 *
 * The "Tester sans attendre" button of the Wallet install loader (decisions-log
 * Q8 « Flow async install Wallet : loader 30s + Tester sans attendre +
 * J'ai changé d'avis ») polls THIS query to find out whether the pass-install
 * webhook (Apple PassKit `register` → 2.8-C `linkSerialToCustomer`) has landed
 * on our backend yet — without having to wait for the 30 s loader timeout or
 * the Convex sub flip.
 *
 * Source of truth = `walletPasses.status` (TECHNICAL state of the pass row,
 * flipped to `"installed"` by 2.8-C `setWalletPassInstalled` once the webhook
 * is processed inside `withIdempotence`). The query returns the BOOLEAN derived
 * from that single field — NOT a raw row, NOT the customerId — so the wire
 * shape stays minimal and the MOAT (a raw `customer` to a manager) is
 * structurally avoided.
 *
 * Self-scoped (`customerQuery`): the caller can only poll a serial that belongs
 * to its OWN customer fiche (the pass's `customerId` must equal the resolved
 * `customers.by_user` row id). A serial belonging to ANOTHER customer's fiche
 * is invisible — the same FORBIDDEN throw the cross-tenant fuzz checks. Anonymous
 * + PRO callers are refused by the wrapper.
 *
 * An unknown serial — or one not owned by the caller — returns `{ installed:
 * false }` rather than throwing: from the UI's point of view, "not visible to
 * me yet" and "exists but not installed yet" both reduce to "keep waiting"
 * (decisions-log Q8 « loader 30s + Tester sans attendre pollable »).
 * Throwing would surface the existence of the serial to a probing attacker.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** Seed an anonymous customer (shape the Anonymous provider produces). */
async function seedAnonymousCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { role: "customer", isAnonymous: true }),
  );
}

/**
 * Provision a fiche for `userId` on `tenantId` and return its customers id —
 * same shape as the consent / identity / webPush suites.
 */
async function provision(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  tenantId: Id<"tenants">,
): Promise<Id<"customers">> {
  return t
    .withIdentity({ subject: userId })
    .mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {
      tenantId,
    });
}

/** Seed a `walletPasses` row for `customerId` with explicit `status`. */
async function seedPassRow(
  t: ReturnType<typeof convexTest>,
  args: {
    customerId: Id<"customers">;
    serialNumber: string;
    status: "generated" | "installed" | "inactive";
    installedAt?: number;
  },
): Promise<Id<"walletPasses">> {
  return t.run(async (ctx) =>
    ctx.db.insert("walletPasses", {
      serialNumber: args.serialNumber,
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      customerId: args.customerId,
      status: args.status,
      installedAt: args.installedAt,
      createdAt: Date.now(),
    }),
  );
}

// ---------------------------------------------------------------------------
// Happy path: installed status flips the boolean.
// ---------------------------------------------------------------------------

describe("PWA-S6a checkInstallStatus — installed boolean derived from walletPasses.status", () => {
  it("returns { installed: false } when the pass is still `generated` (webhook not landed yet)", async () => {
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await seedPassRow(t, {
      customerId,
      serialNumber: "kb-pwa-s6a-generated",
      status: "generated",
    });

    const result = await t
      .withIdentity({ subject: userId })
      .query(api.lib.wallet.checkInstallStatus.checkInstallStatus, {
        tenantId: seed.tenantA.tenantId,
        serialNumber: "kb-pwa-s6a-generated",
      });
    expect(result).toEqual({ installed: false });
  });

  it("returns { installed: true } once the pass is flipped to `installed`", async () => {
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await seedPassRow(t, {
      customerId,
      serialNumber: "kb-pwa-s6a-installed",
      status: "installed",
      installedAt: Date.now(),
    });

    const result = await t
      .withIdentity({ subject: userId })
      .query(api.lib.wallet.checkInstallStatus.checkInstallStatus, {
        tenantId: seed.tenantA.tenantId,
        serialNumber: "kb-pwa-s6a-installed",
      });
    expect(result).toEqual({ installed: true });
  });

  it("treats `inactive` as not-installed (lifecycle ≠ install state for the loader)", async () => {
    // A pass that was once installed then unregistered (soft inactive) is NOT a
    // live enrollment from the loader's point of view — the gate must stay closed
    // until a fresh install lands.
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await seedPassRow(t, {
      customerId,
      serialNumber: "kb-pwa-s6a-inactive",
      status: "inactive",
    });

    const result = await t
      .withIdentity({ subject: userId })
      .query(api.lib.wallet.checkInstallStatus.checkInstallStatus, {
        tenantId: seed.tenantA.tenantId,
        serialNumber: "kb-pwa-s6a-inactive",
      });
    expect(result).toEqual({ installed: false });
  });
});

// ---------------------------------------------------------------------------
// Privacy of unknown / foreign serials — do NOT leak existence by throwing.
// ---------------------------------------------------------------------------

describe("PWA-S6a checkInstallStatus — unknown / foreign serial returns installed:false (no leak)", () => {
  it("returns { installed: false } for a serial that does NOT exist (no NOT_FOUND throw)", async () => {
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);
    const userId = await seedAnonymousCustomer(t);
    await provision(t, userId, seed.tenantA.tenantId);

    const result = await t
      .withIdentity({ subject: userId })
      .query(api.lib.wallet.checkInstallStatus.checkInstallStatus, {
        tenantId: seed.tenantA.tenantId,
        serialNumber: "kb-totally-unknown",
      });
    expect(result).toEqual({ installed: false });
  });

  it("returns { installed: false } for a serial owned by ANOTHER customer (no cross-customer existence leak)", async () => {
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);
    const alice = await seedAnonymousCustomer(t);
    const bob = await seedAnonymousCustomer(t);
    const aliceCustomerId = await provision(t, alice, seed.tenantA.tenantId);
    await provision(t, bob, seed.tenantA.tenantId);
    // Alice OWNS this installed pass.
    await seedPassRow(t, {
      customerId: aliceCustomerId,
      serialNumber: "kb-alice-pass",
      status: "installed",
      installedAt: Date.now(),
    });

    // Bob polls Alice's serial → must NOT learn it is installed (or that it
    // even exists). Same wire shape as any unknown serial.
    const result = await t
      .withIdentity({ subject: bob })
      .query(api.lib.wallet.checkInstallStatus.checkInstallStatus, {
        tenantId: seed.tenantA.tenantId,
        serialNumber: "kb-alice-pass",
      });
    expect(result).toEqual({ installed: false });
  });
});

// ---------------------------------------------------------------------------
// Auth gate — anonymous + PRO refused by the customer wrapper.
// ---------------------------------------------------------------------------

describe("PWA-S6a checkInstallStatus — auth gate (customer-only)", () => {
  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);
    await expect(
      t.query(api.lib.wallet.checkInstallStatus.checkInstallStatus, {
        tenantId: seed.tenantA.tenantId,
        serialNumber: "kb-any",
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — check is customers only", async () => {
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .query(api.lib.wallet.checkInstallStatus.checkInstallStatus, {
          tenantId: seed.tenantA.tenantId,
          serialNumber: "kb-any",
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz (ADR 0010): no PRO actor (manager A / B / detached / anon)
// can drive the query on tenant A — only role `customer` can.
// ---------------------------------------------------------------------------

describe("PWA-S6a checkInstallStatus — cross-tenant fuzz (ADR 0010)", () => {
  it("rejects every PRO / anonymous actor on a tenant-scoped poll", async () => {
    const t = convexTest(schema, modules);
    const seed: Seed = await seedTwoTenantsAllRoles(t);

    const actors: FuzzActor[] = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "kb_admin", subject: seed.adminId },
      { label: "anonymous", subject: null },
    ];

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.wallet.checkInstallStatus.checkInstallStatus],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors,
      extraArgs: { serialNumber: "kb-fuzz" },
    });
    expect(pairs).toBe(4);
    expect(leaks).toEqual([]);
  });
});
