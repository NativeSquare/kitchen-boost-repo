import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/onboarding/, so normalise every key to be relative to the convex
// root (../../) so convex-test's findModulesRoot has ONE common prefix (same
// shape as the crm / pipeline / tenancy suites).
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
 * B-ONBOARDING-MILESTONES slice 3 (#189) — granular `setMilestone` mutation
 * with the auto-Closing bascule chained in the SAME transaction (cf. issue body
 * + parent #138). Written BEFORE the implementation (TDD red).
 *
 * Slice scope:
 *  - ONE `kbAdminMutation` `setMilestone({prospectId, milestoneKey, achieved?})`
 *    that flips a SINGLE binary milestone (set timestamp / clear / toggle) and
 *    chains `maybeAutoBascule` so the Acquisition → Préparation transition
 *    happens transactionally with the milestone write.
 *  - `milestoneKey` is the EXHAUSTIVE union of the 13 binary milestone keys
 *    (table/prospects.ts). Composite integration keys (`stripeConnect`,
 *    `uberDirect`, `hubrise`) are NOT accepted — those go through slice 4
 *    (`recordIntegrationStatus`).
 *  - The return shape is the enriched `{basculed, phase, closing}` triple from
 *    `maybeAutoBascule` (no second `evaluateClosing` round-trip).
 *
 * Audit: the `kbAdminMutation` wrapper auto-logs `prospect.milestone.set` once
 * per call (set OR clear OR toggle, Q70-Q2). The auto-bascule, when it fires,
 * is recorded by `maybeAutoBascule` itself with the explicit
 * `prospect.closing.autoBascule` row — both audits live in the same transaction
 * as the milestone write.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("B-ONBOARDING-MILESTONES slice 3 — setMilestone granular mutation (#189)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("sets the timestamp on a fresh prospect without touching other milestones", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Set Fresh",
      phone: "0600000100",
      source: "cold_call",
    });
    // Pre-seed one unrelated milestone we want to be sure stays put.
    const preExisting = 5_000;
    await asAdmin.mutation(api.lib.onboarding.crm.editProspect, {
      prospectId: id,
      patch: { milestones: { contratSigne: preExisting } },
    });

    const result = await asAdmin.mutation(
      api.lib.onboarding.milestones.setMilestone,
      {
        prospectId: id,
        milestoneKey: "kbisRecu",
        achieved: true,
      },
    );

    expect(result.basculed).toBe(false);
    // Closing is incomplete (still missing pieceIdentiteRecue + ribRecu).
    expect(result.closing.complete).toBe(false);

    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.milestones?.kbisRecu).toBeTypeOf("number");
    // Other milestones intact (pre-seeded contratSigne untouched).
    expect(p?.milestones?.contratSigne).toBe(preExisting);

    // The kbAdminMutation auto-audit row is present for this set call.
    const auditRows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "prospect.milestone.set"))
        .collect(),
    );
    expect(auditRows.length).toBe(1);
  });

  it("clears the timestamp when achieved=false without touching other milestones", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Clear",
      phone: "0600000101",
      source: "cold_call",
    });
    const now = Date.now();
    await asAdmin.mutation(api.lib.onboarding.crm.editProspect, {
      prospectId: id,
      patch: {
        milestones: {
          contratSigne: now,
          kbisRecu: now,
        },
      },
    });

    await asAdmin.mutation(api.lib.onboarding.milestones.setMilestone, {
      prospectId: id,
      milestoneKey: "kbisRecu",
      achieved: false,
    });

    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.milestones?.kbisRecu).toBeUndefined();
    // The unrelated milestone is intact.
    expect(p?.milestones?.contratSigne).toBe(now);
  });

  it("toggles when achieved is omitted (clear if present, set if absent)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Toggle",
      phone: "0600000102",
      source: "cold_call",
    });

    // 1st toggle: absent → set.
    await asAdmin.mutation(api.lib.onboarding.milestones.setMilestone, {
      prospectId: id,
      milestoneKey: "ribRecu",
    });
    let p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.milestones?.ribRecu).toBeTypeOf("number");

    // 2nd toggle: present → clear.
    await asAdmin.mutation(api.lib.onboarding.milestones.setMilestone, {
      prospectId: id,
      milestoneKey: "ribRecu",
    });
    p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.milestones?.ribRecu).toBeUndefined();
  });

  it("rejects a composite integration key at runtime (validator union exhaustive on binary keys only)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Bad Key",
      phone: "0600000103",
      source: "cold_call",
    });
    // Cast: TypeScript correctly refuses the literal; we need to reach runtime
    // validation explicitly, which is what we are asserting.
    await expect(
      asAdmin.mutation(api.lib.onboarding.milestones.setMilestone, {
        prospectId: id,
        milestoneKey: "stripeConnect" as never,
      }),
    ).rejects.toThrow();
  });

  it("rejects an unknown key at runtime", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Unknown",
      phone: "0600000104",
      source: "cold_call",
    });
    await expect(
      asAdmin.mutation(api.lib.onboarding.milestones.setMilestone, {
        prospectId: id,
        milestoneKey: "doesNotExist" as never,
      }),
    ).rejects.toThrow();
  });

  it("BYOD prospect: the 4th mandatory milestone triggers the auto-bascule + audit row", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "BYOD Close",
      phone: "0600000105",
      source: "cold_call",
      tabletteMode: "appareil_existant",
    });

    // 1st 3 calls — Closing still incomplete, no bascule.
    for (const key of [
      "contratSigne",
      "kbisRecu",
      "pieceIdentiteRecue",
    ] as const) {
      const r = await asAdmin.mutation(
        api.lib.onboarding.milestones.setMilestone,
        {
          prospectId: id,
          milestoneKey: key,
          achieved: true,
        },
      );
      expect(r.basculed).toBe(false);
      expect(r.phase).toBe("acquisition");
    }

    // 4th call — Closing completes, bascule fires.
    const result = await asAdmin.mutation(
      api.lib.onboarding.milestones.setMilestone,
      {
        prospectId: id,
        milestoneKey: "ribRecu",
        achieved: true,
      },
    );
    expect(result.basculed).toBe(true);
    expect(result.phase).toBe("preparation");
    expect(result.closing.complete).toBe(true);
    expect(result.closing.missing).toEqual([]);

    // The autoBascule audit row was written.
    const basculeRows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "prospect.closing.autoBascule"))
        .collect(),
    );
    expect(basculeRows.length).toBe(1);
    expect(basculeRows[0]?.targetId).toBe(id);

    // A 5th unrelated set on the now-Préparation prospect must NOT bascule again.
    const after = await asAdmin.mutation(
      api.lib.onboarding.milestones.setMilestone,
      {
        prospectId: id,
        milestoneKey: "premierContact",
        achieved: true,
      },
    );
    expect(after.basculed).toBe(false);
    expect(after.phase).toBe("preparation");
  });

  it("achat_kb prospect: the 4 mandatory are NOT enough — factureTablettePayee triggers the bascule", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Tablet Buyer",
      phone: "0600000106",
      source: "cold_call",
      tabletteMode: "achat_kb",
    });

    for (const key of [
      "contratSigne",
      "kbisRecu",
      "pieceIdentiteRecue",
      "ribRecu",
    ] as const) {
      const r = await asAdmin.mutation(
        api.lib.onboarding.milestones.setMilestone,
        {
          prospectId: id,
          milestoneKey: key,
          achieved: true,
        },
      );
      expect(r.basculed).toBe(false);
    }
    // The 4 mandatory aren't enough — the conditional invoice is still missing.
    const stillNot = await asAdmin.mutation(
      api.lib.onboarding.milestones.setMilestone,
      {
        prospectId: id,
        milestoneKey: "factureTabletteEmise",
        achieved: true,
      },
    );
    expect(stillNot.basculed).toBe(false);
    expect(stillNot.closing.complete).toBe(false);
    expect(stillNot.closing.missing).toEqual(["factureTablettePayee"]);

    // Pay the tablette invoice → Closing completes → bascule fires.
    const fired = await asAdmin.mutation(
      api.lib.onboarding.milestones.setMilestone,
      {
        prospectId: id,
        milestoneKey: "factureTablettePayee",
        achieved: true,
      },
    );
    expect(fired.basculed).toBe(true);
    expect(fired.phase).toBe("preparation");
  });

  it("no auto-bascule when the prospect is not in acquisition (manual changePhase first)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Manual Pre",
      phone: "0600000107",
      source: "cold_call",
    });
    // Manual move to installation (slice B bypass — fine for this test).
    await asAdmin.mutation(api.lib.onboarding.crm.changePhase, {
      prospectId: id,
      phase: "preparation",
    });
    await asAdmin.mutation(api.lib.onboarding.crm.changePhase, {
      prospectId: id,
      phase: "installation",
    });

    const result = await asAdmin.mutation(
      api.lib.onboarding.milestones.setMilestone,
      {
        prospectId: id,
        milestoneKey: "contratSigne",
        achieved: true,
      },
    );
    expect(result.basculed).toBe(false);
    expect(result.phase).toBe("installation");

    // And critically, no autoBascule audit row was added.
    const basculeRows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "prospect.closing.autoBascule"))
        .collect(),
    );
    expect(basculeRows.length).toBe(0);
  });

  it("clearing a milestone after the bascule does NOT roll the phase back to acquisition", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Bascule Then Uncheck",
      phone: "0600000108",
      source: "cold_call",
    });
    // Complete Closing → bascule.
    for (const key of [
      "contratSigne",
      "kbisRecu",
      "pieceIdentiteRecue",
      "ribRecu",
    ] as const) {
      await asAdmin.mutation(api.lib.onboarding.milestones.setMilestone, {
        prospectId: id,
        milestoneKey: key,
        achieved: true,
      });
    }
    let p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.phase).toBe("preparation");

    // Uncheck kbisRecu — the milestone is cleared but the phase stays preparation
    // (no auto-rollback; the bascule helper only fires from acquisition).
    const result = await asAdmin.mutation(
      api.lib.onboarding.milestones.setMilestone,
      {
        prospectId: id,
        milestoneKey: "kbisRecu",
        achieved: false,
      },
    );
    expect(result.basculed).toBe(false);
    expect(result.phase).toBe("preparation");

    p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.phase).toBe("preparation");
    expect(p?.milestones?.kbisRecu).toBeUndefined();
  });

  it("BYOD prospect: setting the non-applicable factureTablettePayee never triggers the bascule even with the 4 mandatory met", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Non Applicable",
      phone: "0600000109",
      source: "cold_call",
      tabletteMode: "appareil_existant",
    });
    // Set the conditional milestone FIRST — non-applicable for BYOD, must NOT
    // bascule (Closing isn't even reached: the 4 mandatory aren't set yet, and
    // the conditional key is dropped from the required set entirely for BYOD).
    const beforeMandatory = await asAdmin.mutation(
      api.lib.onboarding.milestones.setMilestone,
      {
        prospectId: id,
        milestoneKey: "factureTablettePayee",
        achieved: true,
      },
    );
    expect(beforeMandatory.basculed).toBe(false);
    // Closing.missing reflects requiredClosingMilestones (no tablette entry).
    expect(beforeMandatory.closing.missing).not.toContain(
      "factureTablettePayee",
    );

    // Then complete the 4 mandatory — the 4th must bascule on the mandatory only
    // (the prior non-applicable set is stored but irrelevant to the Closing set).
    for (const key of [
      "contratSigne",
      "kbisRecu",
      "pieceIdentiteRecue",
    ] as const) {
      const r = await asAdmin.mutation(
        api.lib.onboarding.milestones.setMilestone,
        {
          prospectId: id,
          milestoneKey: key,
          achieved: true,
        },
      );
      expect(r.basculed).toBe(false);
    }
    const last = await asAdmin.mutation(
      api.lib.onboarding.milestones.setMilestone,
      {
        prospectId: id,
        milestoneKey: "ribRecu",
        achieved: true,
      },
    );
    expect(last.basculed).toBe(true);
    expect(last.phase).toBe("preparation");
  });

  it("a milestone that does not complete Closing returns {complete: false, missing: [...]} without basculing", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Partial",
      phone: "0600000110",
      source: "cold_call",
    });
    const r = await asAdmin.mutation(
      api.lib.onboarding.milestones.setMilestone,
      {
        prospectId: id,
        milestoneKey: "premierContact",
        achieved: true,
      },
    );
    expect(r.basculed).toBe(false);
    expect(r.closing.complete).toBe(false);
    expect(r.closing.missing).toEqual(
      expect.arrayContaining([
        "contratSigne",
        "kbisRecu",
        "pieceIdentiteRecue",
        "ribRecu",
      ]),
    );
  });
});

describe("B-ONBOARDING-MILESTONES slice 3 — RBAC (#189): setMilestone is kb_admin-gated", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("no non-root actor can reach setMilestone (no leak)", async () => {
    const prospectId = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.onboarding.crm.createProspect, {
        name: "RBAC Probe",
        phone: "0600000200",
        source: "whatsapp",
      });

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.onboarding.milestones.setMilestone],
      isQuery: () => false,
      tenantId: undefined, // root function takes no tenantId
      actors: [
        { label: "A-manager", subject: seed.tenantA.managerId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "anonymous", subject: null },
      ],
      extraArgs: { prospectId, milestoneKey: "kbisRecu", achieved: true },
    });
    expect(pairs).toBe(5);
    expect(leaks).toEqual([]);
  });

  it("a kb_manager caller is rejected with Forbidden", async () => {
    const prospectId = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.onboarding.crm.createProspect, {
        name: "RBAC 2",
        phone: "0600000201",
        source: "whatsapp",
      });
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.onboarding.milestones.setMilestone, {
          prospectId,
          milestoneKey: "kbisRecu",
          achieved: true,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});
