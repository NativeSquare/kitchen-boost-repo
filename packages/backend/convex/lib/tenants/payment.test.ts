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

/**
 * PWA-S7 (#458) — `paymentContextForCustomer.forCheckout`, written
 * BEFORE the implementation (TDD red).
 *
 * Surface (`lib/tenants/payment`):
 *  - `forCheckout({ tenantId })` (self via `customerQuery`) — surfaces
 *    `{ tenantId, stripeAccountId, stripeStatus }` for an AUTHENTICATED
 *    customer on the resto's PWA, so `<StripeElementsProvider>` can
 *    mount Elements with `stripeAccount: acct_…`.
 *  - The wrapper rejects non-customer callers (PRO, anonymous) —
 *    `customerQuery`. A tenant missing `stripeAccountId` returns `null`
 *    for both fields (the front renders the « pas prêt » fallback).
 */

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/tenants/${path.slice(2)}` : path,
    loader,
  ]),
);

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

async function seedAnonymousCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { role: "customer", isAnonymous: true }),
  );
}

describe("PWA-S7 forCheckout — surfaces stripeAccountId + stripeStatus to the customer", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns the tenant's stripeAccountId + 'ready' when onboarded", async () => {
    // Stamp the tenant as Stripe-ready (mirrors what 2.5-A account.updated
    // webhook produces in prod).
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, {
        stripeAccountId: "acct_test_ready",
        stripeStatus: "ready",
      });
    });
    const userId = await seedAnonymousCustomer(t);
    const got = await t
      .withIdentity({ subject: userId })
      .query(api.lib.tenants.payment.forCheckout, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(got).toEqual({
      tenantId: seed.tenantA.tenantId,
      stripeAccountId: "acct_test_ready",
      stripeStatus: "ready",
    });
  });

  it("returns null for both fields when the tenant has no Stripe account yet", async () => {
    const userId = await seedAnonymousCustomer(t);
    const got = await t
      .withIdentity({ subject: userId })
      .query(api.lib.tenants.payment.forCheckout, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(got.stripeAccountId).toBeNull();
    expect(got.stripeStatus).toBeNull();
  });

  it("surfaces 'pending' for a tenant whose KYC is incomplete", async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, {
        stripeAccountId: "acct_test_pending",
        stripeStatus: "pending",
      });
    });
    const userId = await seedAnonymousCustomer(t);
    const got = await t
      .withIdentity({ subject: userId })
      .query(api.lib.tenants.payment.forCheckout, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(got.stripeStatus).toBe("pending");
  });
});

describe("PWA-S7 forCheckout — auth gate (Unauthenticated / Forbidden)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    await expect(
      t.query(api.lib.tenants.payment.forCheckout, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — customer wrapper is customers only", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .query(api.lib.tenants.payment.forCheckout, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("PWA-S7 forCheckout — cross-tenant fuzz (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("rejects unauthorized GLOBAL actors (kb_admin + anonymous) on the customer-self surface", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.tenants.payment.forCheckout],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      extraArgs: {},
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
    });
    expect(pairs).toBe(2);
    expect(leaks).toEqual([]);
  });
});
