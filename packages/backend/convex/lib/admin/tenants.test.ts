import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). Normalise every key
// relative to the convex root (../../).
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
 * F-PIPELINE-CRM 09 (#264) — `getTenant` kbAdminQuery.
 *
 * Root-only read used by the supervision fiche's `TenantPanel` to surface a
 * back-link to a provisioned tenant (slug, name, status). Tri-state aware:
 * a syntactically-valid id with no row returns `null` (matches the
 * `useQuery` tri-state contract `undefined | null | Doc`).
 *
 * Returns a MINIMAL projection (no Stripe ids, no SIRET) — the panel only
 * needs `tenantId / slug / name / status`. Same exposure discipline as
 * `listAllTenants` (the switcher's minimal projection).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("F-PIPELINE-CRM 09 (#264) getTenant — happy path (root-only)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns the minimal projection for an existing tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const got = await asAdmin.query(api.lib.admin.tenants.getTenant, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(got).not.toBeNull();
    expect(got).toMatchObject({
      _id: seed.tenantA.tenantId,
      slug: expect.any(String),
      name: expect.any(String),
      status: expect.any(String),
    });
    // Defensive: the projection must NOT leak sensitive fields (Stripe ids,
    // SIRET). Same discipline as `listAllTenants`.
    expect(got).not.toHaveProperty("siret");
    expect(got).not.toHaveProperty("stripeAccountId");
  });

  it("returns null when the tenant id is syntactically valid but has no row", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    // Borrow a real tenantId then delete the row so the id stays valid.
    const phantomId = seed.tenantA.tenantId;
    await t.run((ctx) => ctx.db.delete(phantomId));
    const got = await asAdmin.query(api.lib.admin.tenants.getTenant, {
      tenantId: phantomId,
    });
    expect(got).toBeNull();
  });
});

describe("F-PIPELINE-CRM 09 (#264) getTenant root-only fuzz — kb_admin gated", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("no non-root actor can read a tenant projection", async () => {
    const queries = [api.lib.admin.tenants.getTenant];
    const actors = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: queries,
      isQuery: () => true,
      // `kbAdminQuery` does NOT consume `tenantId` via the wrapper — it sits
      // in the handler args. We still pass the attacked tenant via `extraArgs`
      // so the call is well-shaped; the wrapper rejects on role BEFORE the
      // handler reads the arg.
      tenantId: undefined,
      extraArgs: { tenantId: seed.tenantA.tenantId },
      actors,
    });
    expect(pairs).toBe(queries.length * actors.length);
    expect(leaks).toEqual([]);
  });
});
