import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * 2.7-D — `sendCampaign` marketing, written BEFORE the module (TDD red).
 *
 * The MOAT branch of the moteur. Two scopes (PRD 80 §2 / ADR 0006):
 *  - TENANT     : a `kb_manager` fires a pre-validated `notificationTemplate` to
 *    its OWN clients. Cascade Web Push > Wallet > Email. The resto NEVER sees a
 *    recipient identity — `sendCampaign` returns ONLY aggregate counters.
 *  - CROSS-TENANT : ONLY a `kb_admin` (KB proxy) fires it — free content, cascade
 *    Wallet > Email (web-push excluded). KB sends on the resto's behalf; no raw
 *    customer ever reaches a `kb_manager`.
 *
 * Guardrails enforced + tested here: marketingEligible (ADR 0005), rate-limit
 * 3/sem GLOBAL, DNT 22h-8h → queue, anti-anomaly (freq + recipient surge),
 * template bounds (tenant), MOAT (no nominative recipient to kb_manager), and the
 * cross-tenant fuzz (ADR 0010).
 */

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (path.startsWith("./")) {
      key = `../../lib/notifications/${path.slice(2)}`;
    } else if (path.startsWith("../") && !path.startsWith("../../")) {
      key = `../../lib/${path.slice(3)}`;
    }
    return [key, loader];
  }),
);

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const DAY = 24 * 60 * 60 * 1000;
// A daytime instant (13:00 Paris) so DNT does not interfere unless asked.
const DAYTIME = Date.UTC(2026, 0, 15, 12, 0);
// A 22:30-Paris instant (winter) — inside the DNT window.
const NIGHT = Date.UTC(2026, 0, 15, 21, 30);

/** Insert a marketing-eligible, reachable customer + link it to a tenant. */
async function seedTenantCustomer(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  opts: {
    email?: string;
    walletPush?: boolean;
    webPush?: boolean;
    eligible?: boolean;
    optOutDate?: number;
    lastCheckoutAt?: number;
  } = {},
): Promise<Id<"customers">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      email: opts.email ?? "eater@x.fr",
      role: "customer",
    });
    const eligible = opts.eligible ?? true;
    const customerId = await ctx.db.insert("customers", {
      userId,
      email: opts.email ?? "eater@x.fr",
      phone: "+33600000000",
      pushEnrollment: {
        walletStatus: (opts.walletPush ?? true) ? "enrolled" : "not_enrolled",
        webPushStatus: (opts.webPush ?? true) ? "enrolled" : "not_enrolled",
      },
      // marketingEligible needs cgvAcceptedAt set + not opted-out.
      cgvAcceptedAt: eligible ? DAYTIME - 30 * DAY : undefined,
      marketingOptOutDate: opts.optOutDate,
      lastCheckoutAt: opts.lastCheckoutAt,
      createdAt: DAYTIME - 60 * DAY,
    });
    await ctx.db.insert("customerOrdersPerTenant", {
      customerId,
      tenantId,
      totalOrders: 3,
      lastOrderAt: DAYTIME - 10 * DAY,
      ltv: 80,
    });
    return customerId;
  });
}

/** Publish a valid pre-validated tenant template; returns its id. */
async function seedTemplate(
  t: ReturnType<typeof convexTest>,
  overrides: Record<string, unknown> = {},
): Promise<Id<"notificationTemplates">> {
  return t.run((ctx) =>
    ctx.db.insert("notificationTemplates", {
      key: "promo_weekend",
      label: "Promo weekend",
      body: "Bonjour {prenom_client}, -{discount}% chez {nom_resto} ce weekend !",
      variables: ["prenom_client", "discount", "nom_resto"],
      deepLinkTarget: "catalogue",
      scope: "tenant",
      maxDiscountPercent: 20,
      language: "fr",
      containsAlcohol: false,
      active: true,
      createdAt: DAYTIME,
      ...overrides,
    }),
  );
}

describe("2.7-D sendTenantCampaign — kb_manager, pre-validated template", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let templateId: Id<"notificationTemplates">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    templateId = await seedTemplate(t);
  });

  it("journals one campaign send per eligible+reachable customer, returns counts only", async () => {
    await seedTenantCustomer(t, seed.tenantA.tenantId, { email: "a1@x.fr" });
    await seedTenantCustomer(t, seed.tenantA.tenantId, { email: "a2@x.fr" });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const result = await asManager.mutation(
      api.lib.notifications.campaigns.sendTenantCampaign,
      {
        tenantId: seed.tenantA.tenantId,
        templateId,
        variables: { discount: "20" },
        now: DAYTIME,
      },
    );
    // MOAT: the payload is aggregate counters ONLY — no array of customers.
    expect(result.targeted).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.queued).toBe(0);
    expect(result).not.toHaveProperty("recipients");
    expect(result).not.toHaveProperty("customers");

    const rows = await t.run((ctx) =>
      ctx.db
        .query("notificationEvents")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .collect(),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.kind === "campaign")).toBe(true);
    expect(rows.every((r) => r.campaignScope === "tenant")).toBe(true);
    expect(rows.every((r) => r.templateId === templateId)).toBe(true);
    // Tenant cascade prefers Web Push.
    expect(rows.every((r) => r.channel === "web_push")).toBe(true);
  });

  it("falls back down the tenant cascade (Web Push > Wallet > Email)", async () => {
    await seedTenantCustomer(t, seed.tenantA.tenantId, {
      email: "wallet@x.fr",
      webPush: false, // no web push → wallet
    });
    await seedTenantCustomer(t, seed.tenantA.tenantId, {
      email: "mail@x.fr",
      webPush: false,
      walletPush: false, // no push at all → email
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(
      api.lib.notifications.campaigns.sendTenantCampaign,
      {
        tenantId: seed.tenantA.tenantId,
        templateId,
        variables: { discount: "20" },
        now: DAYTIME,
      },
    );
    const channels = await t.run((ctx) =>
      ctx.db
        .query("notificationEvents")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .collect()
        .then((r) => r.map((x) => x.channel).sort()),
    );
    expect(channels).toEqual(["email", "wallet_push"]);
  });

  it("skips opted-out (marketing-ineligible) customers", async () => {
    await seedTenantCustomer(t, seed.tenantA.tenantId, {
      email: "out@x.fr",
      eligible: true,
      optOutDate: DAYTIME - 1 * DAY, // opted out, no later checkout ⇒ ineligible
    });
    await seedTenantCustomer(t, seed.tenantA.tenantId, { email: "in@x.fr" });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const result = await asManager.mutation(
      api.lib.notifications.campaigns.sendTenantCampaign,
      {
        tenantId: seed.tenantA.tenantId,
        templateId,
        variables: { discount: "20" },
        now: DAYTIME,
      },
    );
    expect(result.targeted).toBe(1);
    expect(result.skippedIneligible).toBe(1);
  });

  it("re-includes a customer who re-consented by a later checkout (ADR 0005)", async () => {
    await seedTenantCustomer(t, seed.tenantA.tenantId, {
      email: "recon@x.fr",
      optOutDate: DAYTIME - 5 * DAY,
      lastCheckoutAt: DAYTIME - 1 * DAY, // checkout AFTER opt-out ⇒ re-eligible
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const result = await asManager.mutation(
      api.lib.notifications.campaigns.sendTenantCampaign,
      {
        tenantId: seed.tenantA.tenantId,
        templateId,
        variables: { discount: "20" },
        now: DAYTIME,
      },
    );
    expect(result.targeted).toBe(1);
    expect(result.sent).toBe(1);
  });

  it("blocks the 4th marketing send of the week per customer (global rate limit)", async () => {
    const customerId = await seedTenantCustomer(t, seed.tenantA.tenantId, {
      email: "rl@x.fr",
    });
    // Seed 3 prior campaign sends within the week (mix of tenants = global).
    await t.run(async (ctx) => {
      for (const [i, tid] of [
        seed.tenantA.tenantId,
        seed.tenantB.tenantId,
        seed.tenantA.tenantId,
      ].entries()) {
        await ctx.db.insert("notificationEvents", {
          tenantId: tid,
          customerId,
          kind: "campaign",
          campaignScope: "tenant",
          channel: "web_push",
          status: "sent",
          createdAt: DAYTIME - (i + 1) * DAY,
        });
      }
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const result = await asManager.mutation(
      api.lib.notifications.campaigns.sendTenantCampaign,
      {
        tenantId: seed.tenantA.tenantId,
        templateId,
        variables: { discount: "20" },
        now: DAYTIME,
      },
    );
    // The customer already hit 3/week ⇒ the 4th is rate-limited (skipped, not
    // targeted, not sent).
    expect(result.targeted).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.skippedRateLimited).toBe(1);
  });

  it("queues sends for delivery at 8h when launched inside the DNT window", async () => {
    await seedTenantCustomer(t, seed.tenantA.tenantId, { email: "dnt@x.fr" });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const result = await asManager.mutation(
      api.lib.notifications.campaigns.sendTenantCampaign,
      {
        tenantId: seed.tenantA.tenantId,
        templateId,
        variables: { discount: "20" },
        now: NIGHT,
      },
    );
    expect(result.targeted).toBe(1);
    expect(result.queued).toBe(1);
    expect(result.sent).toBe(0);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("notificationEvents")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .collect(),
    );
    expect(rows[0].status).toBe("queued");
  });

  it("rejects a template whose rendered content violates the bounds (discount > 50)", async () => {
    await seedTenantCustomer(t, seed.tenantA.tenantId, { email: "b@x.fr" });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.notifications.campaigns.sendTenantCampaign, {
        tenantId: seed.tenantA.tenantId,
        templateId,
        variables: { discount: "80" }, // 80% > 50% cap
        now: DAYTIME,
      }),
    ).rejects.toThrow(/DISCOUNT_TOO_HIGH|bound|discount/i);
  });

  it("blocks a 2nd campaign within 48h (anti-anomaly freq) + audits it", async () => {
    await seedTenantCustomer(t, seed.tenantA.tenantId, { email: "f@x.fr" });
    // A prior campaign LAUNCH 12h ago for THIS tenant (the anomaly history).
    await t.run((ctx) =>
      ctx.db.insert("campaignLaunches", {
        tenantId: seed.tenantA.tenantId,
        scope: "tenant",
        launchedAt: DAYTIME - 12 * 60 * 60 * 1000,
        recipients: 1,
      }),
    );
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManager.mutation(api.lib.notifications.campaigns.sendTenantCampaign, {
        tenantId: seed.tenantA.tenantId,
        templateId,
        variables: { discount: "20" },
        now: DAYTIME,
      }),
    ).rejects.toThrow(/anomaly|TOO_FREQUENT|frequen/i);
  });

  it("cannot run a tenant campaign for a foreign tenant (wrapper Forbidden)", async () => {
    const asManagerA = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManagerA.mutation(api.lib.notifications.campaigns.sendTenantCampaign, {
        tenantId: seed.tenantB.tenantId,
        templateId,
        variables: { discount: "20" },
        now: DAYTIME,
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("MOAT: a kb_manager cannot use a cross-tenant campaign to learn other tenants' customers", async () => {
    // Tenant B has customers; tenant A's manager must NOT be able to fire the
    // cross-tenant (KB proxy) campaign at all — it is kb_admin-only.
    await seedTenantCustomer(t, seed.tenantB.tenantId, {
      email: "secret@x.fr",
    });
    const asManagerA = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asManagerA.mutation(
        api.lib.notifications.campaigns.sendCrossTenantCampaign,
        {
          tenantId: seed.tenantB.tenantId,
          body: "Nouveau resto près de chez toi !",
          now: DAYTIME,
        },
      ),
    ).rejects.toThrow(/Forbidden|kb_admin/);
  });
});

describe("2.7-D sendCrossTenantCampaign — kb_admin proxy only", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("KB root fires a free-content campaign across tenants, Wallet > Email cascade, counts only", async () => {
    // One customer linked to tenant A, another to tenant B; both wallet-enrolled.
    await seedTenantCustomer(t, seed.tenantA.tenantId, { email: "x1@x.fr" });
    await seedTenantCustomer(t, seed.tenantB.tenantId, { email: "x2@x.fr" });
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const result = await asAdmin.mutation(
      api.lib.notifications.campaigns.sendCrossTenantCampaign,
      {
        tenantId: seed.tenantA.tenantId,
        body: "Offre réseau KB",
        now: DAYTIME,
      },
    );
    expect(result.sent).toBeGreaterThanOrEqual(1);
    expect(result).not.toHaveProperty("recipients");
    const rows = await t.run((ctx) =>
      ctx.db.query("notificationEvents").collect(),
    );
    expect(rows.every((r) => r.kind === "campaign")).toBe(true);
    expect(rows.every((r) => r.campaignScope === "cross_tenant")).toBe(true);
    // Cross-tenant cascade: Wallet first, Email fallback — NEVER web_push.
    expect(rows.every((r) => r.channel !== "web_push")).toBe(true);
  });
});

describe("2.7-D sendCampaign — cross-tenant fuzz (ADR 0010)", () => {
  it("tenant campaign throws for every unauthorized actor", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const templateId = await seedTemplate(t);
    await seedTenantCustomer(t, seed.tenantA.tenantId, { email: "z@x.fr" });
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.notifications.campaigns.sendTenantCampaign],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      extraArgs: { templateId, variables: { discount: "20" }, now: DAYTIME },
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(leaks).toEqual([]);
    expect(pairs).toBe(5);
  });

  it("cross-tenant campaign throws for every non-root actor (kb_admin-only)", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.notifications.campaigns.sendCrossTenantCampaign],
      isQuery: () => false,
      tenantId: undefined,
      extraArgs: { body: "x", now: DAYTIME },
      actors: [
        { label: "A-manager", subject: seed.tenantA.managerId },
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "staff", subject: seed.tenantA.staffId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(leaks).toEqual([]);
    expect(pairs).toBe(5);
  });
});
