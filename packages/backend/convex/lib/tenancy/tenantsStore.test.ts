import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "./fuzz";
import {
  activateTenant,
  getTenantById,
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
 * B-TENANT-LIFECYCLE slice 1 — store seam for the upcoming `tenant.updateSettings`
 * (D5 élargi) + `tenant.activate` (D6) mutations (PRD 70 §4.8 / §3.6 step 4 + 8),
 * written BEFORE the implementation (TDD red).
 *
 * This slice introduces NO Convex function — we drive the seam helpers directly
 * via `t.run((ctx) => ...)`, exactly like the `menuStore.test.ts` slice 1
 * (the lint exempts test files under `convex` from `no-untenanted-query`).
 *
 * The pivot of D5 élargi — « passer `{ branding: { logoUrl } }` ne doit PAS
 * effacer un `primaryColor` déjà posé » — est testé structurellement ici : la
 * fusion profonde du sous-objet `branding` vit dans le store (le module métier
 * reste mince).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("B-TENANT-LIFECYCLE slice 1 — tenantsStore seam (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  // ── getTenantById ───────────────────────────────────────────────────────────

  it("getTenantById returns the seeded tenant doc", async () => {
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got).not.toBeNull();
    expect(got?._id).toBe(seed.tenantA.tenantId);
    expect(got?.slug).toBe("fuzz-a");
  });

  it("getTenantById returns null for a tenant id that does not exist", async () => {
    // Insert + delete to obtain a syntactically-valid but absent id.
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        slug: "ghost",
        name: "Ghost",
        siret: "00000000000000",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    const got = await t.run((ctx) => getTenantById(ctx, ghost));
    expect(got).toBeNull();
  });

  // ── updateTenantSettings — top-level shallow merge ─────────────────────────

  it("updateTenantSettings shallow-merges top-level optional fields (address/phone/acceptedModes)", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        address: "1 rue de la Paix, 75002 Paris",
        phone: "+33123456789",
        acceptedModes: { delivery: true, clickAndCollect: false },
      }),
    );
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.address).toBe("1 rue de la Paix, 75002 Paris");
    expect(got?.phone).toBe("+33123456789");
    expect(got?.acceptedModes).toEqual({
      delivery: true,
      clickAndCollect: false,
    });
    // Untouched identity fields survive.
    expect(got?.slug).toBe("fuzz-a");
    expect(got?.name).toBe("Tenant A");
  });

  it("updateTenantSettings with a partial top-level patch only updates the fields supplied", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        address: "Initial address",
        phone: "+33111111111",
      }),
    );
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        phone: "+33222222222",
      }),
    );
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.address).toBe("Initial address"); // unchanged
    expect(got?.phone).toBe("+33222222222"); // overwritten
  });

  // ── updateTenantSettings — branding deep-merge (the D5 élargi pivot) ───────

  it("updateTenantSettings deep-merges the branding sub-object (logoUrl-only does NOT erase primaryColor)", async () => {
    // Seed an existing primaryColor.
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        branding: { primaryColor: "#1B7A3D" },
      }),
    );
    // Patch ONLY the logoUrl.
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        branding: { logoUrl: "https://cdn.example.com/logo.png" },
      }),
    );
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.branding).toEqual({
      primaryColor: "#1B7A3D",
      logoUrl: "https://cdn.example.com/logo.png",
    });
  });

  it("updateTenantSettings branding deep-merge accepts a fresh branding (no prior value)", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        branding: { primaryColor: "#E5A100" },
      }),
    );
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.branding).toEqual({ primaryColor: "#E5A100" });
  });

  it("updateTenantSettings can overwrite a branding field while keeping the other (deep merge)", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        branding: {
          logoUrl: "https://cdn.example.com/old.png",
          primaryColor: "#1B7A3D",
        },
      }),
    );
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        branding: { logoUrl: "https://cdn.example.com/new.png" },
      }),
    );
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.branding).toEqual({
      logoUrl: "https://cdn.example.com/new.png",
      primaryColor: "#1B7A3D", // preserved
    });
  });

  it("updateTenantSettings with no keys is a no-op (does not erase anything)", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        address: "Stay",
        branding: { primaryColor: "#000000" },
      }),
    );
    await t.run((ctx) => updateTenantSettings(ctx, seed.tenantA.tenantId, {}));
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.address).toBe("Stay");
    expect(got?.branding).toEqual({ primaryColor: "#000000" });
  });

  // ── customDomain — top-level shallow merge (F-WIZARD [4/10] #268) ──────────

  it("F-WIZARD [4/10] (#268): updateTenantSettings persists customDomain (shallow merge)", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        customDomain: "artisan.fr",
      }),
    );
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.customDomain).toBe("artisan.fr");
  });

  it("F-WIZARD [4/10] (#268): patching customDomain alone leaves other settings intact", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        address: "Existing",
        branding: { primaryColor: "#1B7A3D" },
      }),
    );
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        customDomain: "artisan.fr",
      }),
    );
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.customDomain).toBe("artisan.fr");
    expect(got?.address).toBe("Existing");
    expect(got?.branding).toEqual({ primaryColor: "#1B7A3D" });
  });

  it("F-WIZARD [4/10] (#268): re-patching customDomain overwrites the previous value", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        customDomain: "first.fr",
      }),
    );
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        customDomain: "second.fr",
      }),
    );
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.customDomain).toBe("second.fr");
  });

  // ── activateTenant ──────────────────────────────────────────────────────────

  it("activateTenant flips status from pending to active", async () => {
    // Seeded tenants are created `active` via fuzz helper — explicitly reset to
    // pending to mirror a fresh wizard tenant.
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, { status: "pending" });
    });
    await t.run((ctx) => activateTenant(ctx, seed.tenantA.tenantId));
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.status).toBe("active");
  });

  it("activateTenant does NOT guard the source status (state machine lives upstream)", async () => {
    // Start from `suspended` — the helper still flips to `active` because the
    // transition check is the upstream mutation's job, not the seam's.
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, { status: "suspended" });
    });
    await t.run((ctx) => activateTenant(ctx, seed.tenantA.tenantId));
    const got = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    expect(got?.status).toBe("active");
  });

  // ── Cross-tenant isolation (ADR 0010) ───────────────────────────────────────

  it("writes against tenant A do NOT touch tenant B (cross-tenant isolation)", async () => {
    await t.run((ctx) =>
      updateTenantSettings(ctx, seed.tenantA.tenantId, {
        address: "A-only",
        branding: { primaryColor: "#A1A1A1" },
      }),
    );
    await t.run((ctx) => activateTenant(ctx, seed.tenantA.tenantId));

    const a = await t.run((ctx) => getTenantById(ctx, seed.tenantA.tenantId));
    const b = await t.run((ctx) => getTenantById(ctx, seed.tenantB.tenantId));
    expect(a?.address).toBe("A-only");
    expect(a?.branding).toEqual({ primaryColor: "#A1A1A1" });
    expect(b?.address).toBeUndefined();
    expect(b?.branding).toBeUndefined();
    // Tenant B's status untouched by tenant A's activation.
    expect(b?.status).toBe("active"); // seed default
  });
});
