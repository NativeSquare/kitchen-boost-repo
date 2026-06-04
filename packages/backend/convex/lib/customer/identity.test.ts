import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";
import { PWA_SESSION_CONFIG, anonymousProfile } from "../../auth";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/customer/, so normalise every key to be relative to the convex root
// (../../) so convex-test's findModulesRoot has ONE common prefix (same shape as
// the tenancy / crypto suites of 1.x).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/customer/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.1-B — Auth anonyme Customer, written BEFORE the implementation (TDD red).
 *
 * A customer = an anonymous Convex Auth `users` row (`isAnonymous = true`, global
 * role `customer`) + a silently-provisioned `customers` fiche (FK `userId`). The
 * Convex Auth native session cookie IS the device cookie (ADR 0008); recognition
 * is INTRA-resto only (each resto on its own brand domain → host-only `__Host-`
 * cookie). Cross-resto recognition is the Wallet pass ONLY — NOT this story; there
 * is NO `customerSessions` table and NO cross-domain logic here.
 *
 * Surface: `lib/customer/identity` exposing `getOrCreateCurrentCustomer` (self,
 * via `customerMutation`) + `getCurrentCustomer` (self, via `customerQuery`).
 * Identity flows ONLY through `getCurrentActor` (ADR 0011) — no direct
 * `getAuthUserId`. The GLOBAL `customers` table is reached ONLY through the
 * sanctioned tenancy seam (`lib/tenancy/customerFiche`), never raw `ctx.db` in
 * this business module (ADR 0010 / `no-untenanted-query`).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** Seed an anonymous customer (the shape the Anonymous provider produces). */
async function seedAnonymousCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { role: "customer", isAnonymous: true }),
  );
}

describe("PWA-S3 (#451) PWA_SESSION_CONFIG — 365j sliding session override", () => {
  it("sets BOTH totalDurationMs and inactiveDurationMs to 365 days (Convex Auth default 30j → 365j)", () => {
    // customer-data CONTEXT « Anonymous account » + decisions-log Q3:
    // sliding 365j so a returning Sophie is silently recognised intra-resto
    // for a year. Asserting BOTH fields pins « sliding » (not a one-shot 30j
    // inactivity cap) — change either default → loud test failure.
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
    expect(PWA_SESSION_CONFIG.totalDurationMs).toBe(ONE_YEAR_MS);
    expect(PWA_SESSION_CONFIG.inactiveDurationMs).toBe(ONE_YEAR_MS);
  });
});

describe("2.1-B Anonymous provider profile — role customer + isAnonymous", () => {
  it("stamps every anonymous sign-in as role=customer, isAnonymous=true", () => {
    // The profile callback is OUR contribution to the Convex Auth Anonymous
    // provider: silently mark the freshly-created user as a global `customer`
    // and `isAnonymous` (ADR 0008 / PRD 90 §1). No params are required.
    const profile = anonymousProfile({});
    expect(profile.role).toBe("customer");
    expect(profile.isAnonymous).toBe(true);
  });

  it("ignores any incoming params (anonymous = no user-provided info)", () => {
    const profile = anonymousProfile({
      email: "spoof@evil.fr",
      role: "kb_admin",
    });
    // A caller cannot smuggle a privileged role through the anonymous sign-in.
    expect(profile.role).toBe("customer");
    expect(profile.isAnonymous).toBe(true);
    expect("email" in profile).toBe(false);
  });
});

describe("2.1-B getOrCreateCurrentCustomer — silent provisioning + idempotency", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("creates a customers fiche on first visit, linked to the caller's userId", async () => {
    const userId = await seedAnonymousCustomer(t);
    const customerId = await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {
        tenantId: seed.tenantA.tenantId,
      });

    // The fiche exists, is keyed on the caller's userId, and carries createdAt.
    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    expect(fiche?.userId).toBe(userId);
    expect(typeof fiche?.createdAt).toBe("number");
    // GLOBAL table: no tenantId is stamped on the fiche (the MOAT, ADR 0010).
    expect("tenantId" in (fiche ?? {})).toBe(false);
  });

  it("is idempotent: the same session returns the SAME customerId (no duplicate fiche)", async () => {
    const userId = await seedAnonymousCustomer(t);
    const as = t.withIdentity({ subject: userId });

    const first = await as.mutation(
      api.lib.customer.identity.getOrCreateCurrentCustomer,
      { tenantId: seed.tenantA.tenantId },
    );
    // Returning on the same resto/device — recognised, no re-provision.
    const second = await as.mutation(
      api.lib.customer.identity.getOrCreateCurrentCustomer,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(second).toBe(first);

    // Exactly ONE fiche exists for this user (idempotent provisioning).
    const count = await t.run(
      async (ctx) =>
        (
          await ctx.db
            .query("customers")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .collect()
        ).length,
    );
    expect(count).toBe(1);
  });

  it("is idempotent ACROSS restos for the same session (cookie is intra-resto, fiche is GLOBAL)", async () => {
    // The same Convex session reaching the SAME backend from two restos of the
    // same KB still maps to ONE global customer (the fiche is keyed on userId,
    // not tenantId). Cross-resto DEVICE recognition is out of scope (Wallet pass),
    // but the fiche itself is global and must not be duplicated per tenant.
    const userId = await seedAnonymousCustomer(t);
    const as = t.withIdentity({ subject: userId });
    const a = await as.mutation(
      api.lib.customer.identity.getOrCreateCurrentCustomer,
      { tenantId: seed.tenantA.tenantId },
    );
    const b = await as.mutation(
      api.lib.customer.identity.getOrCreateCurrentCustomer,
      { tenantId: seed.tenantB.tenantId },
    );
    expect(b).toBe(a);
  });
});

describe("2.1-B getCurrentCustomer — self-scope read", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns null before provisioning, then the fiche after", async () => {
    const userId = await seedAnonymousCustomer(t);
    const as = t.withIdentity({ subject: userId });

    const before = await as.query(
      api.lib.customer.identity.getCurrentCustomer,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(before).toBeNull();

    const customerId = await as.mutation(
      api.lib.customer.identity.getOrCreateCurrentCustomer,
      { tenantId: seed.tenantA.tenantId },
    );
    const after = await as.query(api.lib.customer.identity.getCurrentCustomer, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(after?._id).toBe(customerId);
    expect(after?.userId).toBe(userId);
  });

  it("self-scope: a caller only ever sees its OWN fiche (never another customer's)", async () => {
    const alice = await seedAnonymousCustomer(t);
    const bob = await seedAnonymousCustomer(t);

    const aliceFiche = await t
      .withIdentity({ subject: alice })
      .mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {
        tenantId: seed.tenantA.tenantId,
      });
    await t
      .withIdentity({ subject: bob })
      .mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {
        tenantId: seed.tenantA.tenantId,
      });

    // Bob reading "his" fiche must NEVER surface Alice's fiche.
    const bobSees = await t
      .withIdentity({ subject: bob })
      .query(api.lib.customer.identity.getCurrentCustomer, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(bobSees?._id).not.toBe(aliceFiche);
    expect(bobSees?.userId).toBe(bob);
  });
});

describe("2.1-B auth gate — customer wrapper (Unauthenticated / Forbidden)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    await expect(
      t.mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — customer wrapper is customers only", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("requires an explicit tenantId argument", async () => {
    const userId = await seedAnonymousCustomer(t);
    await expect(
      t
        .withIdentity({ subject: userId })
        // @ts-expect-error tenantId is a required explicit argument
        .mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {}),
    ).rejects.toThrow();
  });
});

describe("2.1-B cross-tenant fuzz — getOrCreateCurrentCustomer rejects unauthorized actors", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  // Reuse the 1.x harness verbatim. The customer wrapper's only GLOBAL
  // non-customer actor is kb_admin (resto roles are per-tenant; a manager/staff is
  // globally a customer and IS an eater). So the isolation pinned here: the global
  // root never provisions/leaks through the customer surface, complemented by the
  // structural self-scope (the handler only sees its own userId).
  it("the global root (kb_admin) is rejected by the customer provisioning surface", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.identity.getOrCreateCurrentCustomer],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
      ] satisfies FuzzActor[],
    });
    expect(pairs).toBe(1);
    expect(leaks).toEqual([]);
  });

  it("the read surface (getCurrentCustomer) also rejects the global root", async () => {
    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.identity.getCurrentCustomer],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(leaks).toEqual([]);
  });
});
