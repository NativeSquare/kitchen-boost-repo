import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";
import {
  type TenantMissingAddressRow,
  findTenantsMissingAddress,
} from "./addressAudit";

/**
 * Address-first slice 4 (2026-06-11) — audit existing already-`active` tenants
 * whose 4-tuple (`address` + `addressLat` + `addressLng` + `addressComponents`)
 * is incomplete. Slices 1-3 ensured that any NEW activation requires the
 * 4-tuple (mutation `tenant.updateSettings` enforces all-or-nothing,
 * `tenant.activate` throws `ACTIVATION_BLOCKED_NO_ADDRESS`). Slice 4 surfaces
 * the LEGACY tenants that slipped through BEFORE the gate landed, so ops can
 * contact them and have a manager re-save the address via the new editor.
 *
 * NO migration-by-code (impossible without Google Places server-side) — just
 * audit + tracking. Written BEFORE the implementation (TDD red).
 *
 * Two callers:
 *  - `auditTenantsWithMissingAddress` (internalQuery) — system-side, for cron
 *    or ops scripts; never exposed publicly.
 *  - `listTenantsWithMissingAddress` (`kbAdminQuery`) — root-only public
 *    surface for the KB Admin monitoring UI. Any non-root actor is refused
 *    by the wrapper BEFORE the handler runs (ADR 0010 root-only fuzz).
 *
 * Both return the same `TenantMissingAddressRow[]` projection — the pure
 * `findTenantsMissingAddress` aggregator is unit-tested separately.
 */

// convex-test needs the function modules; array-negation glob form is required
// (project memory). Normalise every key relative to the convex root.
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

const COMPLETE_ADDRESS = {
  address: "12 rue de Paris, 75001 Paris",
  addressLat: 48.8566,
  addressLng: 2.3522,
  addressComponents: {
    streetAddress: "12 rue de Paris",
    city: "Paris",
    zipCode: "75001",
    country: "FR",
  },
} as const;

// ---------------------------------------------------------------------------
// Pure detector — `findTenantsMissingAddress`
// ---------------------------------------------------------------------------

describe("address slice 4 — findTenantsMissingAddress (pure)", () => {
  const NOW = Date.UTC(2026, 5, 11, 12, 0, 0); // 2026-06-11

  const baseActiveTenant = (
    overrides: Partial<Doc<"tenants">>,
  ): Doc<"tenants"> =>
    ({
      _id: "t_x" as unknown as Id<"tenants">,
      _creationTime: NOW,
      slug: "x",
      name: "Resto X",
      siret: "siret-x",
      status: "active",
      createdAt: NOW,
      ...overrides,
    }) as Doc<"tenants">;

  it("flags an active tenant with NO address at all (legacy pre-slice-1)", () => {
    const tenants = [baseActiveTenant({ slug: "legacy", name: "Legacy" })];
    const rows = findTenantsMissingAddress(tenants);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: "legacy",
      name: "Legacy",
      status: "active",
      missingAddress: true,
      missingLat: true,
      missingLng: true,
      missingComponents: true,
    });
  });

  it("flags an active tenant with display string only (legacy pre-slice-1)", () => {
    const tenants = [
      baseActiveTenant({
        slug: "display-only",
        name: "Display Only",
        address: "12 rue de Paris",
      }),
    ];
    const rows = findTenantsMissingAddress(tenants);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: "display-only",
      missingAddress: false,
      missingLat: true,
      missingLng: true,
      missingComponents: true,
    });
  });

  it("flags an active tenant missing only the components (partial migration)", () => {
    const tenants = [
      baseActiveTenant({
        slug: "no-components",
        name: "No Components",
        address: "12 rue de Paris",
        addressLat: 48.8566,
        addressLng: 2.3522,
      }),
    ];
    const rows = findTenantsMissingAddress(tenants);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      slug: "no-components",
      missingAddress: false,
      missingLat: false,
      missingLng: false,
      missingComponents: true,
    });
  });

  it("EXCLUDES an active tenant with the full 4-tuple", () => {
    const tenants = [
      baseActiveTenant({
        slug: "ok",
        name: "OK",
        ...COMPLETE_ADDRESS,
      }),
    ];
    expect(findTenantsMissingAddress(tenants)).toEqual([]);
  });

  it("EXCLUDES non-active tenants even when their address is missing", () => {
    // A `pending` tenant is still in the wizard — slice 3 prevents activation.
    // A `suspended` / `disabled` tenant is out-of-service; ops doesn't need a
    // nudge to re-save its address (it can't take orders anyway). Only ACTIVE
    // tenants are actionable for this migration sweep.
    const tenants = [
      baseActiveTenant({
        slug: "pending",
        name: "Pending",
        status: "pending",
      }),
      baseActiveTenant({
        slug: "suspended",
        name: "Suspended",
        status: "suspended",
      }),
      baseActiveTenant({
        slug: "disabled",
        name: "Disabled",
        status: "disabled",
      }),
    ];
    expect(findTenantsMissingAddress(tenants)).toEqual([]);
  });

  it("returns rows sorted alphabetically by name (stable UI order)", () => {
    const tenants = [
      baseActiveTenant({ slug: "b", name: "Zorro" }),
      baseActiveTenant({ slug: "a", name: "Alpha" }),
      baseActiveTenant({ slug: "c", name: "Middle" }),
    ];
    const rows = findTenantsMissingAddress(tenants);
    expect(rows.map((r) => r.name)).toEqual(["Alpha", "Middle", "Zorro"]);
  });

  it("returns [] when no tenant is active", () => {
    expect(findTenantsMissingAddress([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `listTenantsWithMissingAddress` — kb_admin public surface
// ---------------------------------------------------------------------------

async function insertActiveTenant(
  t: ReturnType<typeof convexTest>,
  slug: string,
  opts: { address?: "complete" | "none" | "display-only" } = {},
): Promise<Id<"tenants">> {
  const seed = opts.address ?? "none";
  return t.run((ctx) => {
    const base = {
      slug,
      name: `Tenant ${slug}`,
      siret: `siret-${slug}`,
      status: "active" as const,
      createdAt: Date.now(),
    };
    switch (seed) {
      case "complete":
        return ctx.db.insert("tenants", { ...base, ...COMPLETE_ADDRESS });
      case "display-only":
        return ctx.db.insert("tenants", {
          ...base,
          address: "12 rue de Paris",
        });
      case "none":
      default:
        return ctx.db.insert("tenants", base);
    }
  });
}

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("address slice 4 — listTenantsWithMissingAddress (kbAdminQuery)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("kb_admin sees every active tenant missing the 4-tuple, complete ones excluded", async () => {
    const incompleteId = await insertActiveTenant(t, "legacy-incomplete", {
      address: "display-only",
    });
    await insertActiveTenant(t, "ok-complete", { address: "complete" });

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const rows: TenantMissingAddressRow[] = await asAdmin.query(
      api.lib.admin.addressAudit.listTenantsWithMissingAddress,
      {},
    );
    const slugs = rows.map((r) => r.slug);
    // The fuzz seed creates two already-active tenants WITHOUT address
    // (`seedTwoTenantsAllRoles`); they must show up too. The complete one
    // never does.
    expect(slugs).toContain("legacy-incomplete");
    expect(slugs).not.toContain("ok-complete");
    const legacy = rows.find((r) => r._id === incompleteId);
    expect(legacy).toBeDefined();
    expect(legacy?.missingLat).toBe(true);
    expect(legacy?.missingComponents).toBe(true);
  });

  it("returns [] when every active tenant has the complete 4-tuple", async () => {
    // Patch the fuzz seed tenants so they pass the audit, then assert empty.
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, COMPLETE_ADDRESS);
      await ctx.db.patch(seed.tenantB.tenantId, COMPLETE_ADDRESS);
    });
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const rows = await asAdmin.query(
      api.lib.admin.addressAudit.listTenantsWithMissingAddress,
      {},
    );
    expect(rows).toEqual([]);
  });
});

describe("address slice 4 — listTenantsWithMissingAddress root-only fuzz", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("no non-root actor can read the address audit", async () => {
    const queries = [api.lib.admin.addressAudit.listTenantsWithMissingAddress];
    const actors = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: queries,
      isQuery: () => true,
      tenantId: undefined,
      actors,
    });
    expect(pairs).toBe(queries.length * actors.length);
    expect(leaks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// `auditTenantsWithMissingAddress` — internal-only system surface
// ---------------------------------------------------------------------------

describe("address slice 4 — auditTenantsWithMissingAddress (internalQuery)", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    await seedTwoTenantsAllRoles(t);
  });

  it("returns the same projection as the public surface", async () => {
    await insertActiveTenant(t, "audit-legacy", { address: "display-only" });

    const rows: TenantMissingAddressRow[] = await t.query(
      internal.lib.admin.addressAudit.auditTenantsWithMissingAddress,
      {},
    );
    const slugs = rows.map((r) => r.slug);
    expect(slugs).toContain("audit-legacy");
    const row = rows.find((r) => r.slug === "audit-legacy");
    expect(row).toMatchObject({
      missingAddress: false,
      missingLat: true,
      missingLng: true,
      missingComponents: true,
    });
  });

  it("excludes pending / suspended / disabled tenants (only active is actionable)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("tenants", {
        slug: "pending-no-addr",
        name: "Pending",
        siret: "siret-p",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.insert("tenants", {
        slug: "suspended-no-addr",
        name: "Suspended",
        siret: "siret-s",
        status: "suspended",
        createdAt: Date.now(),
      });
    });
    const rows = await t.query(
      internal.lib.admin.addressAudit.auditTenantsWithMissingAddress,
      {},
    );
    const slugs = rows.map((r) => r.slug);
    expect(slugs).not.toContain("pending-no-addr");
    expect(slugs).not.toContain("suspended-no-addr");
  });
});
