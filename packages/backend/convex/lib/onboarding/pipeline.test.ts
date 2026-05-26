import { convexTest } from "convex-test";
import { ConvexError } from "convex/values";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";
import {
  PHASE_ORDER,
  assertLegalPhaseTransition,
  evaluateClosing,
  isLegalPhaseTransition,
} from "./pipeline";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/onboarding/, so normalise every key to be relative to the convex
// root (../../) so convex-test's findModulesRoot has ONE common prefix (same
// shape as the crm / pricing / tenancy suites).
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
 * 2.9-C — pipeline state machine + composite Closing auto-bascule (PRD 70 §3.3,
 * kb-admin CONTEXT "Closing" / "Phase pipeline"). Written BEFORE the
 * implementation (TDD red).
 *
 * `evaluateClosing` is a PURE function (input → result), testable in isolation;
 * the auto-bascule mutation wires it into a `kbAdminMutation` that persists the
 * Acquisition → Préparation transition. Phase transitions stay INDICATIVE in V1
 * (manual bypass from slice B is not regressed) — the auto-bascule is the ONLY
 * automatic transition, and it follows the ordered state machine.
 */

// A minimal prospect shaped like a Doc<"prospects"> for the PURE evaluator tests
// (no DB). Only the fields `evaluateClosing` reads matter; the rest satisfy the type.
function makeProspect(over: Partial<Doc<"prospects">> = {}): Doc<"prospects"> {
  const now = 1_000;
  return {
    _id: "prospect_fake" as Doc<"prospects">["_id"],
    _creationTime: now,
    name: "Fake Resto",
    phone: "0600000000",
    phase: "acquisition",
    source: "cold_call",
    createdAt: now,
    updatedAt: now,
    ...over,
  } as Doc<"prospects">;
}

/** All 4 mandatory NON-conditional Closing milestones, all achieved. */
const ALL_MANDATORY = {
  contratSigne: 1,
  kbisRecu: 1,
  pieceIdentiteRecue: 1,
  ribRecu: 1,
} as const;

describe("2.9-C evaluateClosing — pure composite Closing evaluator", () => {
  it("is complete when every mandatory milestone is achieved (BYOD, no tablette gate)", () => {
    const prospect = makeProspect({
      tabletteMode: "appareil_existant",
      milestones: { ...ALL_MANDATORY },
    });
    const result = evaluateClosing(prospect);
    expect(result.complete).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("is complete when tabletteMode is absent (no tablette gate either)", () => {
    const prospect = makeProspect({ milestones: { ...ALL_MANDATORY } });
    expect(evaluateClosing(prospect).complete).toBe(true);
  });

  it("is NOT complete when a mandatory milestone is missing, and reports it", () => {
    const prospect = makeProspect({
      milestones: {
        contratSigne: 1,
        kbisRecu: 1,
        pieceIdentiteRecue: 1,
        // ribRecu missing
      },
    });
    const result = evaluateClosing(prospect);
    expect(result.complete).toBe(false);
    expect(result.missing).toContain("ribRecu");
    expect(result.missing).not.toContain("contratSigne");
  });

  it("is NOT complete for a fresh prospect with no milestones at all", () => {
    const result = evaluateClosing(makeProspect());
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(
      expect.arrayContaining([
        "contratSigne",
        "kbisRecu",
        "pieceIdentiteRecue",
        "ribRecu",
      ]),
    );
  });

  it("conditional-tablette TRUE: achat_kb requires factureTablettePayee", () => {
    // All mandatory met, but tablette bought from KB and the invoice not paid.
    const prospect = makeProspect({
      tabletteMode: "achat_kb",
      milestones: { ...ALL_MANDATORY },
    });
    const result = evaluateClosing(prospect);
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual(["factureTablettePayee"]);
  });

  it("conditional-tablette TRUE satisfied: achat_kb with the invoice paid is complete", () => {
    const prospect = makeProspect({
      tabletteMode: "achat_kb",
      milestones: { ...ALL_MANDATORY, factureTablettePayee: 1 },
    });
    expect(evaluateClosing(prospect).complete).toBe(true);
  });

  it("conditional-tablette FALSE: a non-achat_kb mode never blocks on the invoice", () => {
    const prospect = makeProspect({
      tabletteMode: "appareil_existant",
      // mandatory met, factureTablettePayee deliberately absent
      milestones: { ...ALL_MANDATORY },
    });
    const result = evaluateClosing(prospect);
    expect(result.complete).toBe(true);
    expect(result.missing).not.toContain("factureTablettePayee");
  });
});

describe("2.9-C pipeline state machine — ordered phase transitions", () => {
  it("declares the canonical phase order Acquisition → Préparation → Installation → Opérationnel", () => {
    expect(PHASE_ORDER).toEqual([
      "acquisition",
      "preparation",
      "installation",
      "operationnel",
    ]);
  });

  it("allows each forward step", () => {
    expect(isLegalPhaseTransition("acquisition", "preparation")).toBe(true);
    expect(isLegalPhaseTransition("preparation", "installation")).toBe(true);
    expect(isLegalPhaseTransition("installation", "operationnel")).toBe(true);
  });

  it("rejects a skip-ahead, a backward step, and a self-loop", () => {
    expect(isLegalPhaseTransition("acquisition", "installation")).toBe(false);
    expect(isLegalPhaseTransition("preparation", "acquisition")).toBe(false);
    expect(isLegalPhaseTransition("acquisition", "acquisition")).toBe(false);
    expect(isLegalPhaseTransition("operationnel", "installation")).toBe(false);
  });

  it("assertLegalPhaseTransition throws INVALID_STATE on an illegal edge", () => {
    expect(() =>
      assertLegalPhaseTransition("acquisition", "installation"),
    ).toThrow(ConvexError);
  });

  it("assertLegalPhaseTransition passes on a legal edge", () => {
    expect(() =>
      assertLegalPhaseTransition("acquisition", "preparation"),
    ).not.toThrow();
  });
});

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("2.9-C auto-bascule — applyClosing kbAdminMutation (root, audited)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("auto-advances an acquisition prospect to preparation once Closing is complete", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Ready To Close",
      phone: "0600000000",
      source: "cold_call",
    });
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

    const result = await asAdmin.mutation(
      api.lib.onboarding.pipeline.applyClosing,
      { prospectId: id },
    );
    expect(result.basculed).toBe(true);
    expect(result.phase).toBe("preparation");

    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.phase).toBe("preparation");
  });

  it("does NOT auto-advance when a mandatory Closing milestone is missing", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Not Yet",
      phone: "0600000001",
      source: "cold_call",
    });
    const now = Date.now();
    await asAdmin.mutation(api.lib.onboarding.crm.editProspect, {
      prospectId: id,
      patch: {
        milestones: {
          contratSigne: now,
          kbisRecu: now,
          pieceIdentiteRecue: now,
        },
      },
    });

    const result = await asAdmin.mutation(
      api.lib.onboarding.pipeline.applyClosing,
      { prospectId: id },
    );
    expect(result.basculed).toBe(false);
    expect(result.missing).toContain("ribRecu");

    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.phase).toBe("acquisition");
  });

  it("conditional-tablette: achat_kb blocks the auto-bascule until the invoice is paid", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Tablet Buyer",
      phone: "0600000002",
      source: "cold_call",
      tabletteMode: "achat_kb",
    });
    const now = Date.now();
    // All mandatory met, invoice NOT paid yet.
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
    let result = await asAdmin.mutation(
      api.lib.onboarding.pipeline.applyClosing,
      { prospectId: id },
    );
    expect(result.basculed).toBe(false);
    expect(result.missing).toContain("factureTablettePayee");

    // Pay the invoice → now Closing completes → bascule fires.
    await asAdmin.mutation(api.lib.onboarding.crm.editProspect, {
      prospectId: id,
      patch: {
        milestones: {
          contratSigne: now,
          kbisRecu: now,
          pieceIdentiteRecue: now,
          ribRecu: now,
          factureTablettePayee: now,
        },
      },
    });
    result = await asAdmin.mutation(api.lib.onboarding.pipeline.applyClosing, {
      prospectId: id,
    });
    expect(result.basculed).toBe(true);
    expect(result.phase).toBe("preparation");
  });

  it("is a no-op when the prospect is already past Acquisition (state machine guards the only edge)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Already Moved",
      phone: "0600000003",
      source: "cold_call",
    });
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
    // Manually move it to installation (bypass — slice B still works).
    await asAdmin.mutation(api.lib.onboarding.crm.changePhase, {
      prospectId: id,
      phase: "installation",
    });

    const result = await asAdmin.mutation(
      api.lib.onboarding.pipeline.applyClosing,
      { prospectId: id },
    );
    // Closing milestones ARE complete, but the prospect is no longer in
    // acquisition → the only auto edge does not apply → no bascule.
    expect(result.basculed).toBe(false);

    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.phase).toBe("installation");
  });

  it("records an audit row for an actual auto-bascule", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Audited Close",
      phone: "0600000004",
      source: "cold_call",
    });
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
    await asAdmin.mutation(api.lib.onboarding.pipeline.applyClosing, {
      prospectId: id,
    });

    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "prospect.closing.autoBascule"))
        .collect(),
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.targetId).toBe(id);
    expect(
      (rows[0]?.metadata as { toPhase?: string } | undefined)?.toPhase,
    ).toBe("preparation");
  });

  it("manual changePhase bypass is NOT regressed (slice B behaviour preserved)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const id = await asAdmin.mutation(api.lib.onboarding.crm.createProspect, {
      name: "Manual Bypass",
      phone: "0600000005",
      source: "cold_call",
    });
    // No milestones at all → manual move is still allowed (indicative, Q70-Q10).
    const result = await asAdmin.mutation(api.lib.onboarding.crm.changePhase, {
      prospectId: id,
      phase: "preparation",
    });
    expect(result.bypassed).toBe(true);
    const p = await asAdmin.query(api.lib.onboarding.crm.getProspect, {
      prospectId: id,
    });
    expect(p?.phase).toBe("preparation");
  });
});

describe("2.9-C auto-bascule root-only — applyClosing is kb_admin-gated", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("no non-root actor can reach applyClosing (no leak)", async () => {
    const prospectId = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.onboarding.crm.createProspect, {
        name: "Gated",
        phone: "0600000000",
        source: "whatsapp",
      });

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.onboarding.pipeline.applyClosing],
      isQuery: () => false,
      tenantId: undefined, // root function takes no tenantId
      actors: [
        { label: "A-manager", subject: seed.tenantA.managerId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "anonymous", subject: null },
      ],
      extraArgs: { prospectId },
    });
    expect(pairs).toBe(5);
    expect(leaks).toEqual([]);
  });

  it("a non-root caller is rejected with Forbidden", async () => {
    const prospectId = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.onboarding.crm.createProspect, {
        name: "Gated2",
        phone: "0600000001",
        source: "whatsapp",
      });
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.onboarding.pipeline.applyClosing, { prospectId }),
    ).rejects.toThrow(/forbidden/i);
  });
});
