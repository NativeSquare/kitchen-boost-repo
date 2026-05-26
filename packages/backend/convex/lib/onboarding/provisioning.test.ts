import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";
import { generateSlug, tenantPwaUrl } from "./provisioning";

/**
 * 2.9-E — tenant provisioning wizard backend (PRD 70 §3.6, multi-tenant CONTEXT
 * "Provisioning", PRD 50 §2/§3). Written BEFORE the implementation (TDD red).
 *
 * `provisionTenant` is the orchestration-only `kbAdminMutation` (root) that turns
 * a prospect (reached Préparation) into a live tenant: unique slug → tenant row →
 * KB Manager (existing or new) attached via `user_tenants` → tenant domain
 * (customDomain public face, bootstrap sub-domain fallback) → QR data → Stripe
 * account_link step (soft dep) → prospect back-link. Coherent: a mid-way failure
 * leaves no orphaned tenant.
 *
 * The two PURE helpers (`generateSlug`, `tenantPwaUrl`) are tested in isolation;
 * the orchestration + isolation are tested through the real Convex mutation.
 */

// convex-test needs the function modules; array-negation glob form is required
// (extglob `!(*.test)` returns ZERO modules — project memory). Normalise keys so
// findModulesRoot has ONE common prefix (same shape as the crm / pipeline suites).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/onboarding/${path.slice(2)}` : path,
    loader,
  ]),
);

describe("2.9-E generateSlug — pure URL-friendly slug", () => {
  it("lower-cases, strips accents and folds spaces to single hyphens", () => {
    expect(generateSlug("Buns & Bao")).toBe("buns-bao");
    expect(generateSlug("L'Artisan Pâtissier")).toBe("l-artisan-patissier");
    expect(generateSlug("Thai Street  Saint  Michel")).toBe(
      "thai-street-saint-michel",
    );
  });

  it("only ever emits [a-z0-9-] (multi-tenant CONTEXT Slug)", () => {
    expect(generateSlug("Café 100% Végé !!!")).toMatch(/^[a-z0-9-]+$/);
  });

  it("trims leading/trailing hyphens", () => {
    expect(generateSlug("  ***Resto***  ")).toBe("resto");
  });
});

describe("2.9-E tenantPwaUrl — public face resolution (PRD 50 §3)", () => {
  it("resolves to the customDomain (public face, norm V1) when set", () => {
    expect(
      tenantPwaUrl({ slug: "buns-bao", customDomain: "commander.bunsbao.fr" }),
    ).toBe("https://commander.bunsbao.fr");
  });

  it("falls back to the bootstrap <slug>.kitchen-boost.fr sub-domain only when no customDomain", () => {
    expect(tenantPwaUrl({ slug: "buns-bao", customDomain: undefined })).toBe(
      "https://buns-bao.kitchen-boost.fr",
    );
  });

  it("is NOT hardcoded to the sub-domain when a customDomain exists", () => {
    const url = tenantPwaUrl({
      slug: "buns-bao",
      customDomain: "bunsbao.fr",
    });
    expect(url).not.toContain("kitchen-boost.fr");
  });
});

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

async function makePreparationProspect(
  t: ReturnType<typeof convexTest>,
  seed: Seed,
  over: { name?: string; phone?: string; email?: string } = {},
) {
  const asAdmin = t.withIdentity({ subject: seed.adminId });
  const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
    name: over.name ?? "Buns & Bao",
    phone: over.phone ?? "0600000000",
    source: "cold_call",
  });
  const now = Date.now();
  // Drive it to Préparation: full Closing then auto-bascule.
  await asAdmin.mutation(api.lib.onboarding.crm.editProspect, {
    prospectId: id,
    patch: {
      email: over.email ?? "khan@bunsbao.fr",
      siret: "12345678900012",
      milestones: {
        contratSigne: now,
        kbisRecu: now,
        pieceIdentiteRecue: now,
        ribRecu: now,
      },
    },
  });
  await asAdmin.mutation(api.lib.onboarding.pipeline.applyClosing, {
    prospectId: id,
  });
  return id;
}

describe("2.9-E provisionTenant — orchestration (root, audited)", () => {
  it("creates a tenant, attaches a NEW KB Manager via user_tenants, links the prospect", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await makePreparationProspect(t, seed);

    const result = await asAdmin.mutation(
      api.lib.onboarding.provisioning.provisionTenant,
      {
        prospectId,
        name: "Buns & Bao",
        siret: "12345678900012",
        slug: "buns-bao",
        manager: { email: "khan@bunsbao.fr", name: "Khan" },
      },
    );

    expect(result.slug).toBe("buns-bao");
    expect(result.tenantId).toBeDefined();

    // tenant created, pending, with the bootstrap sub-domain url as fallback
    const tenant = await t.run((ctx) => ctx.db.get(result.tenantId));
    expect(tenant?.slug).toBe("buns-bao");
    expect(tenant?.status).toBe("pending");

    // KB Manager user + active userTenants link with role kb_manager
    const links = await t.run((ctx) =>
      ctx.db
        .query("userTenants")
        .withIndex("by_tenant", (q) => q.eq("tenantId", result.tenantId))
        .collect(),
    );
    expect(links.length).toBe(1);
    expect(links[0]?.role).toBe("kb_manager");
    expect(links[0]?.detachedAt).toBeUndefined();
    expect(links[0]?.userId).toBe(result.managerUserId);

    // prospect back-linked to the new tenant
    const prospect = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId,
    });
    expect(prospect?.tenantId).toBe(result.tenantId);
  });

  it("reuses an EXISTING user as KB Manager (cas Walid) instead of creating a duplicate", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // Pre-existing user (Walid) by email.
    const walidId = await t.run((ctx) =>
      ctx.db.insert("users", {
        email: "walid@thaistreet.fr",
        role: "customer",
      }),
    );
    const prospectId = await makePreparationProspect(t, seed, {
      name: "Thai Street Bastille",
      phone: "0611111111",
      email: "walid@thaistreet.fr",
    });

    const result = await asAdmin.mutation(
      api.lib.onboarding.provisioning.provisionTenant,
      {
        prospectId,
        name: "Thai Street Bastille",
        siret: "98765432100021",
        slug: "thai-street-bastille",
        manager: { email: "walid@thaistreet.fr", name: "Walid" },
      },
    );

    expect(result.managerUserId).toBe(walidId);
    const users = await t.run((ctx) =>
      ctx.db
        .query("users")
        .filter((q) => q.eq(q.field("email"), "walid@thaistreet.fr"))
        .collect(),
    );
    expect(users.length).toBe(1);
  });

  it("rejects a DUPLICATE slug (no sub-domain collision)", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // seedTwoTenantsAllRoles already created slug "fuzz-a".
    const prospectId = await makePreparationProspect(t, seed);
    await expect(
      asAdmin.mutation(api.lib.onboarding.provisioning.provisionTenant, {
        prospectId,
        name: "Collider",
        siret: "11111111100011",
        slug: "fuzz-a",
        manager: { email: "x@x.fr", name: "X" },
      }),
    ).rejects.toThrow(/slug/i);
  });

  it("sets customDomain as the public face and resolves the QR data to it (NOT the sub-domain)", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await makePreparationProspect(t, seed);

    const result = await asAdmin.mutation(
      api.lib.onboarding.provisioning.provisionTenant,
      {
        prospectId,
        name: "Buns & Bao",
        siret: "12345678900012",
        slug: "buns-bao",
        customDomain: "commander.bunsbao.fr",
        manager: { email: "khan@bunsbao.fr", name: "Khan" },
      },
    );

    const tenant = await t.run((ctx) => ctx.db.get(result.tenantId));
    expect(tenant?.customDomain).toBe("commander.bunsbao.fr");
    // QR / PWA url resolves to the public face, NOT hardcoded to the sub-domain.
    expect(result.qr.pwaUrl).toBe("https://commander.bunsbao.fr");
    expect(result.qr.pwaUrl).not.toContain("kitchen-boost.fr");
  });

  it("falls back the QR data to the bootstrap sub-domain when no customDomain", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await makePreparationProspect(t, seed);

    const result = await asAdmin.mutation(
      api.lib.onboarding.provisioning.provisionTenant,
      {
        prospectId,
        name: "Buns & Bao",
        siret: "12345678900012",
        slug: "buns-bao",
        manager: { email: "khan@bunsbao.fr", name: "Khan" },
      },
    );
    expect(result.qr.pwaUrl).toBe("https://buns-bao.kitchen-boost.fr");
    expect(result.qr.bootstrapUrl).toBe("https://buns-bao.kitchen-boost.fr");
  });

  it("Stripe account_link step is cleanly skipped (soft dep) when STRIPE_SECRET_KEY is absent — no hard failure", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await makePreparationProspect(t, seed);

    const previous = process.env.STRIPE_SECRET_KEY;
    // biome-ignore lint: test setup
    delete process.env.STRIPE_SECRET_KEY;
    try {
      const result = await asAdmin.mutation(
        api.lib.onboarding.provisioning.provisionTenant,
        {
          prospectId,
          name: "Buns & Bao",
          siret: "12345678900012",
          slug: "buns-bao",
          manager: { email: "khan@bunsbao.fr", name: "Khan" },
        },
      );
      // Provisioning still succeeded; Stripe step flagged as skipped, not failed.
      expect(result.tenantId).toBeDefined();
      expect(result.stripeOnboarding.enabled).toBe(false);
    } finally {
      if (previous !== undefined) process.env.STRIPE_SECRET_KEY = previous;
    }
  });

  it("Stripe account_link step is enabled (flagged for the front to consume the 2.5 action) when configured", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await makePreparationProspect(t, seed);

    const previous = process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    try {
      const result = await asAdmin.mutation(
        api.lib.onboarding.provisioning.provisionTenant,
        {
          prospectId,
          name: "Buns & Bao",
          siret: "12345678900012",
          slug: "buns-bao",
          manager: { email: "khan@bunsbao.fr", name: "Khan" },
        },
      );
      expect(result.stripeOnboarding.enabled).toBe(true);
    } finally {
      if (previous === undefined) {
        // biome-ignore lint: test teardown
        delete process.env.STRIPE_SECRET_KEY;
      } else {
        process.env.STRIPE_SECRET_KEY = previous;
      }
    }
  });

  it("is coherent: a duplicate-slug failure leaves NO orphaned tenant", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await makePreparationProspect(t, seed);

    const before = await t.run((ctx) => ctx.db.query("tenants").collect());
    await expect(
      asAdmin.mutation(api.lib.onboarding.provisioning.provisionTenant, {
        prospectId,
        name: "Collider",
        siret: "11111111100011",
        slug: "fuzz-b", // already taken by the seed
        manager: { email: "y@y.fr", name: "Y" },
      }),
    ).rejects.toThrow();
    const after = await t.run((ctx) => ctx.db.query("tenants").collect());
    // No tenant created, and no orphaned userTenants link either.
    expect(after.length).toBe(before.length);
  });

  it("records a tenant.provision audit row", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await makePreparationProspect(t, seed);

    const result = await asAdmin.mutation(
      api.lib.onboarding.provisioning.provisionTenant,
      {
        prospectId,
        name: "Buns & Bao",
        siret: "12345678900012",
        slug: "buns-bao",
        manager: { email: "khan@bunsbao.fr", name: "Khan" },
      },
    );
    const rows = await t.run((ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "tenant.provision"))
        .collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.targetId).toBe(result.tenantId);
  });
});

describe("2.9-E provisionTenant root-only — kb_admin-gated (cross-tenant fuzz)", () => {
  it("no non-root actor can reach provisionTenant (no leak)", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const prospectId = await makePreparationProspect(t, seed);

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.onboarding.provisioning.provisionTenant],
      isQuery: () => false,
      tenantId: undefined, // root function takes no tenantId
      actors: [
        { label: "A-manager", subject: seed.tenantA.managerId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "anonymous", subject: null },
      ],
      extraArgs: {
        prospectId,
        name: "Hijack",
        siret: "00000000000000",
        slug: "hijack",
        manager: { email: "z@z.fr", name: "Z" },
      },
    });
    expect(pairs).toBe(5);
    expect(leaks).toEqual([]);
  });

  it("a non-root caller is rejected with Forbidden", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const prospectId = await makePreparationProspect(t, seed);
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.onboarding.provisioning.provisionTenant, {
          prospectId,
          name: "Hijack",
          siret: "00000000000000",
          slug: "hijack",
          manager: { email: "z@z.fr", name: "Z" },
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});
