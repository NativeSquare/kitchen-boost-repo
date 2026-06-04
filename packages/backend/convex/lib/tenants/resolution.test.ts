import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). Normalise every
// key relative to the convex root (../../) so convex-test's findModulesRoot
// has ONE common prefix (same shape as the menu / admin suites alongside).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/tenants/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * PWA-S1 (#449) — public tenant RESOLUTION queries consumed by the PWA edge
 * middleware (`apps/web/src/proxy.ts`) to map `host` / cookie → tenantId.
 * Written BEFORE the implementation (TDD red).
 *
 * Three queries:
 *  - `bySlug(slug)` — resolves `<slug>.kitchen-boost.fr`
 *  - `byCustomDomain(customDomain)` — resolves a custom domain like `bunsbao.fr`
 *  - `byId(tenantId)` — re-validates a stale `__Host-kb_tenant` cookie when the
 *    middleware doesn't trust the cookie blindly (post-deploy / suspected
 *    orphan). Also surfaces `status` so the middleware can refuse a
 *    `suspended` / `disabled` tenant.
 *
 * All return a MINIMAL projection — `{ tenantId, slug, name, status,
 * branding? }` — never the full `Doc<"tenants">`. NO SIRET, NO Stripe ids
 * (those would leak through a future client logger). All three are PUBLIC
 * (anonymous) — the edge middleware runs BEFORE any auth, the lookup itself
 * is not a data-access boundary (only the resolved tenantId then gates real
 * data via `publicTenantQuery` / `customerQuery`).
 *
 * Tenant-not-found / unknown host returns `null` (not throw): the middleware
 * routes to the « Resto non disponible » error page rather than catching an
 * exception across an edge-runtime boundary.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("PWA-S1 (#449) — tenants.resolution.bySlug", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns the minimal projection for an existing slug", async () => {
    const got = await t.query(api.lib.tenants.resolution.bySlug, {
      slug: "fuzz-a",
    });
    expect(got).not.toBeNull();
    expect(got).toMatchObject({
      tenantId: seed.tenantA.tenantId,
      slug: "fuzz-a",
      name: "Tenant A",
      status: "active",
    });
    // Defensive: the projection must NOT leak sensitive fields.
    expect(got).not.toHaveProperty("siret");
    expect(got).not.toHaveProperty("stripeAccountId");
    expect(got).not.toHaveProperty("stripeStatus");
  });

  it("returns null when the slug does not match any tenant", async () => {
    const got = await t.query(api.lib.tenants.resolution.bySlug, {
      slug: "ghost-resto",
    });
    expect(got).toBeNull();
  });

  it("is callable without any authentication (anonymous edge middleware)", async () => {
    // The middleware runs PRE-auth — make sure the wrapper doesn't require an
    // identity.
    const got = await t.query(api.lib.tenants.resolution.bySlug, {
      slug: "fuzz-a",
    });
    expect(got?.tenantId).toBe(seed.tenantA.tenantId);
  });

  it("only matches the EXACT slug (cross-tenant isolation)", async () => {
    const a = await t.query(api.lib.tenants.resolution.bySlug, {
      slug: "fuzz-a",
    });
    const b = await t.query(api.lib.tenants.resolution.bySlug, {
      slug: "fuzz-b",
    });
    expect(a?.tenantId).toBe(seed.tenantA.tenantId);
    expect(b?.tenantId).toBe(seed.tenantB.tenantId);
    expect(a?.tenantId).not.toBe(seed.tenantB.tenantId);
    expect(b?.tenantId).not.toBe(seed.tenantA.tenantId);
  });
});

describe("PWA-S1 (#449) — tenants.resolution.byCustomDomain", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns the minimal projection for an existing customDomain", async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, { customDomain: "bunsbao.fr" });
    });
    const got = await t.query(api.lib.tenants.resolution.byCustomDomain, {
      customDomain: "bunsbao.fr",
    });
    expect(got).not.toBeNull();
    expect(got).toMatchObject({
      tenantId: seed.tenantA.tenantId,
      slug: "fuzz-a",
      name: "Tenant A",
      status: "active",
    });
    expect(got).not.toHaveProperty("siret");
    expect(got).not.toHaveProperty("stripeAccountId");
  });

  it("returns null when no tenant has that customDomain", async () => {
    const got = await t.query(api.lib.tenants.resolution.byCustomDomain, {
      customDomain: "unknown.fr",
    });
    expect(got).toBeNull();
  });

  it("returns null when no tenant has any customDomain set", async () => {
    const got = await t.query(api.lib.tenants.resolution.byCustomDomain, {
      customDomain: "anything.fr",
    });
    expect(got).toBeNull();
  });

  it("only resolves the tenant that owns the customDomain (cross-tenant isolation)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, { customDomain: "a.fr" });
      await ctx.db.patch(seed.tenantB.tenantId, { customDomain: "b.fr" });
    });
    const a = await t.query(api.lib.tenants.resolution.byCustomDomain, {
      customDomain: "a.fr",
    });
    const b = await t.query(api.lib.tenants.resolution.byCustomDomain, {
      customDomain: "b.fr",
    });
    expect(a?.tenantId).toBe(seed.tenantA.tenantId);
    expect(b?.tenantId).toBe(seed.tenantB.tenantId);
    // Cookie posed for tenant A's host must NEVER surface tenant B (and vv).
    expect(a?.tenantId).not.toBe(seed.tenantB.tenantId);
    expect(b?.tenantId).not.toBe(seed.tenantA.tenantId);
  });

  it("is callable without authentication (anonymous edge middleware)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, { customDomain: "x.fr" });
    });
    const got = await t.query(api.lib.tenants.resolution.byCustomDomain, {
      customDomain: "x.fr",
    });
    expect(got?.tenantId).toBe(seed.tenantA.tenantId);
  });
});

describe("PWA-S1 (#449) — tenants.resolution.byId (stale cookie revalidation)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns the minimal projection for an existing tenantId", async () => {
    const got = await t.query(api.lib.tenants.resolution.byId, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(got).not.toBeNull();
    expect(got).toMatchObject({
      tenantId: seed.tenantA.tenantId,
      slug: "fuzz-a",
      name: "Tenant A",
      status: "active",
    });
    expect(got).not.toHaveProperty("siret");
    expect(got).not.toHaveProperty("stripeAccountId");
  });

  it("returns null when the tenantId no longer resolves to a row (orphan cookie)", async () => {
    // Capture a valid id then delete the row — the middleware's stale cookie
    // pointing to a since-deleted tenant must yield null so the middleware
    // clears the cookie and routes to the « Resto non disponible » page.
    const phantomId = seed.tenantA.tenantId;
    await t.run((ctx) => ctx.db.delete(phantomId));
    const got = await t.query(api.lib.tenants.resolution.byId, {
      tenantId: phantomId,
    });
    expect(got).toBeNull();
  });

  it("surfaces a non-active status so the middleware can refuse the tenant", async () => {
    await t.run((ctx) =>
      ctx.db.patch(seed.tenantA.tenantId, { status: "disabled" }),
    );
    const got = await t.query(api.lib.tenants.resolution.byId, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(got?.status).toBe("disabled");
  });

  it("is callable without authentication (anonymous edge middleware)", async () => {
    const got = await t.query(api.lib.tenants.resolution.byId, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(got?.tenantId).toBe(seed.tenantA.tenantId);
  });
});
