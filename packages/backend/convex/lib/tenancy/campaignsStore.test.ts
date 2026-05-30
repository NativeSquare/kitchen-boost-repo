import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { listTenantCampaignTemplates } from "./campaignsStore";
import { seedTwoTenantsAllRoles } from "./fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/tenancy/, so normalise every key to be relative to the convex root
// (../../) so convex-test's findModulesRoot has ONE common prefix — same shape as
// menuStore.test.ts / customer.test.ts alongside.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/tenancy/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * B-CAMPAIGN-TEMPLATES-01 — sanctioned tenancy seam `listTenantCampaignTemplates`
 * (parity with `readNotificationTemplate`), written BEFORE the implementation
 * (TDD red).
 *
 * The seam returns the raw `Doc<"notificationTemplates">[]` set a given tenant is
 * allowed to see in a campaign picker, applying the EXACT same filter logic
 * `sendTenantCampaign` enforces at acceptance time (issue #153 + parent #137) —
 * no drift:
 *
 *   - `scope === "tenant"` (never `cross_tenant` — KB-only MOAT)
 *   - `active === true`
 *   - `tenantId === <argTenantId>` OR `tenantId === undefined` (KB-central)
 *
 * Two-pass read at V1 volume (ADR 0006: library ≈ 5-10 entries):
 *   (a) resto-scoped of this tenant via index `by_tenant`
 *   (b) KB-central entries (no `tenantId`) — in-memory filter is acceptable V1
 *
 * The seam itself does NOT enforce isolation (the calling `tenantQuery` does in
 * the parent epic); these tests assert the FILTER contract — what the seam
 * returns for a given `tenantId` argument.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const NOW = 1_700_000_000_000;

type TemplateOverrides = Partial<{
  key: string;
  label: string;
  scope: "tenant" | "cross_tenant";
  active: boolean;
  tenantId: Id<"tenants"> | undefined;
  containsAlcohol: boolean;
}>;

/** Insert a notificationTemplates row; sensible defaults match a V1 valid template. */
async function insertTemplate(
  t: ReturnType<typeof convexTest>,
  overrides: TemplateOverrides = {},
): Promise<Id<"notificationTemplates">> {
  return t.run((ctx) => {
    const { tenantId, ...rest } = overrides;
    const row: Record<string, unknown> = {
      key: rest.key ?? "promo_weekend",
      label: rest.label ?? "Promo weekend",
      body: "Bonjour {prenom_client}, -{discount}% chez {nom_resto} ce weekend !",
      variables: ["prenom_client", "discount", "nom_resto"],
      deepLinkTarget: "catalogue",
      scope: rest.scope ?? "tenant",
      maxDiscountPercent: 20,
      language: "fr",
      containsAlcohol: rest.containsAlcohol ?? false,
      active: rest.active ?? true,
      createdAt: NOW,
    };
    if (tenantId !== undefined) row.tenantId = tenantId;
    return ctx.db.insert(
      "notificationTemplates",
      row as Parameters<typeof ctx.db.insert<"notificationTemplates">>[1],
    );
  });
}

describe("B-CAMPAIGN-TEMPLATES-01 listTenantCampaignTemplates seam", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns [] when the table has no templates at all", async () => {
    const got = await t.run((ctx) =>
      listTenantCampaignTemplates(ctx, seed.tenantA.tenantId),
    );
    expect(got).toEqual([]);
  });

  it("excludes templates whose scope is cross_tenant (MOAT — KB-only)", async () => {
    // KB-central but cross_tenant: still hidden from any tenant picker.
    await insertTemplate(t, {
      key: "kb_blast",
      scope: "cross_tenant",
      tenantId: undefined,
    });
    // Even with a tenantId pin, cross_tenant must never appear.
    await insertTemplate(t, {
      key: "kb_blast_pinned",
      scope: "cross_tenant",
      tenantId: seed.tenantA.tenantId,
    });
    const got = await t.run((ctx) =>
      listTenantCampaignTemplates(ctx, seed.tenantA.tenantId),
    );
    expect(got).toEqual([]);
  });

  it("excludes inactive templates (active === false)", async () => {
    await insertTemplate(t, {
      key: "off_central",
      tenantId: undefined,
      active: false,
    });
    await insertTemplate(t, {
      key: "off_resto",
      tenantId: seed.tenantA.tenantId,
      active: false,
    });
    const got = await t.run((ctx) =>
      listTenantCampaignTemplates(ctx, seed.tenantA.tenantId),
    );
    expect(got).toEqual([]);
  });

  it("includes KB-central entries (tenantId absent) for every tenant", async () => {
    const centralId = await insertTemplate(t, {
      key: "central_promo",
      tenantId: undefined,
    });
    const forA = await t.run((ctx) =>
      listTenantCampaignTemplates(ctx, seed.tenantA.tenantId),
    );
    const forB = await t.run((ctx) =>
      listTenantCampaignTemplates(ctx, seed.tenantB.tenantId),
    );
    expect(forA.map((r) => r._id)).toEqual([centralId]);
    expect(forB.map((r) => r._id)).toEqual([centralId]);
  });

  it("includes resto-scoped templates only for the matching tenantId", async () => {
    const ownedByA = await insertTemplate(t, {
      key: "a_only",
      tenantId: seed.tenantA.tenantId,
    });
    const ownedByB = await insertTemplate(t, {
      key: "b_only",
      tenantId: seed.tenantB.tenantId,
    });
    const forA = await t.run((ctx) =>
      listTenantCampaignTemplates(ctx, seed.tenantA.tenantId),
    );
    const forB = await t.run((ctx) =>
      listTenantCampaignTemplates(ctx, seed.tenantB.tenantId),
    );
    expect(forA.map((r) => r._id)).toEqual([ownedByA]);
    expect(forB.map((r) => r._id)).toEqual([ownedByB]);
  });

  it("merges KB-central + resto-scoped of the right tenant, with no cross-leak", async () => {
    // KB-central, active, tenant scope: visible everywhere.
    const central = await insertTemplate(t, {
      key: "central",
      tenantId: undefined,
    });
    // Resto-scoped to A: visible to A only.
    const restoA = await insertTemplate(t, {
      key: "resto_a",
      tenantId: seed.tenantA.tenantId,
    });
    // Resto-scoped to B: must NEVER appear for A (cross-tenant containment).
    await insertTemplate(t, {
      key: "resto_b",
      tenantId: seed.tenantB.tenantId,
    });
    // Inactive central + cross_tenant central: noise that must stay filtered.
    await insertTemplate(t, {
      key: "central_off",
      tenantId: undefined,
      active: false,
    });
    await insertTemplate(t, {
      key: "central_xt",
      tenantId: undefined,
      scope: "cross_tenant",
    });

    const forA = await t.run((ctx) =>
      listTenantCampaignTemplates(ctx, seed.tenantA.tenantId),
    );
    const ids = forA.map((r) => r._id).sort();
    expect(ids).toEqual([central, restoA].sort());
  });

  it('returns full Doc<"notificationTemplates"> rows (the seam is read-only, no projection)', async () => {
    const centralId = await insertTemplate(t, {
      key: "central_payload",
      tenantId: undefined,
    });
    const got = await t.run((ctx) =>
      listTenantCampaignTemplates(ctx, seed.tenantA.tenantId),
    );
    expect(got).toHaveLength(1);
    const row = got[0]!;
    expect(row._id).toBe(centralId);
    expect(row.key).toBe("central_payload");
    expect(row.scope).toBe("tenant");
    expect(row.active).toBe(true);
    expect(row.tenantId).toBeUndefined();
    expect(row.body).toContain("{prenom_client}");
    expect(row.variables).toEqual(["prenom_client", "discount", "nom_resto"]);
    expect(row.deepLinkTarget).toBe("catalogue");
    expect(row.language).toBe("fr");
    expect(row.maxDiscountPercent).toBe(20);
    expect(row.containsAlcohol).toBe(false);
  });
});
