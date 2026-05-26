import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/onboarding/, so normalise every key to be relative to the convex
// root (../../) so convex-test's findModulesRoot has ONE common prefix (same
// shape as the pricing / tenancy suites).
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

/**
 * 2.9-B — CRM KB CRUD over the KB-ADMIN-GLOBAL `prospects` table (PRD 70 §3.4,
 * kb-admin CONTEXT), written BEFORE the implementation (TDD red). Every function
 * goes through the ROOT wrappers (`kbAdminQuery` / `kbAdminMutation`): prospects
 * are KB's OWN sales pipeline, owned by the `kb_admin` role — no kb_manager /
 * staff / customer ever reads them. The table is reached ONLY through the
 * sanctioned `lib/tenancy/prospectsStore` seam, never raw `ctx.db.query(...)` in
 * this business module (`no-untenanted-query`, ADR 0010). Manual phase change +
 * CRUD only — the pipeline state machine (`evaluateClosing`) is slice C.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("2.9-B CRM CRUD — prospects via kb_admin root wrappers", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("creates a prospect (name/phone/source) defaulting to acquisition", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Malakoff Kebab",
      phone: "0612345678",
      source: "cold_call",
    });
    expect(id).toBeTypeOf("string");

    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.name).toBe("Malakoff Kebab");
    expect(p?.phase).toBe("acquisition");
    expect(p?.source).toBe("cold_call");
    expect(p?.score).toBeUndefined();
  });

  it("creates a prospect with the optional score + tabletteMode", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "L'Artisan",
      phone: "0700000000",
      source: "referral",
      score: 80,
      tabletteMode: "achat_kb",
    });
    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.score).toBe(80);
    expect(p?.tabletteMode).toBe("achat_kb");
  });

  it("edits a prospect's identity fields", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Old Name",
      phone: "0600000000",
      source: "whatsapp",
    });
    await asAdmin.mutation(api.lib.onboarding.crm.editProspect, {
      prospectId: id,
      patch: {
        name: "New Name",
        email: "contact@resto.fr",
        siret: "12345678900011",
        score: 42,
      },
    });
    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.name).toBe("New Name");
    expect(p?.email).toBe("contact@resto.fr");
    expect(p?.siret).toBe("12345678900011");
    expect(p?.score).toBe(42);
    // unchanged field preserved
    expect(p?.phone).toBe("0600000000");
  });

  it("logs an interaction appended to the prospect's history", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Talker",
      phone: "0600000000",
      source: "cold_call",
    });
    await asAdmin.mutation(api.lib.onboarding.crm.logInteraction, {
      prospectId: id,
      note: "Premier appel, intéressé",
      canal: "cold_call",
    });
    await asAdmin.mutation(api.lib.onboarding.crm.logInteraction, {
      prospectId: id,
      note: "RDV physique booké",
      canal: "visite_physique",
    });
    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.interactions?.length).toBe(2);
    expect(p?.interactions?.[0]?.note).toBe("Premier appel, intéressé");
    expect(p?.interactions?.[0]?.canal).toBe("cold_call");
    expect(p?.interactions?.[1]?.canal).toBe("visite_physique");
    expect(p?.interactions?.[1]?.date).toBeTypeOf("number");
  });

  it("changes phase when the target gate is satisfied (no bypass logged)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Ready",
      phone: "0600000000",
      source: "cold_call",
    });
    // Satisfy the Préparation gate (the Closing milestones, BYOD → no tablette).
    const now = Date.now();
    await asAdmin.mutation(api.lib.onboarding.crm.editProspect, {
      prospectId: id,
      patch: {
        milestones: {
          contratSigne: now,
          kbisRecu: now,
          pieceIdentiteRecue: now,
          ribRecu: now,
        },
      },
    });
    const result = await asAdmin.mutation(api.lib.onboarding.crm.changePhase, {
      prospectId: id,
      phase: "preparation",
    });
    expect(result.bypassed).toBe(false);
    expect(result.missing).toEqual([]);

    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.phase).toBe("preparation");
  });

  it("allows a phase change with a missing milestone but flags + logs the bypass", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Shortcut",
      phone: "0600000000",
      source: "cold_call",
    });
    // No Closing milestones at all → moving to preparation is a bypass.
    const result = await asAdmin.mutation(api.lib.onboarding.crm.changePhase, {
      prospectId: id,
      phase: "preparation",
    });
    expect(result.bypassed).toBe(true);
    expect(result.missing).toContain("contratSigne");
    expect(result.missing).toContain("kbisRecu");

    // The phase change is allowed (gates are indicative V1, Q70-Q10).
    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.phase).toBe("preparation");

    // A bypass audit row was recorded (audit via foundation).
    const bypassRows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "prospect.changePhase.bypass"))
        .collect(),
    );
    expect(bypassRows.length).toBe(1);
    expect(bypassRows[0]?.targetId).toBe(id);
    expect(
      (bypassRows[0]?.metadata as { missing?: string[] } | undefined)?.missing,
    ).toContain("contratSigne");
  });

  it("lists prospects and filters by phase", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const a = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Acq One",
      phone: "0600000001",
      source: "cold_call",
    });
    await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Acq Two",
      phone: "0600000002",
      source: "referral",
    });
    // Move one to preparation (bypass — fine for the filter test).
    await asAdmin.mutation(api.lib.onboarding.crm.changePhase, {
      prospectId: a,
      phase: "preparation",
    });

    const all = await asAdmin.query(api.lib.onboarding.crm.listProspects, {});
    expect(all.length).toBe(2);

    const acq = await asAdmin.query(api.lib.onboarding.crm.listProspects, {
      phase: "acquisition",
    });
    expect(acq.length).toBe(1);
    expect(acq[0]?.name).toBe("Acq Two");

    const prep = await asAdmin.query(api.lib.onboarding.crm.listProspects, {
      phase: "preparation",
    });
    expect(prep.length).toBe(1);
    expect(prep[0]?._id).toBe(a);
  });
});

/**
 * Root-only fuzz — `prospects` are KB-admin-GLOBAL (no `tenantId` scoping key),
 * so the relevant isolation property is that EVERY CRM function is ROOT-ONLY:
 * every non-root actor (manager / staff / plain customer / detached / anonymous)
 * must be rejected (Forbidden), no data leak (ADR 0010). Tenant-less functions
 * are fuzzed with `tenantId: undefined`.
 */
describe("2.9-B CRM root-only fuzz — every prospect function is kb_admin-gated", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("no non-root actor can reach any CRM function", async () => {
    // Seed one prospect (as root) so the read/mutate targets exist.
    const prospectId = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.onboarding.crm.createProspect, {
        name: "Gated",
        phone: "0600000000",
        source: "whatsapp",
      });

    const queries = [
      api.lib.onboarding.crm.listProspects,
      api.lib.onboarding.crm.getProspect,
    ];
    const mutations = [
      api.lib.onboarding.crm.createProspect,
      api.lib.onboarding.crm.editProspect,
      api.lib.onboarding.crm.logInteraction,
      api.lib.onboarding.crm.changePhase,
    ];
    const isQuery = (fn: unknown) => queries.includes(fn as never);

    const actors = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [...queries, ...mutations],
      isQuery,
      tenantId: undefined, // root functions take no tenantId
      actors,
      // Args that satisfy each function's validator (the gate fires BEFORE the
      // handler runs, so concrete values are only needed to pass arg validation).
      extraArgs: {
        prospectId,
        name: "x",
        phone: "0600000000",
        source: "cold_call",
        canal: "cold_call",
        note: "x",
        phase: "preparation",
        patch: {},
      },
    });
    expect(pairs).toBe(6 * actors.length);
    expect(leaks).toEqual([]);
  });

  it("a non-root caller is rejected with Forbidden", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .query(api.lib.onboarding.crm.listProspects, {}),
    ).rejects.toThrow(/forbidden/i);
  });
});
