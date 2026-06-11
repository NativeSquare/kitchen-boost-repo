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
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (key.startsWith("./")) key = `../../lib/admin/${key.slice(2)}`;
    else if (key.startsWith("../") && !key.startsWith("../../"))
      key = `../../lib/${key.slice(3)}`;
    return [key, loader];
  }),
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

  it("multi-field: { address 4-tuple, phone, acceptedModes } all land in one transaction", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: {
        // Address-first slice 1 (2026-06-11) — the 4-tuple travels together.
        address: "12 rue de la Paix, 75002 Paris",
        addressLat: 48.8696,
        addressLng: 2.3322,
        addressComponents: {
          streetAddress: "12 rue de la Paix",
          city: "Paris",
          zipCode: "75002",
          country: "FR",
        },
        phone: "+33 1 23 45 67 89",
        acceptedModes: { delivery: true, clickAndCollect: false },
      },
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.address).toBe("12 rue de la Paix, 75002 Paris");
    expect(tenant?.addressLat).toBe(48.8696);
    expect(tenant?.addressLng).toBe(2.3322);
    expect(tenant?.addressComponents).toEqual({
      streetAddress: "12 rue de la Paix",
      city: "Paris",
      zipCode: "75002",
      country: "FR",
    });
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

  // -------------------------------------------------------------------------
  // F-WIZARD [4/10] (#268) — `customDomain` patch support. The wizard step 2
  // form (« domaine personnalisé optionnel », modèle Owner.com) calls this
  // very mutation; the backend MUST accept + validate + persist the field.
  // -------------------------------------------------------------------------
  it("F-WIZARD [4/10] (#268): kb_admin patches customDomain → row reflects it (string)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    await asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: { customDomain: "commander.le-petit-bistrot.fr" },
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.customDomain).toBe("commander.le-petit-bistrot.fr");

    // Audit row written (the wrapper auto-audit fires once per call regardless
    // of which fields are in the patch).
    const rows = await readAuditLog(t);
    const row = rows.find((r) => r.action === "tenant.updateSettings");
    expect(row).toBeDefined();
  });

  it("F-WIZARD [4/10] (#268): customDomain is trimmed before persist", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    await asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: { customDomain: "  artisan.fr  " },
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.customDomain).toBe("artisan.fr");
  });

  it("F-WIZARD [4/10] (#268): patching customDomain leaves branding / address / phone untouched (shallow merge)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    // Seed an unrelated field first.
    await asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: { branding: { primaryColor: "#1B7A3D" } },
    });
    // Then patch ONLY customDomain.
    await asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: { customDomain: "artisan.fr" },
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.customDomain).toBe("artisan.fr");
    expect(tenant?.branding).toEqual({ primaryColor: "#1B7A3D" });
  });

  it("F-WIZARD [4/10] (#268): re-submitting an updated customDomain replaces the previous value", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: { customDomain: "first.fr" },
    });
    await asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: { customDomain: "second.fr" },
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.customDomain).toBe("second.fr");
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

  it("empty address (with the 4-tuple) throws INVALID_ADDRESS_PAYLOAD", async () => {
    // Address-first slice 1 (2026-06-11) — `address` no longer travels alone.
    // The 4-tuple all-or-nothing rule applies, and an empty / whitespace-only
    // display string is caught by `isValidAddressPayload`.
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: {
          address: "   ",
          addressLat: 48.8606,
          addressLng: 2.3376,
          addressComponents: {
            streetAddress: "1 Rue de Rivoli",
            city: "Paris",
            zipCode: "75001",
            country: "FR",
          },
        },
      }),
    ).rejects.toThrow(/INVALID_ADDRESS_PAYLOAD/);
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

    // Address-first slice 1 (2026-06-11): mix a valid full address 4-tuple
    // with an invalid hex — the whole call must fail (transactional).
    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: {
          address: "Should not land",
          addressLat: 48.8606,
          addressLng: 2.3376,
          addressComponents: {
            streetAddress: "Should not land",
            city: "Paris",
            zipCode: "75001",
            country: "FR",
          },
          branding: { primaryColor: "#XYZ" },
        },
      }),
    ).rejects.toThrow();

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.address).toBeUndefined();
    expect(tenant?.branding).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // F-WIZARD [4/10] (#268) — `customDomain` validation rejections. Same
  // regex as the front (single source of validation shape).
  // -------------------------------------------------------------------------
  it("F-WIZARD [4/10] (#268): invalid customDomain throws INVALID_CUSTOM_DOMAIN (no TLD)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { customDomain: "localhost" },
      }),
    ).rejects.toThrow(/INVALID_CUSTOM_DOMAIN/);
  });

  it("F-WIZARD [4/10] (#268): uppercase customDomain rejected", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { customDomain: "Artisan.fr" },
      }),
    ).rejects.toThrow(/INVALID_CUSTOM_DOMAIN/);
  });

  it("F-WIZARD [4/10] (#268): URL-shaped input rejected (no scheme / no path)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { customDomain: "https://artisan.fr" },
      }),
    ).rejects.toThrow(/INVALID_CUSTOM_DOMAIN/);
  });

  it("F-WIZARD [4/10] (#268): empty / whitespace-only customDomain rejected", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { customDomain: "   " },
      }),
    ).rejects.toThrow(/INVALID_CUSTOM_DOMAIN/);
  });

  it("F-WIZARD [4/10] (#268): a failed customDomain validation does NOT persist any partial change", async () => {
    // Address-first slice 1 (2026-06-11): combine a valid branding patch
    // with a bad customDomain — the whole call must fail and leave branding
    // untouched. (The previous shape mixed customDomain with a bare address;
    // since slice 1 forces the address 4-tuple, mixing in just a bare address
    // would fail FIRST with INVALID_ADDRESS_PAYLOAD — masking the
    // INVALID_CUSTOM_DOMAIN assertion this test cares about.)
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: {
          branding: { primaryColor: "#1B7A3D" },
          customDomain: "not-a-domain",
        },
      }),
    ).rejects.toThrow(/INVALID_CUSTOM_DOMAIN/);

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.branding).toBeUndefined();
    expect(tenant?.customDomain).toBeUndefined();
  });
});

// ===========================================================================
// Address-first slice 1 (2026-06-11) — the FULL structured address payload
// (display string + lat/lng + 4-component object) MUST travel together on
// `tenant.updateSettings`. The Uber Direct quote endpoint (commit 69699b3)
// refuses a quote without `pickup_address`; passing the structured JSON shape
// (`{street_address,city,zip_code,country}`) along with explicit lat/lng is
// the documented Uber-recommended path for accurate geocoding. The mutation
// MUST therefore enforce ALL-OR-NOTHING on the 4-tuple — a half-patch (e.g.
// address-only) would leave the row inconsistent and break the quote chain.
// ===========================================================================
describe("address-first slice 1 — updateSettings 4-tuple address payload", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  const VALID = {
    address: "1 Rue de Rivoli, 75001 Paris",
    addressLat: 48.8606,
    addressLng: 2.3376,
    addressComponents: {
      streetAddress: "1 Rue de Rivoli",
      city: "Paris",
      zipCode: "75001",
      country: "FR",
    },
  };

  it("kb_manager patches the full 4-tuple → all 4 fields persisted", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: VALID,
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.address).toBe(VALID.address);
    expect(tenant?.addressLat).toBe(VALID.addressLat);
    expect(tenant?.addressLng).toBe(VALID.addressLng);
    expect(tenant?.addressComponents).toEqual(VALID.addressComponents);
  });

  it("address-only patch (no lat/lng/components) is rejected (INVALID_ADDRESS_PAYLOAD)", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { address: "1 Rue de Rivoli, 75001 Paris" },
      }),
    ).rejects.toThrow(/INVALID_ADDRESS_PAYLOAD/);

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.address).toBeUndefined();
  });

  it("missing lat (only address + lng + components) is rejected", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: {
          address: VALID.address,
          addressLng: VALID.addressLng,
          addressComponents: VALID.addressComponents,
        },
      }),
    ).rejects.toThrow(/INVALID_ADDRESS_PAYLOAD/);
  });

  it("invalid zipCode in components throws INVALID_ADDRESS_PAYLOAD", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: {
          ...VALID,
          addressComponents: { ...VALID.addressComponents, zipCode: "7500" },
        },
      }),
    ).rejects.toThrow(/INVALID_ADDRESS_PAYLOAD/);

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.address).toBeUndefined();
  });

  it("patching other slots (branding / acceptedModes / phone) without address-tuple still works", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
      tenantId: seed.tenantA.tenantId,
      patch: {
        branding: { primaryColor: "#1B7A3D" },
        phone: "+33 6 12 34 56 78",
        acceptedModes: { delivery: true, clickAndCollect: true },
      },
    });

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.branding).toEqual({ primaryColor: "#1B7A3D" });
    expect(tenant?.phone).toBe("+33612345678");
    expect(tenant?.acceptedModes).toEqual({
      delivery: true,
      clickAndCollect: true,
    });
    // Address fields untouched.
    expect(tenant?.address).toBeUndefined();
    expect(tenant?.addressLat).toBeUndefined();
    expect(tenant?.addressLng).toBeUndefined();
    expect(tenant?.addressComponents).toBeUndefined();
  });

  it("a failed address validation does NOT persist any partial change", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    // Mix a valid branding patch with an invalid address (missing lat/lng).
    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: {
          branding: { primaryColor: "#1B7A3D" },
          address: "1 Rue de Rivoli, 75001 Paris",
        },
      }),
    ).rejects.toThrow();

    const tenant = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenant?.branding).toBeUndefined();
    expect(tenant?.address).toBeUndefined();
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

  // -------------------------------------------------------------------------
  // F-WIZARD [4/10] (#268) — cross-tenant fuzz on the customDomain patch
  // path. Same wrapper as the rest of `updateSettings`, but explicitly
  // exercise the new field so a future regression on validator wiring
  // (e.g. handler short-circuits BEFORE the auth gate) is caught.
  // -------------------------------------------------------------------------
  it("F-WIZARD [4/10] (#268): non-kb_manager actors patching customDomain are refused (no leak)", async () => {
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
      extraArgs: { patch: { customDomain: "leaky.fr" } },
    });

    expect(leaks).toEqual([]);
    expect(pairs).toBe(actors.length);

    const tenantA = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenantA?.customDomain).toBeUndefined();
  });

  it("F-WIZARD [4/10] (#268): B's manager cannot patch tenant A customDomain", async () => {
    const asBmgr = t.withIdentity({ subject: seed.tenantB.managerId });

    await expect(
      asBmgr.mutation(api.lib.admin.tenantSettings.updateSettings, {
        tenantId: seed.tenantA.tenantId,
        patch: { customDomain: "evil.fr" },
      }),
    ).rejects.toThrow(/forbidden/i);

    const tenantA = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenantA?.customDomain).toBeUndefined();
  });
});

// ===========================================================================
// B-TENANT-LIFECYCLE [4/4] — `tenant.activate` mutation (D6, PRD 70 §3.6 step 8),
// written BEFORE the implementation (TDD red).
//
// Wrapper: `kbAdminMutation({ action: "tenant.activate" })`. Root-only — never
// delegated to a kb_manager (activation is the KB Admin wizard step 8). Defers
// the transition guard to `assertLegalTenantTransition` from slice 2: only
// `pending → active` is legal in V1. Calling on a tenant that doesn't exist
// throws NOT_FOUND. Calling twice on an already-`active` tenant throws
// INVALID_STATE (non-idempotent V1, consistent with contracts lifecycle).
//
// Audit — DOUBLE LAYER mirroring `provisionTenant`:
//  - the wrapper auto-logs the root mutation
//  - the handler emits an EXPLICIT richer `logAudit` carrying
//    `metadata: { fromStatus: <previous status> }` for ops reconstruction.
//
// Acceptance criteria covered:
//  - happy path: pending → active, status persisted, audit row with
//    metadata.fromStatus === "pending"
//  - illegal transitions: active → active, suspended → active, disabled →
//    active all throw ConvexError({ code: "INVALID_STATE" })
//  - non-existent tenant: NOT_FOUND
//  - double-call: second activate on now-active tenant throws INVALID_STATE
//  - wrapper enforcement: kb_manager / staff / customer / detached / anonymous
//    are all refused (FORBIDDEN / UNAUTHENTICATED) via the cross-tenant fuzz
// ===========================================================================

/**
 * Helper — insert a fresh tenant in the requested lifecycle status, returning
 * its id. The fuzz seed creates `active` tenants only; `activate` tests need
 * `pending` / `suspended` / `disabled` source statuses.
 *
 * Address-first slice 3 (2026-06-11) — `tenant.activate` now gates on the FULL
 * 4-tuple address payload (`address` + `addressLat` + `addressLng` +
 * `addressComponents`). The default seed therefore pre-fills a sane Paris
 * address so the lifecycle / wrapper-enforcement tests below — which test
 * lifecycle / role gates, NOT the address gate — keep passing unchanged. The
 * dedicated address-gate tests below override `opts.address = "none"` /
 * `"display-only"` / `"missing-lat"` / `"missing-lng"` / `"missing-components"`
 * to exercise the new rejection branches.
 */
type AddressSeed =
  | "complete"
  | "none"
  | "display-only"
  | "missing-lat"
  | "missing-lng"
  | "missing-components";

async function insertTenantWithStatus(
  t: ReturnType<typeof convexTest>,
  slug: string,
  status: "pending" | "active" | "suspended" | "disabled",
  opts: { address?: AddressSeed } = {},
) {
  const addressSeed: AddressSeed = opts.address ?? "complete";
  const base = {
    slug,
    name: `Tenant ${slug}`,
    siret: `siret-${slug}`,
    status,
    createdAt: Date.now(),
  };
  return t.run((ctx) => {
    switch (addressSeed) {
      case "none":
        return ctx.db.insert("tenants", base);
      case "display-only":
        // Legacy pre-slice-1 row: display string only, no structured siblings.
        return ctx.db.insert("tenants", {
          ...base,
          address: "12 rue de Paris, 75001 Paris",
        });
      case "missing-lat":
        return ctx.db.insert("tenants", {
          ...base,
          address: "12 rue de Paris, 75001 Paris",
          addressLng: 2.3522,
          addressComponents: {
            streetAddress: "12 rue de Paris",
            city: "Paris",
            zipCode: "75001",
            country: "FR",
          },
        });
      case "missing-lng":
        return ctx.db.insert("tenants", {
          ...base,
          address: "12 rue de Paris, 75001 Paris",
          addressLat: 48.8566,
          addressComponents: {
            streetAddress: "12 rue de Paris",
            city: "Paris",
            zipCode: "75001",
            country: "FR",
          },
        });
      case "missing-components":
        return ctx.db.insert("tenants", {
          ...base,
          address: "12 rue de Paris, 75001 Paris",
          addressLat: 48.8566,
          addressLng: 2.3522,
        });
      case "complete":
      default:
        return ctx.db.insert("tenants", {
          ...base,
          address: "12 rue de Paris, 75001 Paris",
          addressLat: 48.8566,
          addressLng: 2.3522,
          addressComponents: {
            streetAddress: "12 rue de Paris",
            city: "Paris",
            zipCode: "75001",
            country: "FR",
          },
        });
    }
  });
}

describe("B-TENANT-LIFECYCLE [4/4] tenant.activate — happy path", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("kb_admin activates a pending tenant → status active, persisted in DB", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const pendingId = await insertTenantWithStatus(t, "pending-1", "pending");

    await asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
      tenantId: pendingId,
    });

    const tenant = await t.run((ctx) => ctx.db.get(pendingId));
    expect(tenant?.status).toBe("active");
  });

  it("emits an EXPLICIT audit row with metadata.fromStatus === 'pending'", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const pendingId = await insertTenantWithStatus(t, "pending-2", "pending");

    await asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
      tenantId: pendingId,
    });

    const rows = await readAuditLog(t);
    // Two audit rows on success: the wrapper's auto-log + the explicit richer
    // row. We assert on the explicit one (the only one carrying metadata).
    const explicit = rows.find(
      (r) =>
        r.action === "tenant.activate" &&
        r.metadata !== undefined &&
        r.metadata !== null,
    );
    expect(explicit).toBeDefined();
    expect(explicit?.actorUserId).toBe(seed.adminId);
    expect(explicit?.actorRole).toBe("kb_admin");
    expect(explicit?.tenantId).toBe(pendingId);
    expect(explicit?.targetType).toBe("tenant");
    expect(explicit?.targetId).toBe(pendingId);
    expect(explicit?.metadata).toEqual({ fromStatus: "pending" });
  });
});

describe("B-TENANT-LIFECYCLE [4/4] tenant.activate — guard rejections", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("active → active is rejected with INVALID_STATE", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const activeId = await insertTenantWithStatus(t, "active-1", "active");

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: activeId,
      }),
    ).rejects.toThrow(/INVALID_STATE/);

    const tenant = await t.run((ctx) => ctx.db.get(activeId));
    expect(tenant?.status).toBe("active");
  });

  it("suspended → active is rejected with INVALID_STATE (V1 strict)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const suspId = await insertTenantWithStatus(t, "susp-1", "suspended");

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: suspId,
      }),
    ).rejects.toThrow(/INVALID_STATE/);

    const tenant = await t.run((ctx) => ctx.db.get(suspId));
    expect(tenant?.status).toBe("suspended");
  });

  it("disabled → active is rejected with INVALID_STATE", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const disId = await insertTenantWithStatus(t, "dis-1", "disabled");

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: disId,
      }),
    ).rejects.toThrow(/INVALID_STATE/);

    const tenant = await t.run((ctx) => ctx.db.get(disId));
    expect(tenant?.status).toBe("disabled");
  });

  it("non-existent tenant throws NOT_FOUND", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // Insert + delete to obtain a syntactically-valid but absent tenant id.
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        slug: "ghost-activate",
        name: "Ghost",
        siret: "00000000000000",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: ghost,
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it("double-call: second activate on now-active tenant throws INVALID_STATE", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const pendingId = await insertTenantWithStatus(
      t,
      "pending-double",
      "pending",
    );

    // First call: legal pending → active.
    await asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
      tenantId: pendingId,
    });
    // Second call: active → active is now illegal.
    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: pendingId,
      }),
    ).rejects.toThrow(/INVALID_STATE/);
  });
});

describe("B-TENANT-LIFECYCLE [4/4] tenant.activate — wrapper enforcement (root-only)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("non-kb_admin actors are refused (FORBIDDEN / UNAUTHENTICATED)", async () => {
    const pendingId = await insertTenantWithStatus(
      t,
      "pending-fuzz",
      "pending",
    );

    const actors = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    // `kbAdminMutation` does NOT consume a `tenantId` arg via the wrapper — it
    // belongs to the handler's business args. Pass it via `extraArgs` and
    // disable the harness's auto-injection by passing `tenantId: undefined`.
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.admin.tenantSettings.activate],
      isQuery: () => false,
      tenantId: undefined,
      actors,
      extraArgs: { tenantId: pendingId },
    });

    expect(leaks).toEqual([]);
    expect(pairs).toBe(actors.length);

    // No side effect leaked through.
    const tenant = await t.run((ctx) => ctx.db.get(pendingId));
    expect(tenant?.status).toBe("pending");
  });

  it("kb_manager calling activate throws FORBIDDEN explicitly", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const pendingId = await insertTenantWithStatus(t, "pending-mgr", "pending");

    await expect(
      asMgr.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: pendingId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("anonymous caller throws UNAUTHENTICATED explicitly", async () => {
    const pendingId = await insertTenantWithStatus(
      t,
      "pending-anon",
      "pending",
    );

    await expect(
      t.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: pendingId,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });
});

// ===========================================================================
// Address-first slice 3 (2026-06-11) — `tenant.activate` address gate.
//
// PRD address-first « slice 3 » : a tenant CANNOT be activated without the
// FULL 4-tuple address payload (`address` + `addressLat` + `addressLng` +
// `addressComponents`). The PWA quote chain breaks on a `pickup_address`
// missing structured body — landing on `hors_zone` for every order — and the
// Wizard step 4 + Paramètres editor (slice 2) are already wired to force the
// 4-tuple on every write via the `INVALID_ADDRESS_PAYLOAD` guard. Slice 3
// extends the lifecycle gate so a legacy pre-slice-1 tenant (display string
// only) cannot be flipped to `active` either.
//
// The gate runs BEFORE `assertLegalTenantTransition` so the operator sees the
// address error FIRST (it's the actionable one — fix the address, retry; the
// transition is fixed by Convex on success). On a tenant that's also in an
// illegal source status (`active` / `suspended` / `disabled`) AND missing an
// address, the address error wins because it is the user-facing-actionable
// one. The transition check still runs once the address gate passes.
//
// Error code: `ConvexError({ code: "ACTIVATION_BLOCKED_NO_ADDRESS", message: ... })`.
// ===========================================================================
describe("B-TENANT-LIFECYCLE [4/4] + address-first slice 3 — activate address gate", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("tenant with NO address at all → throws ACTIVATION_BLOCKED_NO_ADDRESS", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const pendingId = await insertTenantWithStatus(t, "noaddr-1", "pending", {
      address: "none",
    });

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: pendingId,
      }),
    ).rejects.toThrow(/ACTIVATION_BLOCKED_NO_ADDRESS/);

    // Side-effect check: status stayed `pending` (the gate runs BEFORE
    // `activateTenant`, so no partial flip leaks through).
    const tenant = await t.run((ctx) => ctx.db.get(pendingId));
    expect(tenant?.status).toBe("pending");
  });

  it("LEGACY tenant (display string only, no lat/lng/components) → throws ACTIVATION_BLOCKED_NO_ADDRESS", async () => {
    // Pre-slice-1 row that survived migration: display address only, structured
    // siblings absent. The PWA quote chain would refuse this; the lifecycle
    // gate refuses too so the gérant fixes it via the Paramètres editor BEFORE
    // the resto goes live.
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const pendingId = await insertTenantWithStatus(t, "legacy-1", "pending", {
      address: "display-only",
    });

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: pendingId,
      }),
    ).rejects.toThrow(/ACTIVATION_BLOCKED_NO_ADDRESS/);
    const tenant = await t.run((ctx) => ctx.db.get(pendingId));
    expect(tenant?.status).toBe("pending");
  });

  it("missing `addressLat` only → throws ACTIVATION_BLOCKED_NO_ADDRESS", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const pendingId = await insertTenantWithStatus(t, "no-lat-1", "pending", {
      address: "missing-lat",
    });

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: pendingId,
      }),
    ).rejects.toThrow(/ACTIVATION_BLOCKED_NO_ADDRESS/);
  });

  it("missing `addressLng` only → throws ACTIVATION_BLOCKED_NO_ADDRESS", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const pendingId = await insertTenantWithStatus(t, "no-lng-1", "pending", {
      address: "missing-lng",
    });

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: pendingId,
      }),
    ).rejects.toThrow(/ACTIVATION_BLOCKED_NO_ADDRESS/);
  });

  it("missing `addressComponents` only → throws ACTIVATION_BLOCKED_NO_ADDRESS", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const pendingId = await insertTenantWithStatus(
      t,
      "no-components-1",
      "pending",
      { address: "missing-components" },
    );

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: pendingId,
      }),
    ).rejects.toThrow(/ACTIVATION_BLOCKED_NO_ADDRESS/);
  });

  it("complete 4-tuple address → activation succeeds (status flips to active)", async () => {
    // Regression cover: the new gate must NOT reject a fully-configured tenant.
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const pendingId = await insertTenantWithStatus(t, "full-addr-1", "pending");

    await asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
      tenantId: pendingId,
    });

    const tenant = await t.run((ctx) => ctx.db.get(pendingId));
    expect(tenant?.status).toBe("active");
  });

  it("address gate runs BEFORE the lifecycle gate — illegal source AND missing address surfaces the address error first", async () => {
    // A tenant that is BOTH already active (illegal `active → active` move)
    // AND missing the address shows the address error first — it's the
    // actionable one and the gate runs early.
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const activeNoAddr = await insertTenantWithStatus(
      t,
      "active-noaddr-1",
      "active",
      { address: "none" },
    );

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: activeNoAddr,
      }),
    ).rejects.toThrow(/ACTIVATION_BLOCKED_NO_ADDRESS/);
  });

  it("address gate does NOT short-circuit NOT_FOUND — a ghost tenant id still throws NOT_FOUND", async () => {
    // The address gate reads from the tenant row, so it can only run AFTER
    // the row is found. A ghost id still surfaces NOT_FOUND.
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        slug: "ghost-noaddr",
        name: "Ghost",
        siret: "00000000000000",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      asAdmin.mutation(api.lib.admin.tenantSettings.activate, {
        tenantId: ghost,
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });
});

// ---------------------------------------------------------------------------
// Stripe Connect a posteriori — `getStripeState` read query
// ---------------------------------------------------------------------------
describe("tenant.getStripeState — Stripe Connect a posteriori read", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("fresh tenant (no Stripe account) → both stripe fields are null + siret/name returned", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const state = await asMgr.query(
      api.lib.admin.tenantSettings.getStripeState,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(state.stripeAccountId).toBeNull();
    expect(state.stripeStatus).toBeNull();
    expect(state.siret).toBe("fuzz-a");
    expect(state.name).toBe("Tenant A");
  });

  it("stamped tenant (pending KYC) → reflects stripeAccountId + status", async () => {
    // Stamp the fields directly via the convex-test runtime (bypass the
    // cross-folder root mutation — keeps this suite self-contained).
    await t.run((ctx) =>
      ctx.db.patch(seed.tenantA.tenantId, {
        stripeAccountId: "acct_1AbCdEf",
        stripeStatus: "pending",
      }),
    );

    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const state = await asMgr.query(
      api.lib.admin.tenantSettings.getStripeState,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(state.stripeAccountId).toBe("acct_1AbCdEf");
    expect(state.stripeStatus).toBe("pending");
  });

  it("ready KYC → status reflects ready (webhook flip simulation)", async () => {
    await t.run((ctx) =>
      ctx.db.patch(seed.tenantA.tenantId, {
        stripeAccountId: "acct_ready",
        stripeStatus: "ready",
      }),
    );

    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const state = await asMgr.query(
      api.lib.admin.tenantSettings.getStripeState,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(state.stripeStatus).toBe("ready");
  });

  it("kb_admin (root override) can read state on any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const state = await asAdmin.query(
      api.lib.admin.tenantSettings.getStripeState,
      { tenantId: seed.tenantB.tenantId },
    );
    expect(state.name).toBe("Tenant B");
    expect(state.stripeAccountId).toBeNull();
  });

  it("a kb_manager from tenant B cannot read tenant A (cross-tenant MOAT)", async () => {
    const asBManager = t.withIdentity({ subject: seed.tenantB.managerId });
    await expect(
      asBManager.query(api.lib.admin.tenantSettings.getStripeState, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("anonymous caller throws UNAUTHENTICATED", async () => {
    await expect(
      t.query(api.lib.admin.tenantSettings.getStripeState, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("plain customer caller throws FORBIDDEN", async () => {
    const asCustomer = t.withIdentity({ subject: seed.customerId });
    await expect(
      asCustomer.query(api.lib.admin.tenantSettings.getStripeState, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });
});

// ---------------------------------------------------------------------------
// Uber Direct a posteriori — `getUberState` read query
// ---------------------------------------------------------------------------
describe("tenant.getUberState — Uber Direct a posteriori read", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("fresh tenant (no credentials, no customerId) → isConfigured:false + uberCustomerId:null", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const state = await asMgr.query(api.lib.admin.tenantSettings.getUberState, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(state.isConfigured).toBe(false);
    expect(state.uberCustomerId).toBeNull();
    expect(state.name).toBe("Tenant A");
  });

  it("tenant with credentials saved → isConfigured:true + uberCustomerId returned", async () => {
    // Use the real mutation so the encryption envelope is realistic AND the
    // `tenants.uberCustomerId` field is stamped via `setTenantUberCustomerId`.
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    await asMgr.mutation(api.lib.uberDirect.credentials.setUberCredentials, {
      tenantId: seed.tenantA.tenantId,
      credentials: {
        clientId: "cl_test",
        clientSecret: "sec_test",
        customerId: "cust_test_123",
      },
    });
    const state = await asMgr.query(api.lib.admin.tenantSettings.getUberState, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(state.isConfigured).toBe(true);
    expect(state.uberCustomerId).toBe("cust_test_123");
  });

  it("kb_admin (root override) can read state on any tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const state = await asAdmin.query(
      api.lib.admin.tenantSettings.getUberState,
      { tenantId: seed.tenantB.tenantId },
    );
    expect(state.name).toBe("Tenant B");
    expect(state.isConfigured).toBe(false);
  });

  it("a kb_manager from tenant B cannot read tenant A (cross-tenant MOAT)", async () => {
    const asBManager = t.withIdentity({ subject: seed.tenantB.managerId });
    await expect(
      asBManager.query(api.lib.admin.tenantSettings.getUberState, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("anonymous caller throws UNAUTHENTICATED", async () => {
    await expect(
      t.query(api.lib.admin.tenantSettings.getUberState, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("plain customer caller throws FORBIDDEN", async () => {
    const asCustomer = t.withIdentity({ subject: seed.customerId });
    await expect(
      asCustomer.query(api.lib.admin.tenantSettings.getUberState, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });
});
