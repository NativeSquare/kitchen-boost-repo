import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  appendIntegrationStatus,
  getProspect,
  insertProspect,
  setMilestoneTimestamp,
} from "./prospectsStore";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/tenancy/, so normalise every key to be relative to the convex root
// (../../) so convex-test's findModulesRoot has ONE common prefix (same shape as
// the tenantsStore / menuStore suites alongside).
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
 * B-ONBOARDING-MILESTONES slice 1 (#163) — store seam for the upcoming granular
 * milestone mutations (`setMilestone` / `recordIntegrationStatus`, #138), written
 * BEFORE the implementation (TDD red).
 *
 * This slice introduces NO Convex function — we drive the seam helpers directly
 * via `t.run((ctx) => ...)`, exactly like the `tenantsStore.test.ts` /
 * `menuStore.test.ts` slice-1 suites (the lint exempts test files under `convex`
 * from `no-untenanted-query`).
 *
 * The pivot of #138 — « cocher un milestone précis NE DOIT PAS reconstruire
 * l'objet `milestones` entier ; recordIntegrationStatus est append-only sur
 * `history[]` » — est testé STRUCTURELLEMENT ici : la lecture-puis-patch atomique
 * du sous-objet `milestones` vit dans le store, le module métier reste mince.
 */

const seedProspect = async (
  t: ReturnType<typeof convexTest>,
): Promise<Id<"prospects">> =>
  t.run((ctx) =>
    insertProspect(ctx, {
      name: "Le Test Resto",
      phone: "+33600000001",
      source: "cold_call",
    }),
  );

describe("B-ONBOARDING-MILESTONES slice 1 — prospectsStore milestone seams (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;

  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  // ── setMilestoneTimestamp — binary milestones ────────────────────────────────

  it("setMilestoneTimestamp sets the timestamp on a single binary milestone (other milestones intact)", async () => {
    const prospectId = await seedProspect(t);
    // Pre-seed two other binary milestones so we can prove the patch is targeted.
    await t.run((ctx) =>
      setMilestoneTimestamp(
        ctx,
        prospectId,
        "premierContact",
        1_700_000_000_000,
      ),
    );
    await t.run((ctx) =>
      setMilestoneTimestamp(ctx, prospectId, "rdvBooke", 1_700_000_000_001),
    );

    await t.run((ctx) =>
      setMilestoneTimestamp(ctx, prospectId, "kbisRecu", 1_700_000_000_999),
    );

    const got = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(got?.milestones?.kbisRecu).toBe(1_700_000_000_999);
    // Other binary milestones untouched.
    expect(got?.milestones?.premierContact).toBe(1_700_000_000_000);
    expect(got?.milestones?.rdvBooke).toBe(1_700_000_000_001);
  });

  it("setMilestoneTimestamp with `undefined` clears the timestamp of a single binary milestone (others intact)", async () => {
    const prospectId = await seedProspect(t);
    await t.run((ctx) =>
      setMilestoneTimestamp(ctx, prospectId, "kbisRecu", 1_700_000_000_000),
    );
    await t.run((ctx) =>
      setMilestoneTimestamp(
        ctx,
        prospectId,
        "pieceIdentiteRecue",
        1_700_000_000_500,
      ),
    );

    await t.run((ctx) =>
      setMilestoneTimestamp(ctx, prospectId, "kbisRecu", undefined),
    );

    const got = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(got?.milestones?.kbisRecu).toBeUndefined();
    // The other milestone survives.
    expect(got?.milestones?.pieceIdentiteRecue).toBe(1_700_000_000_500);
  });

  it("setMilestoneTimestamp on a prospect with NO milestones object creates the sub-object with only the target key set", async () => {
    const prospectId = await seedProspect(t);
    // Sanity: fresh prospect has no milestones object.
    const before = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(before?.milestones).toBeUndefined();

    await t.run((ctx) =>
      setMilestoneTimestamp(ctx, prospectId, "contratSigne", 1_700_000_000_111),
    );

    const after = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(after?.milestones).toEqual({ contratSigne: 1_700_000_000_111 });
  });

  it("setMilestoneTimestamp does NOT touch composite integration milestones on the prospect", async () => {
    const prospectId = await seedProspect(t);
    // Seed an existing Stripe Connect milestone via the OTHER seam.
    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "stripeConnect",
        "pending_kyc",
        1_700_000_000_000,
      ),
    );

    await t.run((ctx) =>
      setMilestoneTimestamp(ctx, prospectId, "kbisRecu", 1_700_000_001_000),
    );

    const got = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(got?.milestones?.kbisRecu).toBe(1_700_000_001_000);
    expect(got?.milestones?.stripeConnect).toEqual({
      current: "pending_kyc",
      history: [{ status: "pending_kyc", at: 1_700_000_000_000 }],
    });
  });

  it("setMilestoneTimestamp bumps updatedAt on each call", async () => {
    const prospectId = await seedProspect(t);
    const before = await t.run((ctx) => getProspect(ctx, prospectId));
    const beforeUpdatedAt = before!.updatedAt;
    // Ensure clock advances enough — convex-test uses real wall-clock Date.now().
    await new Promise((r) => setTimeout(r, 5));

    await t.run((ctx) =>
      setMilestoneTimestamp(ctx, prospectId, "kbisRecu", 1_700_000_000_000),
    );

    const after = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(after!.updatedAt).toBeGreaterThan(beforeUpdatedAt);
  });

  it("setMilestoneTimestamp throws when the prospect does not exist", async () => {
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert("prospects", {
        name: "Ghost",
        phone: "+33600000099",
        phase: "acquisition" as const,
        source: "cold_call" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.run((ctx) =>
        setMilestoneTimestamp(ctx, ghost, "kbisRecu", 1_700_000_000_000),
      ),
    ).rejects.toThrow();
  });

  // ── appendIntegrationStatus — composite integration milestones ───────────────

  it("appendIntegrationStatus creates the integration sub-object on first call (current + 1-entry history)", async () => {
    const prospectId = await seedProspect(t);

    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "stripeConnect",
        "verified",
        1_700_000_000_000,
      ),
    );

    const got = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(got?.milestones?.stripeConnect).toEqual({
      current: "verified",
      history: [{ status: "verified", at: 1_700_000_000_000 }],
    });
  });

  it("appendIntegrationStatus successive calls append to history (append-only, order preserved)", async () => {
    const prospectId = await seedProspect(t);
    const at = (n: number) => 1_700_000_000_000 + n;

    // Oscillation pending_kyc → verified → rejected → pending_kyc → verified
    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "stripeConnect",
        "pending_kyc",
        at(1),
      ),
    );
    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "stripeConnect",
        "verified",
        at(2),
      ),
    );
    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "stripeConnect",
        "rejected",
        at(3),
      ),
    );
    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "stripeConnect",
        "pending_kyc",
        at(4),
      ),
    );
    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "stripeConnect",
        "verified",
        at(5),
      ),
    );

    const got = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(got?.milestones?.stripeConnect?.current).toBe("verified");
    expect(got?.milestones?.stripeConnect?.history).toEqual([
      { status: "pending_kyc", at: at(1) },
      { status: "verified", at: at(2) },
      { status: "rejected", at: at(3) },
      { status: "pending_kyc", at: at(4) },
      { status: "verified", at: at(5) },
    ]);
  });

  it("appendIntegrationStatus on `stripeConnect` does NOT touch `uberDirect` / `hubrise` / binary milestones", async () => {
    const prospectId = await seedProspect(t);
    // Pre-seed the other two integrations + a binary milestone.
    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "uberDirect",
        "pending_kyc",
        1_700_000_000_000,
      ),
    );
    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "hubrise",
        "configured",
        1_700_000_000_100,
      ),
    );
    await t.run((ctx) =>
      setMilestoneTimestamp(ctx, prospectId, "kbisRecu", 1_700_000_000_200),
    );

    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "stripeConnect",
        "verified",
        1_700_000_000_300,
      ),
    );

    const got = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(got?.milestones?.stripeConnect).toEqual({
      current: "verified",
      history: [{ status: "verified", at: 1_700_000_000_300 }],
    });
    // The other two integrations + the binary milestone survive untouched.
    expect(got?.milestones?.uberDirect).toEqual({
      current: "pending_kyc",
      history: [{ status: "pending_kyc", at: 1_700_000_000_000 }],
    });
    expect(got?.milestones?.hubrise).toEqual({
      current: "configured",
      history: [{ status: "configured", at: 1_700_000_000_100 }],
    });
    expect(got?.milestones?.kbisRecu).toBe(1_700_000_000_200);
  });

  it("appendIntegrationStatus works for `uberDirect` independently", async () => {
    const prospectId = await seedProspect(t);

    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "uberDirect",
        "active",
        1_700_000_500_000,
      ),
    );
    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "uberDirect",
        "failed",
        1_700_000_500_100,
      ),
    );

    const got = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(got?.milestones?.uberDirect).toEqual({
      current: "failed",
      history: [
        { status: "active", at: 1_700_000_500_000 },
        { status: "failed", at: 1_700_000_500_100 },
      ],
    });
  });

  it("appendIntegrationStatus works for `hubrise` independently", async () => {
    const prospectId = await seedProspect(t);

    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "hubrise",
        "configured",
        1_700_000_600_000,
      ),
    );
    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "hubrise",
        "active",
        1_700_000_600_100,
      ),
    );

    const got = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(got?.milestones?.hubrise).toEqual({
      current: "active",
      history: [
        { status: "configured", at: 1_700_000_600_000 },
        { status: "active", at: 1_700_000_600_100 },
      ],
    });
  });

  it("appendIntegrationStatus bumps updatedAt on each call", async () => {
    const prospectId = await seedProspect(t);
    const before = await t.run((ctx) => getProspect(ctx, prospectId));
    const beforeUpdatedAt = before!.updatedAt;
    await new Promise((r) => setTimeout(r, 5));

    await t.run((ctx) =>
      appendIntegrationStatus(
        ctx,
        prospectId,
        "stripeConnect",
        "pending_kyc",
        1_700_000_700_000,
      ),
    );

    const after = await t.run((ctx) => getProspect(ctx, prospectId));
    expect(after!.updatedAt).toBeGreaterThan(beforeUpdatedAt);
  });

  it("appendIntegrationStatus throws when the prospect does not exist", async () => {
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert("prospects", {
        name: "Ghost",
        phone: "+33600000099",
        phase: "acquisition" as const,
        source: "cold_call" as const,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      t.run((ctx) =>
        appendIntegrationStatus(
          ctx,
          ghost,
          "stripeConnect",
          "verified",
          1_700_000_000_000,
        ),
      ),
    ).rejects.toThrow();
  });
});
