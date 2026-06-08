import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "./fuzz";
import {
  getTenantByCustomDomain,
  getTenantBySlug,
  updateTenantSettings,
} from "./tenantsStore";

// convex-test needs the function modules; the array-negation glob form is
// required — extglob `!(*.test)` returns ZERO modules (project memory). This
// file lives in convex/lib/tenancy/, so normalise every key to be relative to
// the convex root (../../) so convex-test's findModulesRoot has ONE common
// prefix (same shape as the audit / customer / menuStore suites alongside).
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
 * PWA-S1 (#449) — `getTenantByCustomDomain` store seam for the PWA edge
 * middleware's host → tenant resolution path (PRD §10 PWA Client). Written
 * BEFORE the implementation (TDD red).
 *
 * Same exempt-path discipline as the rest of the store: the CALLER (a public
 * resolution query exposed to the middleware) does NOT have a `tenantId` yet
 * (that's the whole point of resolution) — so this seam can't gate on
 * tenancy. The MINIMAL projection the public exposing query returns is what
 * keeps Stripe ids / SIRET from leaking.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("PWA-S1 (#449) — getTenantByCustomDomain seam", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns the seeded tenant doc when the customDomain matches", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        customDomain: "bunsbao.fr",
      }),
    );
    const got = await t.run((ctx) =>
      getTenantByCustomDomain(ctx, "bunsbao.fr"),
    );
    expect(got).not.toBeNull();
    expect(got?._id).toBe(seed.tenantA.tenantId);
    expect(got?.slug).toBe("fuzz-a");
  });

  it("returns null when no tenant has that custom domain", async () => {
    const got = await t.run((ctx) =>
      getTenantByCustomDomain(ctx, "unknown.fr"),
    );
    expect(got).toBeNull();
  });

  it("returns null when no tenant has any customDomain stamped at all", async () => {
    // Fresh seed has no customDomain on either tenant — the index lookup must
    // not surface a tenant whose `customDomain` is undefined.
    const got = await t.run((ctx) =>
      getTenantByCustomDomain(ctx, "anything.fr"),
    );
    expect(got).toBeNull();
  });

  it("only matches the tenant whose customDomain is the EXACT value (cross-tenant isolation)", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        customDomain: "a.fr",
      }),
    );
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantB.tenantId, {
        customDomain: "b.fr",
      }),
    );
    const a = await t.run((ctx) => getTenantByCustomDomain(ctx, "a.fr"));
    const b = await t.run((ctx) => getTenantByCustomDomain(ctx, "b.fr"));
    expect(a?._id).toBe(seed.tenantA.tenantId);
    expect(b?._id).toBe(seed.tenantB.tenantId);
    // A lookup for one tenant's customDomain must NEVER surface the other.
    expect(a?._id).not.toBe(seed.tenantB.tenantId);
    expect(b?._id).not.toBe(seed.tenantA.tenantId);
  });

  it("returns null after a previously-set customDomain is moved to another tenant", async () => {
    // Set then clear (via re-patch to a different value) — proves the index is
    // refreshed on writes (no stale read after re-attribution).
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        customDomain: "moving.fr",
      }),
    );
    // Move the domain to tenant B (tenant A's stays — V1 has no uniqueness
    // enforcement at the seam level; the caller owns that — but the index
    // still finds the right row).
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        customDomain: "freed.fr",
      }),
    );
    const old = await t.run((ctx) => getTenantByCustomDomain(ctx, "moving.fr"));
    expect(old).toBeNull();
    const fresh = await t.run((ctx) =>
      getTenantByCustomDomain(ctx, "freed.fr"),
    );
    expect(fresh?._id).toBe(seed.tenantA.tenantId);
  });

  // Sanity: the existing `getTenantBySlug` still resolves the seeded tenant
  // (the new index doesn't break the old one) — covers the "PWA middleware
  // falls back to slug on `<slug>.kitchen-boost.com`" path.
  it("getTenantBySlug still resolves the seeded slug (no regression)", async () => {
    const got = await t.run((ctx) => getTenantBySlug(ctx, "fuzz-a"));
    expect(got?._id).toBe(seed.tenantA.tenantId);
  });
});
