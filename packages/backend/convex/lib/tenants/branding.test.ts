import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). Normalise every
// key relative to the convex root (../../) so convex-test's findModulesRoot
// has ONE common prefix (same shape as resolution.test.ts alongside).
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
 * PWA-S2 (#450) — `tenants.branding.byId` — the PUBLIC tenant branding query
 * consumed by the PWA dynamic manifest endpoint + the 3 icon routes
 * (`/manifest.webmanifest`, `/icon-192.png`, `/icon-512.png`,
 * `/apple-touch-icon.png`). The routes read the resolved `tenantId` from the
 * `__Host-kb_tenant` cookie (set by #449 middleware) and need the tenant's
 * branding (name + primaryColor + logoUrl) to serve a branded manifest +
 * branded icons (PRD §10 PWA Client Q4 manifest dynamique).
 *
 * SEPARATE surface from `tenants.resolution.*` — resolution stays scoped to
 * the minimal `{ tenantId, slug, name, status }` projection (no SIRET, no
 * Stripe ids leaked), while branding adds `primaryColor` + `logoUrl`. Both
 * surfaces are PUBLIC + unauthenticated (PWA edge / route handlers run
 * PRE-auth) — the real isolation barrier stays downstream (`tenantQuery` /
 * `publicTenantQuery` / `customerQuery` wrappers, ADR 0010).
 *
 * Tenant-not-found returns `null` (same tri-state convention as resolution).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("PWA-S2 (#450) — tenants.branding.byId", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns the name + flattened primaryColor + logoUrl for a fully-branded tenant", async () => {
    await t.run((ctx) =>
      ctx.db.patch(seed.tenantA.tenantId, {
        branding: {
          primaryColor: "#1B7A3D",
          logoUrl: "https://cdn.example/a.png",
        },
      }),
    );
    const got = await t.query(api.lib.tenants.branding.byId, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(got).not.toBeNull();
    expect(got).toMatchObject({
      tenantId: seed.tenantA.tenantId,
      name: "Tenant A",
      primaryColor: "#1B7A3D",
      logoUrl: "https://cdn.example/a.png",
    });
    // The projection MUST NOT leak the rest of the row.
    expect(got).not.toHaveProperty("siret");
    expect(got).not.toHaveProperty("stripeAccountId");
    expect(got).not.toHaveProperty("status");
    expect(got).not.toHaveProperty("printerConfig");
  });

  it("returns name only when the tenant has no branding (fresh wizard step 1)", async () => {
    // A freshly-created tenant has no `branding` sub-object — the route falls
    // back to safe defaults (`decideManifest` ⇒ KB green + placeholder icon).
    const got = await t.query(api.lib.tenants.branding.byId, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(got).not.toBeNull();
    expect(got?.name).toBe("Tenant A");
    expect(got?.primaryColor).toBeUndefined();
    expect(got?.logoUrl).toBeUndefined();
  });

  it("returns logoUrl only when the tenant has a logo but no primaryColor", async () => {
    await t.run((ctx) =>
      ctx.db.patch(seed.tenantA.tenantId, {
        branding: { logoUrl: "https://cdn.example/a.png" },
      }),
    );
    const got = await t.query(api.lib.tenants.branding.byId, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(got?.logoUrl).toBe("https://cdn.example/a.png");
    expect(got?.primaryColor).toBeUndefined();
  });

  it("returns null when the tenantId no longer resolves to a row (orphan cookie)", async () => {
    const phantomId = seed.tenantA.tenantId;
    await t.run((ctx) => ctx.db.delete(phantomId));
    const got = await t.query(api.lib.tenants.branding.byId, {
      tenantId: phantomId,
    });
    expect(got).toBeNull();
  });

  it("is callable without authentication (PWA edge route handler)", async () => {
    // The manifest/icon route handlers run PRE-auth — make sure the wrapper
    // doesn't require an identity.
    const got = await t.query(api.lib.tenants.branding.byId, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(got?.tenantId).toBe(seed.tenantA.tenantId);
  });

  it("only returns the branding of the requested tenant (cross-tenant isolation)", async () => {
    // The PWA cookie pins ONE tenantId; the route must NEVER surface a
    // sibling tenant's branding even if both rows exist.
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, {
        branding: { primaryColor: "#1B7A3D" },
      });
      await ctx.db.patch(seed.tenantB.tenantId, {
        branding: { primaryColor: "#E5A100" },
      });
    });
    const a = await t.query(api.lib.tenants.branding.byId, {
      tenantId: seed.tenantA.tenantId,
    });
    const b = await t.query(api.lib.tenants.branding.byId, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(a?.primaryColor).toBe("#1B7A3D");
    expect(b?.primaryColor).toBe("#E5A100");
    expect(a?.tenantId).not.toBe(seed.tenantB.tenantId);
    expect(b?.tenantId).not.toBe(seed.tenantA.tenantId);
  });
});
