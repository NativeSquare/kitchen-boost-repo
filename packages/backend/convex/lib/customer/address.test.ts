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

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/customer/, so normalise every relative key to be relative to the
// convex root (../../) so convex-test's findModulesRoot has ONE common prefix
// (same shape as the identity / consent suites).
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
 * PWA-S3 (#451) — `updateAddress`, written BEFORE the implementation (TDD red).
 *
 * Surface (`lib/customer/address`):
 *  - `updateAddress({ tenantId, address, lat, lng })` (self, via
 *    `customerMutation`) — stamps the caller's OWN fiche with the Google Places
 *    normalised address + lat/lng. Provisions the fiche on the fly if absent
 *    (the very first submit on a fresh device may race the
 *    `getOrCreateCurrentCustomer` chain; idempotent provisioning is the contract
 *    PWA-S3 leans on, cf. customer-data CONTEXT « Anonymous account » + ADR 0008).
 *  - Re-submitting from the edit-after-validation UX OVERWRITES the previous
 *    address (the form re-fires the quote on every change — decisions-log Q7).
 *  - Self-scoped by construction: keyed on `ctx.actor.userId`, no other
 *    customer's fiche is reachable.
 *
 * Identity flows ONLY through `getCurrentActor` (ADR 0011); the GLOBAL `customers`
 * table is reached ONLY through the sanctioned tenancy seam
 * (`patchCustomerAddress`), never raw `ctx.db` in this business module (ADR 0010
 * / `no-untenanted-query`).
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

/** A fixture Google-Places-normalised address (the form forbids free typing). */
const FIXTURE_ADDRESS = {
  address: "12 rue de la Paix, 75002 Paris, France",
  lat: 48.8698,
  lng: 2.3318,
};

const FIXTURE_ADDRESS_2 = {
  address: "8 boulevard Haussmann, 75009 Paris, France",
  lat: 48.872,
  lng: 2.3389,
};

describe("PWA-S3 updateAddress — stamps the caller's own fiche", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("stamps address/lat/lng on the caller's own fiche (chain after getOrCreateCurrentCustomer)", async () => {
    const userId = await seedAnonymousCustomer(t);
    const as = t.withIdentity({ subject: userId });

    // Realistic PWA-S3 chain: signIn (handled by the auth provider) →
    // getOrCreateCurrentCustomer (provision) → updateAddress (stamp Places result).
    await as.mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {
      tenantId: seed.tenantA.tenantId,
    });
    await as.mutation(api.lib.customer.address.updateAddress, {
      tenantId: seed.tenantA.tenantId,
      ...FIXTURE_ADDRESS,
    });

    const fiche = await as.query(api.lib.customer.identity.getCurrentCustomer, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(fiche?.address).toBe(FIXTURE_ADDRESS.address);
    expect(fiche?.lat).toBe(FIXTURE_ADDRESS.lat);
    expect(fiche?.lng).toBe(FIXTURE_ADDRESS.lng);
  });

  it("provisions the fiche on the fly if updateAddress is called before getOrCreateCurrentCustomer", async () => {
    // The PWA-S3 chain calls getOrCreateCurrentCustomer first, but a future
    // refactor could collapse it; the mutation MUST tolerate a missing fiche
    // (idempotent provisioning) rather than throw — same contract as
    // recordConsentAtCheckout.
    const userId = await seedAnonymousCustomer(t);
    const as = t.withIdentity({ subject: userId });

    await as.mutation(api.lib.customer.address.updateAddress, {
      tenantId: seed.tenantA.tenantId,
      ...FIXTURE_ADDRESS,
    });

    const fiche = await as.query(api.lib.customer.identity.getCurrentCustomer, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(fiche?.address).toBe(FIXTURE_ADDRESS.address);
    expect(fiche?.lat).toBe(FIXTURE_ADDRESS.lat);
    expect(fiche?.lng).toBe(FIXTURE_ADDRESS.lng);
  });

  it("overwrites the previous address on re-submit (edit-after-validation re-fire quote, Q7)", async () => {
    const userId = await seedAnonymousCustomer(t);
    const as = t.withIdentity({ subject: userId });

    await as.mutation(api.lib.customer.address.updateAddress, {
      tenantId: seed.tenantA.tenantId,
      ...FIXTURE_ADDRESS,
    });
    await as.mutation(api.lib.customer.address.updateAddress, {
      tenantId: seed.tenantA.tenantId,
      ...FIXTURE_ADDRESS_2,
    });

    const fiche = await as.query(api.lib.customer.identity.getCurrentCustomer, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(fiche?.address).toBe(FIXTURE_ADDRESS_2.address);
    expect(fiche?.lat).toBe(FIXTURE_ADDRESS_2.lat);
    expect(fiche?.lng).toBe(FIXTURE_ADDRESS_2.lng);
  });

  it("self-scope: a caller only ever stamps its OWN fiche (never another customer's)", async () => {
    const alice = await seedAnonymousCustomer(t);
    const bob = await seedAnonymousCustomer(t);

    await t
      .withIdentity({ subject: alice })
      .mutation(api.lib.customer.address.updateAddress, {
        tenantId: seed.tenantA.tenantId,
        ...FIXTURE_ADDRESS,
      });

    const bobFiche = await t
      .withIdentity({ subject: bob })
      .query(api.lib.customer.identity.getCurrentCustomer, {
        tenantId: seed.tenantA.tenantId,
      });
    // Bob has never written an address; Alice's address must NOT surface here.
    expect(bobFiche?.address).toBeUndefined();
    expect(bobFiche?.lat).toBeUndefined();
    expect(bobFiche?.lng).toBeUndefined();
  });
});

describe("PWA-S3 updateAddress — auth gate (Unauthenticated / Forbidden)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    await expect(
      t.mutation(api.lib.customer.address.updateAddress, {
        tenantId: seed.tenantA.tenantId,
        ...FIXTURE_ADDRESS,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — customer wrapper is customers only", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.customer.address.updateAddress, {
          tenantId: seed.tenantA.tenantId,
          ...FIXTURE_ADDRESS,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("PWA-S3 updateAddress — cross-tenant fuzz (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("rejects unauthorized GLOBAL actors (kb_admin + anonymous) on the customer-self surface", async () => {
    // The customer wrapper accepts ONLY a `customer` role; the cross-tenant
    // fuzz harness pins that no GLOBAL non-customer actor leaks through.
    // (kb_manager / staff are per-tenant; the structural self-scope on
    // ctx.actor.userId covers the customer-vs-customer isolation.)
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.address.updateAddress],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      extraArgs: FIXTURE_ADDRESS,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
    });
    expect(pairs).toBe(2);
    expect(leaks).toEqual([]);
  });
});
