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
import { marketingEligible } from "./consent";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/customer/, so normalise every relative key to be relative to the
// convex root (../../) so convex-test's findModulesRoot has ONE common prefix
// (same shape as the identity / tenancy suites).
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
 * 2.1-C — Consent at click-Payer + opt-out marketing + marketingEligible, written
 * BEFORE the implementation (TDD red).
 *
 * Surface (`lib/customer/consent`):
 *  - `recordConsentAtCheckout` (self, via `customerMutation`) — stamps
 *    `cgvAcceptedAt` + the `cgvVersionHash` of the ACTIVE CGV version (ADR 0007,
 *    no checkbox).
 *  - `optOutMarketing` (self, via `customerMutation`) — stamps
 *    `marketingOptOutDate`. Transactional opt-out stays impossible (contractual
 *    basis).
 *  - `marketingEligible(customer)` — PURE business fn (ADR 0005, re-consent par
 *    achat): `cgvAcceptedAt IS NOT NULL AND (marketingOptOutDate IS NULL OR
 *    lastCheckoutAt > marketingOptOutDate)`.
 *
 * Identity flows ONLY through `getCurrentActor` (ADR 0011); the GLOBAL `customers`
 * table is reached ONLY through the sanctioned tenancy seam (`customerFiche`),
 * never raw `ctx.db` in this business module (ADR 0010 / `no-untenanted-query`).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** A FIXTURE CGV wording — the REAL legal text (Q90-Q1) is deferred to legal and
 * injected later via `publishCgvVersion`; tests must never invent it. */
const FIXTURE_WORDING =
  "FIXTURE — En cliquant sur Payer, tu acceptes les CGV. Ta prochaine commande vaut nouvelle acceptation.";

/** Seed an anonymous customer (the shape the Anonymous provider produces). */
async function seedAnonymousCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { role: "customer", isAnonymous: true }),
  );
}

/** Provision a fiche for `userId` and return its customers id. */
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

/** Publish a CGV version (root) and return the active version's hash. */
async function publishFixtureCgv(
  t: ReturnType<typeof convexTest>,
  adminId: Id<"users">,
  wording = FIXTURE_WORDING,
): Promise<string> {
  return t
    .withIdentity({ subject: adminId })
    .mutation(api.lib.customer.cgv.publishCgvVersion, { wording });
}

// ---------------------------------------------------------------------------
// marketingEligible — pure business fn (ADR 0005). No Convex pipeline.
// ---------------------------------------------------------------------------

describe("2.1-C marketingEligible — pure re-consent-by-purchase rule (ADR 0005)", () => {
  it("false when CGV never accepted (cgvAcceptedAt missing)", () => {
    expect(marketingEligible({})).toBe(false);
    expect(marketingEligible({ marketingOptOutDate: undefined })).toBe(false);
  });

  it("true when CGV accepted and never opted out", () => {
    expect(marketingEligible({ cgvAcceptedAt: 1000 })).toBe(true);
  });

  it("false after opt-out with no later checkout", () => {
    expect(
      marketingEligible({
        cgvAcceptedAt: 1000,
        marketingOptOutDate: 2000,
      }),
    ).toBe(false);
  });

  it("false after opt-out when last checkout is BEFORE the opt-out", () => {
    expect(
      marketingEligible({
        cgvAcceptedAt: 1000,
        marketingOptOutDate: 2000,
        lastCheckoutAt: 1500,
      }),
    ).toBe(false);
  });

  it("re-eligible: opt-out then a LATER checkout (lastCheckoutAt > optOut)", () => {
    // The ADR 0005 pattern: unsubscribe, then re-order → automatically re-opted-in.
    expect(
      marketingEligible({
        cgvAcceptedAt: 1000,
        marketingOptOutDate: 2000,
        lastCheckoutAt: 3000,
      }),
    ).toBe(true);
  });

  it("NOT re-eligible on exact equality (strict >, not >=)", () => {
    expect(
      marketingEligible({
        cgvAcceptedAt: 1000,
        marketingOptOutDate: 2000,
        lastCheckoutAt: 2000,
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recordConsentAtCheckout — self, stamps cgvAcceptedAt + active hash.
// ---------------------------------------------------------------------------

describe("2.1-C recordConsentAtCheckout — stamps consent of the ACTIVE version", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("stamps cgvAcceptedAt (timestamp) + the active cgvVersionHash on the OWN fiche", async () => {
    const hash = await publishFixtureCgv(t, seed.adminId);
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);

    const before = Date.now();
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.consent.recordConsentAtCheckout, {
        tenantId: seed.tenantA.tenantId,
      });

    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    expect(typeof fiche?.cgvAcceptedAt).toBe("number");
    expect(fiche?.cgvAcceptedAt).toBeGreaterThanOrEqual(before);
    expect(fiche?.cgvVersionHash).toBe(hash);
  });

  it("provisions the fiche on the fly if the customer has none yet", async () => {
    await publishFixtureCgv(t, seed.adminId);
    const userId = await seedAnonymousCustomer(t);
    // No prior getOrCreateCurrentCustomer call.
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.consent.recordConsentAtCheckout, {
        tenantId: seed.tenantA.tenantId,
      });
    const fiche = await t.run((ctx) =>
      ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(typeof fiche?.cgvAcceptedAt).toBe("number");
    expect(fiche?.userId).toBe(userId);
  });

  it("re-stamps the CURRENT active hash on a later checkout (re-consent by purchase)", async () => {
    const h1 = await publishFixtureCgv(
      t,
      seed.adminId,
      `${FIXTURE_WORDING} v1`,
    );
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.consent.recordConsentAtCheckout, {
        tenantId: seed.tenantA.tenantId,
      });
    expect((await t.run((c) => c.db.get(customerId)))?.cgvVersionHash).toBe(h1);

    // KB publishes a new version; the customer checks out again.
    const h2 = await publishFixtureCgv(
      t,
      seed.adminId,
      `${FIXTURE_WORDING} v2`,
    );
    expect(h2).not.toBe(h1);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.consent.recordConsentAtCheckout, {
        tenantId: seed.tenantA.tenantId,
      });
    expect((await t.run((c) => c.db.get(customerId)))?.cgvVersionHash).toBe(h2);
  });

  it("throws when no active CGV version exists (can't stamp an unknown version)", async () => {
    const userId = await seedAnonymousCustomer(t);
    await provision(t, userId, seed.tenantA.tenantId);
    await expect(
      t
        .withIdentity({ subject: userId })
        .mutation(api.lib.customer.consent.recordConsentAtCheckout, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/active.*cgv|cgv.*active/i);
  });
});

// ---------------------------------------------------------------------------
// optOutMarketing — self, stamps marketingOptOutDate.
// ---------------------------------------------------------------------------

describe("2.1-C optOutMarketing — global opt-out stamps marketingOptOutDate", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("stamps marketingOptOutDate on the OWN fiche", async () => {
    await publishFixtureCgv(t, seed.adminId);
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.consent.recordConsentAtCheckout, {
        tenantId: seed.tenantA.tenantId,
      });

    const before = Date.now();
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.consent.optOutMarketing, {
        tenantId: seed.tenantA.tenantId,
      });

    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    expect(typeof fiche?.marketingOptOutDate).toBe("number");
    expect(fiche?.marketingOptOutDate).toBeGreaterThanOrEqual(before);
    // Consent itself is untouched — opt-out is marketing-only, not transactional.
    expect(typeof fiche?.cgvAcceptedAt).toBe("number");
  });

  it("makes the customer marketing-ineligible until a later checkout re-consents", async () => {
    await publishFixtureCgv(t, seed.adminId);
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.consent.recordConsentAtCheckout, {
        tenantId: seed.tenantA.tenantId,
      });
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.consent.optOutMarketing, {
        tenantId: seed.tenantA.tenantId,
      });

    // After opt-out (no later checkout) → ineligible.
    const afterOptOut = await t.run((ctx) => ctx.db.get(customerId));
    expect(marketingEligible(afterOptOut ?? {})).toBe(false);
  });

  it("provisions the fiche on the fly if the customer has none yet", async () => {
    const userId = await seedAnonymousCustomer(t);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.consent.optOutMarketing, {
        tenantId: seed.tenantA.tenantId,
      });
    const fiche = await t.run((ctx) =>
      ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(typeof fiche?.marketingOptOutDate).toBe("number");
  });
});

// ---------------------------------------------------------------------------
// Auth gate + self-scope on the consent surface.
// ---------------------------------------------------------------------------

describe("2.1-C auth gate — consent wrappers (Unauthenticated / Forbidden / self-scope)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await publishFixtureCgv(t, seed.adminId);
  });

  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    await expect(
      t.mutation(api.lib.customer.consent.recordConsentAtCheckout, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — consent surface is customers only", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.customer.consent.recordConsentAtCheckout, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("self-scope: opt-out by Bob never touches Alice's fiche", async () => {
    const alice = await seedAnonymousCustomer(t);
    const bob = await seedAnonymousCustomer(t);
    const aliceFiche = await provision(t, alice, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: alice })
      .mutation(api.lib.customer.consent.recordConsentAtCheckout, {
        tenantId: seed.tenantA.tenantId,
      });

    await t
      .withIdentity({ subject: bob })
      .mutation(api.lib.customer.consent.optOutMarketing, {
        tenantId: seed.tenantA.tenantId,
      });

    // Alice's fiche is untouched by Bob's opt-out.
    expect(
      (await t.run((ctx) => ctx.db.get(aliceFiche)))?.marketingOptOutDate,
    ).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz — replay every exported consent fn with unauthorized actors.
// ---------------------------------------------------------------------------

describe("2.1-C cross-tenant fuzz — consent surface rejects unauthorized actors", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await publishFixtureCgv(t, seed.adminId);
  });

  it("the global root (kb_admin) is rejected by every consent mutation", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.customer.consent.recordConsentAtCheckout,
        api.lib.customer.consent.optOutMarketing,
      ],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
    });
    expect(pairs).toBe(4);
    expect(leaks).toEqual([]);
  });
});
