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
 * PWA-S7 (#458) — `recordCheckoutContact`, written BEFORE the implementation
 * (TDD red). The mutation stamps the firstName + email + phone the customer
 * submits at the `/checkout` form (US 44 prefill, decisions-log Q3 « Recognition
 * UX » — capture at the first explicit checkout, surface on the next).
 *
 * Surface (`lib/customer/checkoutContact`):
 *  - `recordCheckoutContact({ tenantId, firstName, email, phone })`
 *    (self, via `customerMutation`) — stamps the caller's OWN fiche with
 *    `firstName`, `email`, `phone`. Provisions the fiche on the fly if absent
 *    (same idempotent contract as `updateAddress` / `recordConsentAtCheckout`).
 *  - Re-submit OVERWRITES the previous PII (the customer may correct a typo at
 *    a later checkout — the fiche always reflects the latest submit).
 *  - Self-scoped by construction: keyed on `ctx.actor.userId`, no other
 *    customer's fiche is reachable; identity flows ONLY through
 *    `getCurrentActor` (ADR 0011); the GLOBAL `customers` table is reached ONLY
 *    through the sanctioned tenancy seam (`patchCustomerCheckoutContact`),
 *    never raw `ctx.db` (ADR 0010 / `no-untenanted-query`).
 */

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

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

async function seedAnonymousCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { role: "customer", isAnonymous: true }),
  );
}

const FIXTURE_CONTACT = {
  firstName: "Sophie",
  email: "sophie@example.com",
  phone: "+33612345678",
};

const FIXTURE_CONTACT_2 = {
  firstName: "Sophie M.",
  email: "sophie.m@example.com",
  phone: "+33698765432",
};

describe("PWA-S7 recordCheckoutContact — stamps the caller's own fiche", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("stamps firstName/email/phone on the caller's own fiche", async () => {
    const userId = await seedAnonymousCustomer(t);
    const as = t.withIdentity({ subject: userId });

    await as.mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {
      tenantId: seed.tenantA.tenantId,
    });
    await as.mutation(api.lib.customer.checkoutContact.recordCheckoutContact, {
      tenantId: seed.tenantA.tenantId,
      ...FIXTURE_CONTACT,
    });

    const fiche = await as.query(api.lib.customer.identity.getCurrentCustomer, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(fiche?.firstName).toBe(FIXTURE_CONTACT.firstName);
    expect(fiche?.email).toBe(FIXTURE_CONTACT.email);
    expect(fiche?.phone).toBe(FIXTURE_CONTACT.phone);
  });

  it("provisions the fiche on the fly if called before getOrCreateCurrentCustomer", async () => {
    const userId = await seedAnonymousCustomer(t);
    const as = t.withIdentity({ subject: userId });

    await as.mutation(api.lib.customer.checkoutContact.recordCheckoutContact, {
      tenantId: seed.tenantA.tenantId,
      ...FIXTURE_CONTACT,
    });

    const fiche = await as.query(api.lib.customer.identity.getCurrentCustomer, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(fiche?.firstName).toBe(FIXTURE_CONTACT.firstName);
    expect(fiche?.email).toBe(FIXTURE_CONTACT.email);
    expect(fiche?.phone).toBe(FIXTURE_CONTACT.phone);
  });

  it("overwrites the previous contact on re-submit (typo correction at a later checkout)", async () => {
    const userId = await seedAnonymousCustomer(t);
    const as = t.withIdentity({ subject: userId });

    await as.mutation(api.lib.customer.checkoutContact.recordCheckoutContact, {
      tenantId: seed.tenantA.tenantId,
      ...FIXTURE_CONTACT,
    });
    await as.mutation(api.lib.customer.checkoutContact.recordCheckoutContact, {
      tenantId: seed.tenantA.tenantId,
      ...FIXTURE_CONTACT_2,
    });

    const fiche = await as.query(api.lib.customer.identity.getCurrentCustomer, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(fiche?.firstName).toBe(FIXTURE_CONTACT_2.firstName);
    expect(fiche?.email).toBe(FIXTURE_CONTACT_2.email);
    expect(fiche?.phone).toBe(FIXTURE_CONTACT_2.phone);
  });

  it("preserves siblings (address) when stamping contact fields", async () => {
    const userId = await seedAnonymousCustomer(t);
    const as = t.withIdentity({ subject: userId });

    await as.mutation(api.lib.customer.address.updateAddress, {
      tenantId: seed.tenantA.tenantId,
      address: "12 rue de la Paix, 75002 Paris, France",
      lat: 48.8698,
      lng: 2.3318,
    });
    await as.mutation(api.lib.customer.checkoutContact.recordCheckoutContact, {
      tenantId: seed.tenantA.tenantId,
      ...FIXTURE_CONTACT,
    });

    const fiche = await as.query(api.lib.customer.identity.getCurrentCustomer, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(fiche?.address).toBe("12 rue de la Paix, 75002 Paris, France");
    expect(fiche?.firstName).toBe(FIXTURE_CONTACT.firstName);
  });

  it("self-scope: a caller only ever stamps its OWN fiche (never another customer's)", async () => {
    const alice = await seedAnonymousCustomer(t);
    const bob = await seedAnonymousCustomer(t);

    await t
      .withIdentity({ subject: alice })
      .mutation(api.lib.customer.checkoutContact.recordCheckoutContact, {
        tenantId: seed.tenantA.tenantId,
        ...FIXTURE_CONTACT,
      });

    const bobFiche = await t
      .withIdentity({ subject: bob })
      .query(api.lib.customer.identity.getCurrentCustomer, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(bobFiche?.firstName).toBeUndefined();
    expect(bobFiche?.email).toBeUndefined();
    expect(bobFiche?.phone).toBeUndefined();
  });
});

describe("PWA-S7 recordCheckoutContact — auth gate (Unauthenticated / Forbidden)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    await expect(
      t.mutation(api.lib.customer.checkoutContact.recordCheckoutContact, {
        tenantId: seed.tenantA.tenantId,
        ...FIXTURE_CONTACT,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — customer wrapper is customers only", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.customer.checkoutContact.recordCheckoutContact, {
          tenantId: seed.tenantA.tenantId,
          ...FIXTURE_CONTACT,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("PWA-S7 recordCheckoutContact — cross-tenant fuzz (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("rejects unauthorized GLOBAL actors (kb_admin + anonymous) on the customer-self surface", async () => {
    // The customer wrapper accepts ONLY a `customer` role; the cross-tenant
    // fuzz harness pins that no GLOBAL non-customer actor leaks through.
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.checkoutContact.recordCheckoutContact],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      extraArgs: FIXTURE_CONTACT,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
    });
    expect(pairs).toBe(2);
    expect(leaks).toEqual([]);
  });
});
