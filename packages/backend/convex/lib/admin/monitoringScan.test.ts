import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../../_generated/api";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required
// (project memory). Normalise every key relative to the convex root.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/admin/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.9-F — the Convex WIRING of the monitoring scan (PRD 70 §3.8): the root-only
 * `previewIncidents` query (reads the live data through the tenancy store seams
 * and runs the pure detectors) and the `runMonitoringScan` ops action (scan →
 * Slack post). Written BEFORE the implementation (TDD red).
 *
 * Isolation: `previewIncidents` is KB-ADMIN-GLOBAL ops data, root-only
 * (`kbAdminQuery`) — every non-root actor is refused (root-only fuzz, ADR 0010).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const HOUR = 60 * 60 * 1000;

async function seedStaleKycProspect(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const now = Date.now();
    return ctx.db.insert("prospects", {
      name: "Stale KYC Resto",
      phone: "0612345678",
      phase: "preparation",
      source: "cold_call",
      milestones: {
        stripeConnect: {
          current: "pending_kyc",
          history: [{ status: "pending_kyc", at: now - 72 * HOUR }],
        },
      },
      createdAt: now,
      updatedAt: now,
    });
  });
}

describe("2.9-F previewIncidents — root reads live incidents", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("surfaces a tenant whose KYC has been pending > 48 h", async () => {
    await seedStaleKycProspect(t);
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const incidents = await asAdmin.query(
      api.lib.admin.monitoring.previewIncidents,
      {},
    );
    const kyc = incidents.filter((i) => i.kind === "kyc_pending");
    expect(kyc).toHaveLength(1);
    expect(kyc[0]).toMatchObject({ kind: "kyc_pending", provider: "stripe" });
  });

  it("returns no incidents when the pipeline is healthy", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const incidents = await asAdmin.query(
      api.lib.admin.monitoring.previewIncidents,
      {},
    );
    expect(incidents).toEqual([]);
  });

  it("#415 surfaces a tenant exceeding the auto_expired/24h threshold", async () => {
    // Seed 4 auto_expired orders on tenant A within the last 24 h — > 3
    // = ops burst. tenantB stays at 0 so the report cleanly isolates A.
    const tenantA = seed.tenantA.tenantId;
    const recent = Date.now() - 60 * 60 * 1000; // 1 h ago
    await t.run(async (ctx) => {
      const customerId = await ctx.db.insert("customers", {
        userId: seed.customerId,
        createdAt: recent,
      });
      for (let i = 0; i < 4; i += 1) {
        await ctx.db.insert("orders", {
          tenantId: tenantA,
          customerId,
          status: "auto_expired",
          mode: "delivery",
          source: "direct",
          createdAt: recent - i * 5 * 60 * 1000,
          autoExpiredAt: recent - i * 5 * 60 * 1000,
        });
      }
    });
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const incidents = await asAdmin.query(
      api.lib.admin.monitoring.previewIncidents,
      {},
    );
    const bursts = incidents.filter((i) => i.kind === "auto_expired_burst");
    expect(bursts).toHaveLength(1);
    expect(bursts[0]).toMatchObject({
      kind: "auto_expired_burst",
      tenantId: tenantA,
      count: 4,
    });
  });
});

describe("2.9-F previewIncidents root-only fuzz — kb_admin gated", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("no non-root actor can read the monitoring incidents", async () => {
    const queries = [api.lib.admin.monitoring.previewIncidents];
    const actors = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: queries,
      isQuery: () => true,
      tenantId: undefined,
      actors,
    });
    expect(pairs).toBe(queries.length * actors.length);
    expect(leaks).toEqual([]);
  });
});

describe("2.9-F runMonitoringScan — scan → Slack ops alert", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    await seedTwoTenantsAllRoles(t);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("posts one Slack alert per incident when a webhook URL is configured", async () => {
    await seedStaleKycProspect(t);
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_OPS_WEBHOOK_URL", "https://hooks.slack.test/xyz");

    const posted = await t.action(
      internal.lib.admin.monitoring.runMonitoringScan,
      {},
    );

    expect(posted).toBeGreaterThanOrEqual(1);
    expect(fetchMock).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://hooks.slack.test/xyz");
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toContain("KYC");
  });

  it("posts nothing (and does not call Slack) when there are no incidents", async () => {
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_OPS_WEBHOOK_URL", "https://hooks.slack.test/xyz");

    const posted = await t.action(
      internal.lib.admin.monitoring.runMonitoringScan,
      {},
    );

    expect(posted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("no-ops (no throw, no fetch) when the Slack webhook URL is not configured", async () => {
    await seedStaleKycProspect(t);
    const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("SLACK_OPS_WEBHOOK_URL", "");

    const posted = await t.action(
      internal.lib.admin.monitoring.runMonitoringScan,
      {},
    );

    expect(posted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
