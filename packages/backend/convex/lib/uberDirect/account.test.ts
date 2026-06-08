import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * `probeUberAccount` — Uber Direct admin probe action. Mirror of
 * `probeStripeAccount` tests: pin OAuth + Customers API success / failure /
 * INVALID_STATE / NOT_FOUND / root-only behaviour. Uses the standard
 * `vi.spyOn(global, "fetch")` mock pattern (mirror of `course.test.ts`).
 */

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (key.startsWith("./")) key = `../../lib/uberDirect/${key.slice(2)}`;
    else if (key.startsWith("../") && !key.startsWith("../../"))
      key = `../../lib/${key.slice(3)}`;
    return [key, loader];
  }),
);

const CREDS = {
  clientId: "cl_test_abc",
  clientSecret: "sec_test_xyz",
  customerId: "cust_test_123",
  webhookSigningKey: "whsec_test",
} as const;

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** Mock the OAuth + Customers GET pair (in that order — same as the action). */
function mockUberProbeOk(deliveryCount = 0): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(global, "fetch");
  spy.mockResolvedValueOnce(
    new Response(JSON.stringify({ access_token: "ub_token_abc" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  spy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        data: Array.from({ length: deliveryCount }, (_, i) => ({
          id: `del_${i}`,
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  return spy;
}

function mockUberOAuthFail(): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(global, "fetch");
  spy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        error: "invalid_client",
        error_description: "Client ID or secret invalid",
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ),
  );
  return spy;
}

function mockUberCustomersFail(): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(global, "fetch");
  spy.mockResolvedValueOnce(
    new Response(JSON.stringify({ access_token: "ub_token_abc" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  spy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        error: { message: "Resource not found: customer_id" },
      }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    ),
  );
  return spy;
}

describe("probeUberAccount — Uber Direct admin probe action", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let fetchSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = null;
  });

  it("happy path — credentials saved + OAuth ok + customers ok → returns the full success payload", async () => {
    // Save creds first
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });
    fetchSpy = mockUberProbeOk(2);

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const out = await asAdmin.action(
      api.lib.uberDirect.account.probeUberAccount,
      { tenantId: seed.tenantA.tenantId },
    );

    expect(out.customerId).toBe(CREDS.customerId);
    expect(out.tokenObtained).toBe(true);
    expect(out.customerReachable).toBe(true);
    expect(out.hasWebhookSigningKey).toBe(true);
    expect(out.deliveryCountSample).toBe(2);
  });

  it("hasWebhookSigningKey:false when only the 3 required creds were saved", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: {
          clientId: CREDS.clientId,
          clientSecret: CREDS.clientSecret,
          customerId: CREDS.customerId,
        },
      });
    fetchSpy = mockUberProbeOk(0);

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const out = await asAdmin.action(
      api.lib.uberDirect.account.probeUberAccount,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(out.hasWebhookSigningKey).toBe(false);
    expect(out.deliveryCountSample).toBe(0);
  });

  it("no credentials saved → INVALID_STATE (no fetch attempted)", async () => {
    fetchSpy = vi.spyOn(global, "fetch");
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await expect(
      asAdmin.action(api.lib.uberDirect.account.probeUberAccount, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/INVALID_STATE|credential/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("OAuth rejection → UBER_ERROR surfaced with the upstream error_description", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });
    fetchSpy = mockUberOAuthFail();

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await expect(
      asAdmin.action(api.lib.uberDirect.account.probeUberAccount, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/Uber OAuth error/i);
  });

  it("Customers API rejection → UBER_ERROR surfaced (e.g. 404 wrong customer_id)", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });
    fetchSpy = mockUberCustomersFail();

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await expect(
      asAdmin.action(api.lib.uberDirect.account.probeUberAccount, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/Uber Customers API error/i);
  });

  it("NOT_FOUND when tenant row was deleted between auth + load", async () => {
    fetchSpy = vi.spyOn(global, "fetch");
    // Stale-but-valid Id<"tenants"> : take the seeded tenantA id and delete
    // the row beneath it (the `loadTenantForUber` query then returns null).
    const staleId = seed.tenantA.tenantId;
    await t.run((ctx) => ctx.db.delete(staleId));

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await expect(
      asAdmin.action(api.lib.uberDirect.account.probeUberAccount, {
        tenantId: staleId,
      }),
    ).rejects.toThrow(/NOT_FOUND|not found/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("non-root caller (kb_manager) → FORBIDDEN (root-only via loadTenantForUber)", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });
    fetchSpy = vi.spyOn(global, "fetch");

    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asMgr.action(api.lib.uberDirect.account.probeUberAccount, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
