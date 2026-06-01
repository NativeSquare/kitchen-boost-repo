import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * F-CAMPAGNES [6/7] (#240) — `listTenantCampaignLaunches` + `getTenantCampaignLaunch`,
 * the two PUBLIC `tenantQuery` wrappers backing the « historique des lancements »
 * sub-route under `/t/[tenantId]/campagnes/historique/` (parent EPIC #145).
 *
 * Both queries return aggregate-only payloads — the MOAT (ADR 0010 / PRD 90 §3-§5)
 * forbids any nominative recipient surface. Each launch row carries:
 *   - id + launchedAt + scope
 *   - templateId + templateLabel (resolved server-side for the list UI; label only,
 *     no body — the body is per-launch data the front already had at send time)
 *   - the 6 `CampaignResult` counters: targeted, sent, queued, skippedIneligible,
 *     skippedRateLimited, skippedUnreachable
 *
 * Legacy rows (inserted before #240 added the 6 counters + templateId to the schema)
 * fall back to zeroes for the missing counters and `null` for the missing template
 * label — they pre-date the new persistence contract; the front renders zeroes
 * rather than crashing.
 *
 * Strict allowlist `kb_manager` (+ root `kb_admin` override inherited from the
 * wrapper), cross-tenant fuzz pin, tri par date desc on the list.
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

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

async function insertTemplate(
  t: ReturnType<typeof convexTest>,
  overrides: Partial<{
    key: string;
    label: string;
    tenantId: Id<"tenants"> | undefined;
  }> = {},
): Promise<Id<"notificationTemplates">> {
  return t.run((ctx) => {
    const { tenantId, ...rest } = overrides;
    const row: Record<string, unknown> = {
      key: rest.key ?? "promo_weekend",
      label: rest.label ?? "Promo weekend",
      body: "Bonjour {prenom_client}, -{discount}% chez {nom_resto} ce weekend !",
      variables: ["prenom_client", "discount", "nom_resto"],
      deepLinkTarget: "catalogue",
      scope: "tenant",
      maxDiscountPercent: 20,
      language: "fr",
      containsAlcohol: false,
      active: true,
      createdAt: NOW,
    };
    if (tenantId !== undefined) row.tenantId = tenantId;
    return ctx.db.insert(
      "notificationTemplates",
      row as Parameters<typeof ctx.db.insert<"notificationTemplates">>[1],
    );
  });
}

type LaunchOverrides = Partial<{
  scope: "tenant" | "cross_tenant";
  templateId: Id<"notificationTemplates">;
  launchedAt: number;
  recipients: number;
  sent: number;
  queued: number;
  skippedIneligible: number;
  skippedRateLimited: number;
  skippedUnreachable: number;
}>;

async function insertLaunch(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  overrides: LaunchOverrides = {},
): Promise<Id<"campaignLaunches">> {
  return t.run((ctx) => {
    const row: Record<string, unknown> = {
      tenantId,
      scope: overrides.scope ?? "tenant",
      launchedAt: overrides.launchedAt ?? NOW,
      recipients: overrides.recipients ?? 0,
    };
    if (overrides.templateId !== undefined)
      row.templateId = overrides.templateId;
    if (overrides.sent !== undefined) row.sent = overrides.sent;
    if (overrides.queued !== undefined) row.queued = overrides.queued;
    if (overrides.skippedIneligible !== undefined)
      row.skippedIneligible = overrides.skippedIneligible;
    if (overrides.skippedRateLimited !== undefined)
      row.skippedRateLimited = overrides.skippedRateLimited;
    if (overrides.skippedUnreachable !== undefined)
      row.skippedUnreachable = overrides.skippedUnreachable;
    return ctx.db.insert(
      "campaignLaunches",
      row as Parameters<typeof ctx.db.insert<"campaignLaunches">>[1],
    );
  });
}

describe("F-CAMPAGNES [6/7] listTenantCampaignLaunches — public tenantQuery", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns [] (no throw) when the tenant has no campaign launch", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantCampaignLaunches,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got).toEqual([]);
  });

  it("returns one entry per launch, sorted by launchedAt desc", async () => {
    const oldest = await insertLaunch(t, seed.tenantA.tenantId, {
      launchedAt: NOW - 5 * HOUR,
    });
    const newest = await insertLaunch(t, seed.tenantA.tenantId, {
      launchedAt: NOW,
    });
    const middle = await insertLaunch(t, seed.tenantA.tenantId, {
      launchedAt: NOW - 2 * HOUR,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantCampaignLaunches,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got.map((l) => l.id)).toEqual([newest, middle, oldest]);
  });

  it("projects each row to the documented shape: id, scope, launchedAt, templateId, templateLabel, 6 counters", async () => {
    const tplId = await insertTemplate(t, {
      key: "weekend",
      label: "Promo weekend",
      tenantId: seed.tenantA.tenantId,
    });
    await insertLaunch(t, seed.tenantA.tenantId, {
      templateId: tplId,
      recipients: 10,
      sent: 7,
      queued: 1,
      skippedIneligible: 1,
      skippedRateLimited: 1,
      skippedUnreachable: 0,
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantCampaignLaunches,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got).toHaveLength(1);
    const row = got[0];
    expect(typeof row.id).toBe("string");
    expect(row.scope).toBe("tenant");
    expect(row.launchedAt).toBe(NOW);
    expect(row.templateId).toBe(tplId);
    expect(row.templateLabel).toBe("Promo weekend");
    expect(row.targeted).toBe(10);
    expect(row.sent).toBe(7);
    expect(row.queued).toBe(1);
    expect(row.skippedIneligible).toBe(1);
    expect(row.skippedRateLimited).toBe(1);
    expect(row.skippedUnreachable).toBe(0);
  });

  it("legacy rows (no templateId, no per-counter persistence) fall back to zeroes + null label", async () => {
    // Simulate a row written BEFORE #240 added the new optional fields: only the
    // mandatory schema fields are set. The query must not crash and must surface
    // the row with sensible defaults so the « historique » UI is never half-empty.
    await insertLaunch(t, seed.tenantA.tenantId, {
      recipients: 4,
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantCampaignLaunches,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got).toHaveLength(1);
    expect(got[0].templateId).toBeNull();
    expect(got[0].templateLabel).toBeNull();
    expect(got[0].targeted).toBe(4); // recipients is the legacy field
    expect(got[0].sent).toBe(0);
    expect(got[0].queued).toBe(0);
    expect(got[0].skippedIneligible).toBe(0);
    expect(got[0].skippedRateLimited).toBe(0);
    expect(got[0].skippedUnreachable).toBe(0);
  });

  it("never returns a launch belonging to another tenant (cross-tenant isolation)", async () => {
    const aLaunch = await insertLaunch(t, seed.tenantA.tenantId);
    await insertLaunch(t, seed.tenantB.tenantId);
    const asManagerA = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManagerA.query(
      api.lib.notifications.campaigns.listTenantCampaignLaunches,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got.map((l) => l.id)).toEqual([aLaunch]);
  });

  it("rejects callers without kb_manager role on the tenant (cross-tenant fuzz)", async () => {
    await insertLaunch(t, seed.tenantA.tenantId);
    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.notifications.campaigns.listTenantCampaignLaunches],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(leaks).toEqual([]);
  });

  it("kb_admin (root) can call listTenantCampaignLaunches on any tenantId", async () => {
    const aLaunch = await insertLaunch(t, seed.tenantA.tenantId);
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const got = await asAdmin.query(
      api.lib.notifications.campaigns.listTenantCampaignLaunches,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got.map((l) => l.id)).toEqual([aLaunch]);
  });

  it("MOAT — projection NEVER includes a recipient identity (no email/phone/customer field)", async () => {
    const tplId = await insertTemplate(t, {
      tenantId: seed.tenantA.tenantId,
    });
    await insertLaunch(t, seed.tenantA.tenantId, {
      templateId: tplId,
      recipients: 3,
      sent: 3,
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantCampaignLaunches,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got).toHaveLength(1);
    const row = got[0];
    expect(row).not.toHaveProperty("recipientsList");
    expect(row).not.toHaveProperty("customers");
    expect(row).not.toHaveProperty("customerIds");
    expect(row).not.toHaveProperty("email");
    expect(row).not.toHaveProperty("phone");
    // No raw Convex internal cols either.
    expect(row).not.toHaveProperty("_id");
    expect(row).not.toHaveProperty("_creationTime");
  });
});

describe("F-CAMPAGNES [6/7] getTenantCampaignLaunch — public tenantQuery", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns the launch summary for a launchId belonging to the tenant", async () => {
    const tplId = await insertTemplate(t, {
      key: "k",
      label: "Mon template",
      tenantId: seed.tenantA.tenantId,
    });
    const launchId = await insertLaunch(t, seed.tenantA.tenantId, {
      templateId: tplId,
      recipients: 5,
      sent: 4,
      queued: 0,
      skippedIneligible: 1,
      skippedRateLimited: 0,
      skippedUnreachable: 0,
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.getTenantCampaignLaunch,
      { tenantId: seed.tenantA.tenantId, launchId },
    );
    expect(got).not.toBeNull();
    expect(got!.id).toBe(launchId);
    expect(got!.templateId).toBe(tplId);
    expect(got!.templateLabel).toBe("Mon template");
    expect(got!.targeted).toBe(5);
    expect(got!.sent).toBe(4);
    expect(got!.skippedIneligible).toBe(1);
  });

  it("returns null for an unknown launchId (not found, no throw)", async () => {
    // Insert+delete to get a stale id of the right brand.
    const tmpId = await insertLaunch(t, seed.tenantA.tenantId);
    await t.run(async (ctx) => {
      await ctx.db.delete(tmpId);
    });
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.getTenantCampaignLaunch,
      { tenantId: seed.tenantA.tenantId, launchId: tmpId },
    );
    expect(got).toBeNull();
  });

  it("returns null when the launchId belongs to another tenant (no cross-tenant leak)", async () => {
    const bLaunch = await insertLaunch(t, seed.tenantB.tenantId, {
      recipients: 99,
    });
    const asManagerA = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManagerA.query(
      api.lib.notifications.campaigns.getTenantCampaignLaunch,
      { tenantId: seed.tenantA.tenantId, launchId: bLaunch },
    );
    // The wrapper allows A's manager to ASK; the row simply does not belong to
    // A's tenant scope, so the lookup returns null (vs. throwing — same shape as
    // a stale id).
    expect(got).toBeNull();
  });

  it("rejects callers without kb_manager role on the tenant (cross-tenant fuzz)", async () => {
    const launchId = await insertLaunch(t, seed.tenantA.tenantId);
    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.notifications.campaigns.getTenantCampaignLaunch],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      extraArgs: { launchId },
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(leaks).toEqual([]);
  });
});

describe("F-CAMPAGNES [6/7] sendTenantCampaign — persists the 6 counters + templateId on the launch row", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("after sendTenantCampaign, the launch row carries the 6 counters + templateId (for #240 historique)", async () => {
    const templateId = await insertTemplate(t, {
      key: "weekend",
      label: "Weekend",
      tenantId: seed.tenantA.tenantId,
    });
    // 2 eligible+reachable customers, 1 ineligible (opted out, no later checkout).
    const DAY = 24 * 60 * 60 * 1000;
    const DAYTIME = Date.UTC(2026, 0, 15, 12, 0);
    await t.run(async (ctx) => {
      for (const [i, optOut] of [false, false, true].entries()) {
        const userId = await ctx.db.insert("users", {
          email: `c${i}@x.fr`,
          role: "customer",
        });
        const customerId = await ctx.db.insert("customers", {
          userId,
          email: `c${i}@x.fr`,
          phone: "+33600000000",
          pushEnrollment: {
            walletStatus: "enrolled",
            webPushStatus: "enrolled",
          },
          cgvAcceptedAt: DAYTIME - 30 * DAY,
          marketingOptOutDate: optOut ? DAYTIME - 1 * DAY : undefined,
          createdAt: DAYTIME - 60 * DAY,
        });
        await ctx.db.insert("customerOrdersPerTenant", {
          customerId,
          tenantId: seed.tenantA.tenantId,
          totalOrders: 1,
          lastOrderAt: DAYTIME - 10 * DAY,
          ltv: 20,
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
    expect(result.targeted).toBe(2);

    // The launch row MUST now carry the same numbers + the templateId, so the
    // historique detail page (#240) can paint `CampaignResultStats` straight
    // off the persisted row without re-running the cascade.
    const launches = await t.run((ctx) =>
      ctx.db
        .query("campaignLaunches")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .collect(),
    );
    expect(launches).toHaveLength(1);
    const row = launches[0];
    expect(row.templateId).toBe(templateId);
    expect(row.recipients).toBe(result.targeted);
    expect(row.sent).toBe(result.sent);
    expect(row.queued).toBe(result.queued);
    expect(row.skippedIneligible).toBe(result.skippedIneligible);
    expect(row.skippedRateLimited).toBe(result.skippedRateLimited);
    expect(row.skippedUnreachable).toBe(result.skippedUnreachable);
  });
});
