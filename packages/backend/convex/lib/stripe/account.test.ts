import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/stripe/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.5-A — Stripe Connect onboarding ROOT surface (KB Admin). Written BEFORE the
 * implementation (TDD red). `loadTenantForStripe` (read) + `stampStripeAccount`
 * (write) are `kbAdminQuery` / `kbAdminMutation`: ROOT ONLY, the mutation
 * auto-audited. Ships the mandatory cross-tenant fuzz suite (ADR 0010): every
 * exported root function replayed under every NON-root actor must throw.
 *
 * The `createStripeAccountLink` action's happy path makes real Stripe network
 * calls (out of scope for unit tests); we assert its access gate — a non-root
 * caller is refused BEFORE any Stripe call.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("2.5-A stripe account root surface — kb_admin only + audited", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("a kb_admin stamps the connected account + initial pending status", async () => {
    const asRoot = t.withIdentity({ subject: seed.adminId });
    await asRoot.mutation(api.lib.stripe.account.stampStripeAccount, {
      tenantId: seed.tenantA.tenantId,
      stripeAccountId: "acct_root_stamp",
    });
    const tenant = await t.run(
      async (ctx) => await ctx.db.get(seed.tenantA.tenantId),
    );
    expect(tenant?.stripeAccountId).toBe("acct_root_stamp");
    expect(tenant?.stripeStatus).toBe("pending");
  });

  it("the stamp writes an audit row (kbAdminMutation auto-audits)", async () => {
    const asRoot = t.withIdentity({ subject: seed.adminId });
    await asRoot.mutation(api.lib.stripe.account.stampStripeAccount, {
      tenantId: seed.tenantA.tenantId,
      stripeAccountId: "acct_audit",
    });
    const audits = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "stripe.account.stamp"))
        .collect(),
    );
    expect(audits.length).toBe(1);
    expect(audits[0].tenantId).toBe(seed.tenantA.tenantId);
  });

  it("a kb_manager cannot stamp (root only)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.stripe.account.stampStripeAccount, {
        tenantId: seed.tenantA.tenantId,
        stripeAccountId: "acct_nope",
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("the account-link action refuses a non-root caller before any Stripe call", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.action(api.lib.stripe.account.createStripeAccountLink, {
        tenantId: seed.tenantA.tenantId,
        refreshUrl: "https://x/refresh",
        returnUrl: "https://x/return",
        prefill: {
          siret: "12345678900011",
          email: "resto@x.fr",
        },
      }),
    ).rejects.toThrow(/Forbidden/);
  });
});

/**
 * Defence-in-depth — `createStripeAccountLink` MUST validate
 * `prefill.email` server-side before calling `POST /v1/accounts`. The
 * client UI already disables the submit button on an invalid syntax
 * (commit `e5e6b18`), but the regex is bypassable (curl direct, another
 * client, bot…) and Stripe answers a cryptic 400 « Invalid email
 * address: » that surfaces poorly in the admin Network tab. We therefore
 * mirror the same email regex on the server (defence-in-depth pattern).
 *
 * The validation only fires when we'd actually create a fresh connected
 * account (`accountId === undefined`). On a regen (`account_links` only,
 * no `/accounts` re-write), Stripe doesn't re-read the email — skipping
 * the gate preserves the « Régénérer » UX pinned by `e5e6b18`.
 *
 * The Stripe wire calls are mocked via `global.fetch`: we assert that
 * an invalid email throws BEFORE any fetch fires (the regression we're
 * pinning), and that a valid email lets the flow continue.
 */
describe("2.5-A createStripeAccountLink — server-side email validation", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("throws INVALID_EMAIL on an empty email + does not hit Stripe", async () => {
    fetchSpy = vi.spyOn(global, "fetch");
    const asRoot = t.withIdentity({ subject: seed.adminId });
    await expect(
      asRoot.action(api.lib.stripe.account.createStripeAccountLink, {
        tenantId: seed.tenantA.tenantId,
        refreshUrl: "https://x/refresh",
        returnUrl: "https://x/return",
        prefill: { siret: "12345678900011", email: "" },
      }),
    ).rejects.toThrow(/INVALID_EMAIL|Email invalide/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("throws INVALID_EMAIL on a syntactically invalid email + does not hit Stripe", async () => {
    fetchSpy = vi.spyOn(global, "fetch");
    const asRoot = t.withIdentity({ subject: seed.adminId });
    await expect(
      asRoot.action(api.lib.stripe.account.createStripeAccountLink, {
        tenantId: seed.tenantA.tenantId,
        refreshUrl: "https://x/refresh",
        returnUrl: "https://x/return",
        prefill: { siret: "12345678900011", email: "abc" },
      }),
    ).rejects.toThrow(/INVALID_EMAIL|Email invalide/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("lets a valid email through — Stripe is called and the account stamped", async () => {
    fetchSpy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "acct_valid_email" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ url: "https://stripe/onboard" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

    const asRoot = t.withIdentity({ subject: seed.adminId });
    const res = await asRoot.action(
      api.lib.stripe.account.createStripeAccountLink,
      {
        tenantId: seed.tenantA.tenantId,
        refreshUrl: "https://x/refresh",
        returnUrl: "https://x/return",
        prefill: { siret: "12345678900011", email: "resto@example.com" },
      },
    );
    expect(res.accountId).toBe("acct_valid_email");
    expect(res.url).toBe("https://stripe/onboard");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("regenerate (account already stamped) skips email validation — Stripe is called", async () => {
    // Pre-stamp the tenant so `accountId !== undefined` (regen path).
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, {
        stripeAccountId: "acct_already_here",
        stripeStatus: "pending",
      });
    });
    // Only /account_links should fire (no /accounts re-create).
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ url: "https://stripe/regen" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const asRoot = t.withIdentity({ subject: seed.adminId });
    const res = await asRoot.action(
      api.lib.stripe.account.createStripeAccountLink,
      {
        tenantId: seed.tenantA.tenantId,
        refreshUrl: "https://x/refresh",
        returnUrl: "https://x/return",
        // Empty email — must NOT throw on regen (Stripe doesn't re-read it).
        prefill: { siret: "12345678900011", email: "" },
      },
    );
    expect(res.accountId).toBe("acct_already_here");
    expect(res.url).toBe("https://stripe/regen");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/account_links");
  });
});

describe("2.5-A stripe account root surface — cross-tenant fuzz (ADR 0010)", () => {
  it("every exported root function throws for every non-root actor", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);

    const actors: FuzzActor[] = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "customer", subject: seed.customerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    // Root functions are NOT tenant-scoped via the wrapper (no injected
    // tenantId), but they DO accept a `tenantId` business arg — inject tenant A's
    // so the call is well-formed; the gate must still refuse every non-root actor.
    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.stripe.account.loadTenantForStripe,
        api.lib.stripe.account.stampStripeAccount,
      ],
      isQuery: (fn) => fn === api.lib.stripe.account.loadTenantForStripe,
      tenantId: undefined,
      extraArgs: {
        tenantId: seed.tenantA.tenantId,
        stripeAccountId: "acct_fuzz",
      },
      actors,
    });
    expect(leaks).toEqual([]);
  });
});
