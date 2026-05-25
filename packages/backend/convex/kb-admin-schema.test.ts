import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "./lib/tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives at
// the convex root, so the same-dir keys are already "./x" — no key normalisation
// is needed (unlike the suites nested under convex/lib/**).
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.*"]);

/**
 * 2.9-A — KB Admin backend schema (PRD 70 §3.3/§3.4/§3.5, kb-admin CONTEXT),
 * written BEFORE the implementation (TDD red). This slice ONLY lays the two
 * tables + their indexes and proves they round-trip through the sanctioned
 * `kbAdminQuery` / `kbAdminMutation` wrappers (root-only). No business logic
 * (contract generation #64, pipeline transitions, milestone toggles) — those are
 * later slices.
 *
 * Two tables (PRD 70 / kb-admin CONTEXT / ADR 0010):
 *  - `prospects` — KB's OWN sales / onboarding pipeline (a restaurant being
 *    prospected, NOT yet a signed `tenant`). KB-ADMIN-GLOBAL, NO `tenantId`
 *    scoping key — exactly like `customers`/`cgvVersions`, this is KB-owned data
 *    (the pipeline is "accessible côté rôle KB Admin uniquement", kb-admin
 *    CONTEXT), so it is reached through `kbAdminQuery/Mutation` (root), never raw
 *    `ctx.db.query("prospects")` in business code. The optional `tenantId` is a
 *    BACK-LINK set once the prospect is provisioned into a tenant, not a tenancy
 *    boundary.
 *  - `contracts` — the contract lifecycle of a prospect/tenant (KB-admin-global
 *    too). `prestation` A/B/A&B + dated `status` draft→sent→signed→expired.
 *
 * Because NEITHER table carries a `tenantId` scoping key, the cross-tenant fuzz
 * asserts the new root probes are ROOT-ONLY (no kb_manager / staff / customer /
 * anonymous leak) — the relevant isolation property for KB-global data.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("2.9-A schema — prospects + contracts (KB-admin-global)", () => {
  it("round-trips a FULL prospect row (all V1 fields incl. milestones + interactions)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.now();
      const prospectId = await ctx.db.insert("prospects", {
        name: "L'Artisan",
        siret: "12345678900011",
        address: "10 rue de Paris, 92240 Malakoff",
        contactName: "Yanis",
        email: "yanis@artisan.fr",
        phone: "0612345678",
        phase: "acquisition",
        source: "cold_call",
        score: 80,
        tabletteMode: "achat_kb",
        milestones: {
          contratSigne: now,
          kbisRecu: now,
          pieceIdentiteRecue: now,
          ribRecu: now,
          factureTabletteEmise: now,
          factureTablettePayee: now,
          stripeConnect: {
            current: "verified",
            history: [
              { status: "pending_kyc", at: now - 1000 },
              { status: "verified", at: now },
            ],
          },
          uberDirect: {
            current: "active",
            history: [{ status: "active", at: now }],
          },
          hubrise: { current: "not_configured", history: [] },
        },
        interactions: [
          { note: "Premier appel, intéressé", date: now, canal: "cold_call" },
          { note: "RDV physique booké", date: now, canal: "visite_physique" },
        ],
        createdAt: now,
        updatedAt: now,
      });

      const prospect = await ctx.db.get(prospectId);
      expect(prospect?.name).toBe("L'Artisan");
      expect(prospect?.phase).toBe("acquisition");
      expect(prospect?.source).toBe("cold_call");
      expect(prospect?.score).toBe(80);
      expect(prospect?.tabletteMode).toBe("achat_kb");
      // A binary milestone is just a timestamp (set = achieved).
      expect(prospect?.milestones?.contratSigne).toBe(now);
      // A composite integration milestone oscillates (current + dated history).
      expect(prospect?.milestones?.stripeConnect?.current).toBe("verified");
      expect(prospect?.milestones?.stripeConnect?.history?.length).toBe(2);
      expect(prospect?.interactions?.length).toBe(2);
      expect(prospect?.interactions?.[0]?.canal).toBe("cold_call");
      // No tenant yet — this is a prospect, not a tenant.
      expect(prospect?.tenantId).toBeUndefined();
    });
  });

  it("accepts a MINIMAL prospect (name + phone + phase + source + timestamps)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.now();
      const prospectId = await ctx.db.insert("prospects", {
        name: "La Table Libanaise",
        phone: "0700000000",
        phase: "acquisition",
        source: "referral",
        createdAt: now,
        updatedAt: now,
      });
      const p = await ctx.db.get(prospectId);
      expect(p?.name).toBe("La Table Libanaise");
      expect(p?.score).toBeUndefined();
      expect(p?.milestones).toBeUndefined();
    });
  });

  it("represents the oscillating composite milestone (pending → verified → rejected → pending)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.now();
      const prospectId = await ctx.db.insert("prospects", {
        name: "Oscillating",
        phone: "0600000000",
        phase: "preparation",
        source: "whatsapp",
        milestones: {
          stripeConnect: {
            current: "pending_kyc",
            history: [
              { status: "pending_kyc", at: now - 3000 },
              { status: "verified", at: now - 2000 },
              { status: "rejected", at: now - 1000 },
              { status: "pending_kyc", at: now },
            ],
          },
        },
        createdAt: now,
        updatedAt: now,
      });
      const p = await ctx.db.get(prospectId);
      expect(p?.milestones?.stripeConnect?.history?.length).toBe(4);
      expect(p?.milestones?.stripeConnect?.current).toBe("pending_kyc");
    });
  });

  it("exposes the prospects by_phase and by_tenant indexes", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.now();
      const tenantId = await ctx.db.insert("tenants", {
        slug: "buns-bao",
        name: "Buns & Bao",
        siret: "1",
        status: "active",
        createdAt: now,
      });
      const provisioned = await ctx.db.insert("prospects", {
        name: "Buns & Bao",
        phone: "0611111111",
        phase: "operationnel",
        source: "visite_physique",
        tenantId,
        createdAt: now,
        updatedAt: now,
      });

      const byPhase = await ctx.db
        .query("prospects")
        .withIndex("by_phase", (q) => q.eq("phase", "operationnel"))
        .collect();
      expect(byPhase.some((p) => p._id === provisioned)).toBe(true);

      const byTenant = await ctx.db
        .query("prospects")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .unique();
      expect(byTenant?._id).toBe(provisioned);
    });
  });

  it("round-trips a contract row and exposes by_prospect + by_tenant", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.now();
      const tenantId = await ctx.db.insert("tenants", {
        slug: "artisan",
        name: "L'Artisan",
        siret: "2",
        status: "pending",
        createdAt: now,
      });
      const prospectId = await ctx.db.insert("prospects", {
        name: "L'Artisan",
        phone: "0612345678",
        phase: "acquisition",
        source: "cold_call",
        createdAt: now,
        updatedAt: now,
      });
      const contractId = await ctx.db.insert("contracts", {
        prospectId,
        tenantId,
        prestation: "A_AND_B",
        status: "sent",
        statusUpdatedAt: now,
        htmlContent: "<html>Contrat de Licence de Marque…</html>",
        odooLink: "https://odoo.example.com/sign/abc",
        createdAt: now,
        updatedAt: now,
      });

      const contract = await ctx.db.get(contractId);
      expect(contract?.prestation).toBe("A_AND_B");
      expect(contract?.status).toBe("sent");
      expect(contract?.statusUpdatedAt).toBe(now);
      expect(contract?.htmlContent).toContain("Contrat");
      expect(contract?.odooLink).toContain("odoo");

      const byProspect = await ctx.db
        .query("contracts")
        .withIndex("by_prospect", (q) => q.eq("prospectId", prospectId))
        .collect();
      expect(byProspect.length).toBe(1);

      const byTenant = await ctx.db
        .query("contracts")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect();
      expect(byTenant.length).toBe(1);
    });
  });

  it("accepts a MINIMAL draft contract (prospect-linked, no tenant yet, no html)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const now = Date.now();
      const prospectId = await ctx.db.insert("prospects", {
        name: "Draft Co",
        phone: "0600000000",
        phase: "acquisition",
        source: "referral",
        createdAt: now,
        updatedAt: now,
      });
      const contractId = await ctx.db.insert("contracts", {
        prospectId,
        prestation: "B",
        status: "draft",
        statusUpdatedAt: now,
        createdAt: now,
        updatedAt: now,
      });
      const c = await ctx.db.get(contractId);
      expect(c?.status).toBe("draft");
      expect(c?.tenantId).toBeUndefined();
      expect(c?.htmlContent).toBeUndefined();
    });
  });
});

/**
 * Wrapper-proof — the access contract (acceptance criterion): a `prospects` /
 * `contracts` row is insertable + readable ONLY through a sanctioned root
 * wrapper. The probes live in `lib/tenancy/_probes.ts` (the exempt sanctioned
 * `ctx.db` path), built with `kbAdminMutation/Query` — there is NO raw
 * `ctx.db.query("prospects")` in business code.
 */
describe("2.9-A prospects + contracts reachable ONLY via sanctioned root wrappers", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("root (kb_admin) inserts then reads a prospect back via the wrapper", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await asAdmin.mutation(
      api.lib.tenancy._probes.adminCreateProspectProbe,
      { name: "Malakoff Kebab", phone: "0612345678", source: "cold_call" },
    );
    const got = await asAdmin.query(
      api.lib.tenancy._probes.adminGetProspectProbe,
      { prospectId },
    );
    expect(got?.name).toBe("Malakoff Kebab");
    expect(got?.phase).toBe("acquisition");
  });

  it("root (kb_admin) inserts then reads a contract back via the wrapper", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospectId = await asAdmin.mutation(
      api.lib.tenancy._probes.adminCreateProspectProbe,
      { name: "Contract Co", phone: "0600000000", source: "referral" },
    );
    const contractId = await asAdmin.mutation(
      api.lib.tenancy._probes.adminCreateContractProbe,
      { prospectId, prestation: "A" },
    );
    const got = await asAdmin.query(
      api.lib.tenancy._probes.adminGetContractProbe,
      { contractId },
    );
    expect(got?.prestation).toBe("A");
    expect(got?.status).toBe("draft");
  });

  it("a non-root caller cannot reach the prospect probes (kb_admin gate)", async () => {
    const prospectId = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.tenancy._probes.adminCreateProspectProbe, {
        name: "Gated",
        phone: "0600000000",
        source: "whatsapp",
      });
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .query(api.lib.tenancy._probes.adminGetProspectProbe, { prospectId }),
    ).rejects.toThrow(/forbidden/i);
  });
});

/**
 * Cross-tenant fuzz — `prospects` and `contracts` are KB-admin-GLOBAL (no
 * `tenantId` scoping key), so the relevant isolation property is that their root
 * probes are ROOT-ONLY: every non-root actor (manager / staff / plain customer /
 * detached / anonymous) must be rejected, no data leak (ADR 0010). Tenant-less
 * functions are fuzzed with `tenantId: undefined`.
 */
describe("2.9-A root-only fuzz — prospects + contracts probes (kb-admin-global)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("no non-root actor can list prospects / contracts via the root probes", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.tenancy._probes.adminListProspectsProbe,
        api.lib.tenancy._probes.adminListContractsProbe,
      ],
      isQuery: () => true,
      tenantId: undefined, // root probes take no tenantId
      actors: [
        { label: "A-manager", subject: seed.tenantA.managerId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(pairs).toBe(10);
    expect(leaks).toEqual([]);
  });

  it("the kb_admin (root) CAN list prospects + contracts", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const prospects = await asAdmin.query(
      api.lib.tenancy._probes.adminListProspectsProbe,
      {},
    );
    const contracts = await asAdmin.query(
      api.lib.tenancy._probes.adminListContractsProbe,
      {},
    );
    expect(Array.isArray(prospects)).toBe(true);
    expect(Array.isArray(contracts)).toBe(true);
  });
});
