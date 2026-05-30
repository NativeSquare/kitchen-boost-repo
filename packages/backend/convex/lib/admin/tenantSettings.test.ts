import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). Normalise every key
// to be relative to the convex root (../../) so findModulesRoot has ONE common
// prefix (same shape as the contracts / tenantsStore suites alongside).
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
 * B-TENANT-LIFECYCLE [3/4] — `tenant.updateSettings` mutation (D5 élargi, PRD 70
 * §3.6 step 4 + §4.8), written BEFORE the implementation (TDD red).
 *
 * Single mutation, two callers (wizard step 4 branding & Paramètres tenant
 * page): wrapped as `tenantMutation({ allow: ["kb_manager"], audit: true,
 * action: "tenant.updateSettings" })`. The `kb_admin` root override (wired in
 * `withTenant.ts`) covers the wizard caller — same wrapper, no separate
 * surface. Validation pipeline reuses the pure helpers from slice 2
 * (`isValidHexColor`, `normalisePhone`, `assertNonEmptyString`); persistence
 * delegates to `updateTenantSettings` from `lib/tenancy/tenantsStore.ts` (the
 * branding deep-merge lives there). The wrapper auto-audits on success.
 *
 * Acceptance criteria covered:
 *  - happy path (kb_manager updates branding) + audit row written
 *  - deep-merge (logoUrl-only does NOT erase a pre-existing primaryColor)
 *  - multi-field patch (address + phone + acceptedModes in one call)
 *  - invalid hex → INVALID_HEX_COLOR
 *  - empty address → INVALID_ADDRESS
 *  - empty logoUrl → INVALID_LOGO_URL
 *  - invalid phone → INVALID_PHONE
 *  - cross-tenant fuzz (manager of B on tenant A → FORBIDDEN; kb_admin passes
 *    anywhere via root override; anonymous → UNAUTHENTICATED;
 *    plain customer / detached → FORBIDDEN)
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** Read every auditLog row (test-only direct read, bypassing the wrappers). */
async function readAuditLog(
  t: ReturnType<typeof convexTest>,
): Promise<Doc<"auditLog">[]> {
  return t.run((ctx) => ctx.db.query("auditLog").collect());
}

describe("B-TENANT-LIFECYCLE [3/4] tenant.updateSettings — happy paths", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("KB Manager updates branding → row reflects change + audit row written", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: { branding: { primaryColor: "#1B7A3D" } },
    });

    // Row reflects the branding change.
    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.branding).toEqual({ primaryColor: "#1B7A3D" });

    // Audit row was written with the declared action.
    const rows = await readAuditLog(t);
    const row = rows.find((r) => r.action === "tenant.updateSettings");
    expect(row).toBeDefined();
    expect(row?.actorUserId).toBe(seed.tenantA.managerId);
    expect(row?.actorRole).toBe("kb_manager");
    expect(row?.tenantId).toBe(seed.tenantA.tenantId);
  });

  it("deep-merge: { branding: { logoUrl } } leaves primaryColor intact", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    // Seed an initial primaryColor.
    await asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: { branding: { primaryColor: "#1B7A3D" } },
    });
    // Patch ONLY the logoUrl.
    await asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: { branding: { logoUrl: "https://cdn.example.com/logo.png" } },
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.branding).toEqual({
      primaryColor: "#1B7A3D",
      logoUrl: "https://cdn.example.com/logo.png",
    });
  });

  it("multi-field: { address, phone, acceptedModes } all land in one transaction", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: {
        address: "12 rue de la Paix, 75002 Paris",
        phone: "+33 1 23 45 67 89",
        acceptedModes: { delivery: true, clickAndCollect: false },
      },
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.address).toBe("12 rue de la Paix, 75002 Paris");
    // The phone is NORMALISED (whitespace stripped, leading + kept).
    expect(tenant?.phone).toBe("+33123456789");
    expect(tenant?.acceptedModes).toEqual({
      delivery: true,
      clickAndCollect: false,
    });

    // One audit row for the multi-field call.
    const rows = await readAuditLog(t);
    const settings = rows.filter((r) => r.action === "tenant.updateSettings");
    expect(settings).toHaveLength(1);
  });

  it("empty patch is a no-op (no fields changed, no throw)", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: {},
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    // The base tenant fields survive untouched.
    expect(tenant?.slug).toBe("fuzz-a");
    expect(tenant?.name).toBe("Tenant A");
    expect(tenant?.address).toBeUndefined();
    expect(tenant?.phone).toBeUndefined();
    expect(tenant?.branding).toBeUndefined();
  });

  it("kb_admin (root override) can update settings on any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    await asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantB.tenantId,
      patch: { branding: { primaryColor: "#E5A100" } },
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantB.tenantId));
    expect(tenant?.branding).toEqual({ primaryColor: "#E5A100" });
  });
});

describe("B-TENANT-LIFECYCLE [3/4] tenant.updateSettings — validation", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("invalid hex throws INVALID_HEX_COLOR", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { branding: { primaryColor: "not-a-hex" } },
      }),
    ).rejects.toThrow(/INVALID_HEX_COLOR/);
  });

  it("empty address throws INVALID_ADDRESS", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { address: "   " },
      }),
    ).rejects.toThrow(/INVALID_ADDRESS/);
  });

  it("empty logoUrl throws INVALID_LOGO_URL", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { branding: { logoUrl: "" } },
      }),
    ).rejects.toThrow(/INVALID_LOGO_URL/);
  });

  it("invalid phone throws INVALID_PHONE", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { phone: "abc-not-a-number" },
      }),
    ).rejects.toThrow(/INVALID_PHONE/);
  });

  it("a failed validation does NOT persist any partial change (transactional)", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    // Mix a valid address with an invalid hex — the whole call must fail.
    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: {
          address: "Should not land",
          branding: { primaryColor: "#XYZ" },
        },
      }),
    ).rejects.toThrow();

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.address).toBeUndefined();
    expect(tenant?.branding).toBeUndefined();
  });
});

describe("B-TENANT-LIFECYCLE [3/4] tenant.updateSettings — cross-tenant fuzz", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("non-kb_manager actors on tenant A are refused (FORBIDDEN / UNAUTHENTICATED)", async () => {
    const actors = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.admin.tenantSettings.updateSettings],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors,
      // Args matching the validator (the auth gate fires BEFORE the handler).
      extraArgs: { patch: { branding: { primaryColor: "#1B7A3D" } } },
    });

    expect(leaks).toEqual([]);
    expect(pairs).toBe(actors.length);

    // No side effect leaked through.
    const tenantA = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenantA?.branding).toBeUndefined();
  });

  it("B's manager calling updateSettings for tenant A throws FORBIDDEN explicitly", async () => {
    const asBmgr = t.withIdentity({ subject: seed.tenantB.managerId });

    await expect(
      asBmgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { branding: { primaryColor: "#000000" } },
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("anonymous caller throws UNAUTHENTICATED explicitly", async () => {
    await expect(
      t.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { branding: { primaryColor: "#000000" } },
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });
});
