import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * B-CAMPAIGN-TEMPLATES-02 — `listTenantTemplates`, the public `tenantQuery`
 * a `kb_manager` calls from the campaign template picker (parent #137 — F-CAMPAGNES).
 * Written BEFORE the implementation (TDD red).
 *
 * The query is a MINCE DÉCALQUE on the slice-01 seam `listTenantCampaignTemplates`:
 * it adds the strict allowlist (`kb_manager` only — MOAT) and projects each row to
 * a `TenantTemplateSummary` that STRIPS the internal fields the front does not need:
 *  - `tenantId` (internal — the front already knows current tenant)
 *  - `createdAt` (V1 front-irrelevant)
 *  - `active` (constant `true` post-filter)
 *  - `scope` (constant `"tenant"` post-filter)
 *
 * The seam's filter contract (already covered by `campaignsStore.test.ts`) is
 * deliberately NOT re-tested here — these tests assert the WRAPPER's contract:
 * empty → `[]`, projection shape, no internal-field leak, cross-tenant fuzz.
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

type TemplateOverrides = Partial<{
  key: string;
  label: string;
  scope: "tenant" | "cross_tenant";
  active: boolean;
  tenantId: Id<"tenants"> | undefined;
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
      containsAlcohol: false,
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

describe("B-CAMPAIGN-TEMPLATES-02 listTenantTemplates — public tenantQuery", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns [] (no throw) when the tenant has no template available", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got).toEqual([]);
  });

  it("merges KB-central + resto-scoped of the calling tenant, projecting to summary shape", async () => {
    const centralId = await insertTemplate(t, {
      key: "central_promo",
      label: "Central promo",
      tenantId: undefined,
    });
    const restoAId = await insertTemplate(t, {
      key: "resto_a_promo",
      label: "Resto A promo",
      tenantId: seed.tenantA.tenantId,
    });
    // Resto-B-scoped — must NEVER appear for A (cross-tenant containment).
    await insertTemplate(t, {
      key: "resto_b_only",
      tenantId: seed.tenantB.tenantId,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantA.tenantId },
    );

    const ids = got.map((r) => r.id).sort();
    expect(ids).toEqual([centralId, restoAId].sort());

    // Projection: every entry carries exactly the documented fields.
    for (const row of got) {
      expect(typeof row.id).toBe("string");
      expect(typeof row.key).toBe("string");
      expect(typeof row.label).toBe("string");
      expect(typeof row.body).toBe("string");
      expect(Array.isArray(row.variables)).toBe(true);
      expect(row.deepLinkTarget).toBe("catalogue");
      expect(row.language).toBe("fr");
      expect(typeof row.maxDiscountPercent).toBe("number");
      expect(row.containsAlcohol).toBe(false);
    }
  });

  it("strips internal fields (tenantId / createdAt / active / scope) from every row", async () => {
    await insertTemplate(t, {
      key: "central",
      tenantId: undefined,
    });
    await insertTemplate(t, {
      key: "resto",
      tenantId: seed.tenantA.tenantId,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got).toHaveLength(2);
    for (const row of got) {
      // MOAT / front-irrelevant fields: NEVER leaked through the projection.
      expect(row).not.toHaveProperty("tenantId");
      expect(row).not.toHaveProperty("createdAt");
      expect(row).not.toHaveProperty("active");
      expect(row).not.toHaveProperty("scope");
      // Also no Convex internal columns.
      expect(row).not.toHaveProperty("_id");
      expect(row).not.toHaveProperty("_creationTime");
    }
  });

  it("does NOT expose cross_tenant or inactive rows (parity with the slice-01 seam filter)", async () => {
    await insertTemplate(t, {
      key: "kb_blast_central",
      scope: "cross_tenant",
      tenantId: undefined,
    });
    await insertTemplate(t, {
      key: "off_central",
      tenantId: undefined,
      active: false,
    });
    await insertTemplate(t, {
      key: "good_central",
      tenantId: undefined,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got.map((r) => r.key)).toEqual(["good_central"]);
  });

  it("rejects callers without kb_manager role on the tenant (cross-tenant fuzz)", async () => {
    // Seed at least one visible template so a leak would be unambiguous.
    await insertTemplate(t, {
      key: "any",
      tenantId: seed.tenantA.tenantId,
    });

    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.notifications.campaigns.listTenantTemplates],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(leaks).toEqual([]);
  });

  it("rejects a tenant role that is NOT in the allow-list (e.g. staff)", async () => {
    await insertTemplate(t, {
      key: "any",
      tenantId: seed.tenantA.tenantId,
    });
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    await expect(
      asStaff.query(api.lib.notifications.campaigns.listTenantTemplates, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/Forbidden/);
  });
});

/**
 * B-CAMPAIGN-TEMPLATES-03 — MOAT hardening (cross-tenant fuzz + role gating +
 * kb_admin root override). Aims to lock the behaviour of the public
 * `listTenantTemplates` query so a leak fails CI loudly. Reuses the
 * `runCrossTenantFuzz` factory + `seedTwoTenantsAllRoles` fixtures from
 * `lib/tenancy/fuzz`; no new wrapper, no schema change, no runtime change.
 */
describe("B-CAMPAIGN-TEMPLATES-03 listTenantTemplates — MOAT + role + admin", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  // 1. Scope filter (MOAT). The seam already filters, but we re-assert the
  //    contract holds end-to-end so a future seam regression cannot silently
  //    leak a cross_tenant row through the public query.
  it("never returns a cross_tenant template, with or without tenantId, even active", async () => {
    // cross_tenant + no tenantId (KB-central blast — kb_admin-only material).
    await insertTemplate(t, {
      key: "kb_blast_no_tid",
      scope: "cross_tenant",
      tenantId: undefined,
      active: true,
    });
    // cross_tenant + tenantId set on the calling tenant — still must NOT leak.
    await insertTemplate(t, {
      key: "kb_blast_with_tid_a",
      scope: "cross_tenant",
      tenantId: seed.tenantA.tenantId,
      active: true,
    });
    // A control row that SHOULD appear so an empty result does not mask a bug.
    const visibleId = await insertTemplate(t, {
      key: "ok_central",
      tenantId: undefined,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got.map((r) => r.id)).toEqual([visibleId]);
  });

  // 2. Active filter. Already covered for KB-central; cover the resto-scoped
  //    arm too so the contract is symmetric.
  it("never returns a tenant-scoped template that is inactive (owned by the caller)", async () => {
    await insertTemplate(t, {
      key: "resto_off",
      tenantId: seed.tenantA.tenantId,
      active: false,
    });
    const visibleId = await insertTemplate(t, {
      key: "resto_on",
      tenantId: seed.tenantA.tenantId,
      active: true,
    });

    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManager.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got.map((r) => r.id)).toEqual([visibleId]);
  });

  // 3. Cross-tenant isolation MOAT (critical). Even with many tenant-B
  //    templates seeded — active, tenant-scoped, varied keys — A's manager must
  //    see ONLY its own. The fuzz factory below covers the wrapper denial path;
  //    this case covers the wrapper PERMIT path with a foreign-data minefield.
  it("MOAT: an A-manager with tenantId=A NEVER sees any tenant-B template", async () => {
    const aId = await insertTemplate(t, {
      key: "owned_by_a",
      tenantId: seed.tenantA.tenantId,
    });
    // Plant a minefield of B-owned, active, tenant-scoped templates.
    for (const key of ["b_one", "b_two", "b_three"]) {
      await insertTemplate(t, {
        key,
        tenantId: seed.tenantB.tenantId,
      });
    }
    const asManagerA = t.withIdentity({ subject: seed.tenantA.managerId });
    const got = await asManagerA.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(got.map((r) => r.id)).toEqual([aId]);
  });

  // 4. KB-central visible cross-tenant. The same KB-central template id must
  //    surface for BOTH tenants — that's the whole point of KB-central rows.
  it("KB-central templates (tenantId: undefined) are visible to every tenant", async () => {
    const centralId = await insertTemplate(t, {
      key: "shared_central",
      tenantId: undefined,
    });

    const asManagerA = t.withIdentity({ subject: seed.tenantA.managerId });
    const gotA = await asManagerA.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(gotA.map((r) => r.id)).toEqual([centralId]);

    const asManagerB = t.withIdentity({ subject: seed.tenantB.managerId });
    const gotB = await asManagerB.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantB.tenantId },
    );
    expect(gotB.map((r) => r.id)).toEqual([centralId]);
  });

  // 5. Resto-scoped visible only at the owning tenant — both directions.
  it("a tenant-scoped template is visible to its owner ONLY, not the other tenant", async () => {
    const aId = await insertTemplate(t, {
      key: "a_promo",
      tenantId: seed.tenantA.tenantId,
    });
    const bId = await insertTemplate(t, {
      key: "b_promo",
      tenantId: seed.tenantB.tenantId,
    });

    const asManagerA = t.withIdentity({ subject: seed.tenantA.managerId });
    const gotA = await asManagerA.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(gotA.map((r) => r.id)).toEqual([aId]);

    const asManagerB = t.withIdentity({ subject: seed.tenantB.managerId });
    const gotB = await asManagerB.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantB.tenantId },
    );
    expect(gotB.map((r) => r.id)).toEqual([bId]);
  });

  // 6. Role gating — extended fuzz: every unauthorized actor (across both
  //    tenants + the role-mismatch staff + plain-customer + anonymous +
  //    detached) MUST throw. Reuses the campaigns.ts factory + the
  //    seedTwoTenantsAllRoles fixture (no duplication).
  it("cross-tenant fuzz: every unauthorized actor throws (no leak)", async () => {
    // Seed a non-empty result so a leak (returning [] instead of throwing) is
    // unambiguous: anything other than a throw fails the run.
    await insertTemplate(t, {
      key: "leak_canary",
      tenantId: seed.tenantA.tenantId,
    });
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.notifications.campaigns.listTenantTemplates],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(leaks).toEqual([]);
    expect(pairs).toBe(6);
  });

  // 7. kb_admin root override — a KB root operator can call on ANY tenant
  //    (supervision path, inherited from `tenantQuery`).
  it("kb_admin (root) can call listTenantTemplates on any tenantId", async () => {
    const aId = await insertTemplate(t, {
      key: "a_only",
      tenantId: seed.tenantA.tenantId,
    });
    const bId = await insertTemplate(t, {
      key: "b_only",
      tenantId: seed.tenantB.tenantId,
    });

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const gotA = await asAdmin.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(gotA.map((r) => r.id)).toEqual([aId]);

    const gotB = await asAdmin.query(
      api.lib.notifications.campaigns.listTenantTemplates,
      { tenantId: seed.tenantB.tenantId },
    );
    expect(gotB.map((r) => r.id)).toEqual([bId]);
  });

  // 8. Strict allowlist — `staff` (a real tenant role) is explicitly rejected
  //    by the wrapper's `allow: ["kb_manager"]` declaration. Covered by the
  //    sibling describe; re-asserted here as an explicit MOAT pin so a future
  //    `allow` widening does not silently slip past CI.
  it("strict allowlist: staff is rejected even on its own tenant (allow=['kb_manager'])", async () => {
    await insertTemplate(t, {
      key: "any",
      tenantId: seed.tenantA.tenantId,
    });
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    await expect(
      asStaff.query(api.lib.notifications.campaigns.listTenantTemplates, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/Forbidden/);
  });
});
