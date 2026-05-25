import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";
import { sha256Hex } from "./cgv";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). Normalise the
// same-dir keys (../../lib/customer/) so findModulesRoot has ONE common prefix.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/customer/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.1-C — CGV versioned archival, written BEFORE the implementation (TDD red).
 *
 * `publishCgvVersion` (root via `kbAdminMutation`) creates a new CGV version
 * (`wording` + SHA-256 `hash` + `activatedAt`), closing the previous active one
 * (`endedAt`). INVARIANT: exactly one active version (no `endedAt`) at a time —
 * the CNIL-proof archive (ADR 0007). The REAL legal wording (Q90-Q1) is deferred
 * to legal and injected later through this very function; tests use a FIXTURE.
 *
 * The GLOBAL `cgvVersions` table is reached ONLY through the sanctioned tenancy
 * seam (never raw `ctx.db` in this business module, ADR 0010).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const FIXTURE_WORDING =
  "FIXTURE — En cliquant sur Payer, tu acceptes les CGV. Ta prochaine commande vaut nouvelle acceptation.";

/** Count the currently-active (no endedAt) CGV versions. */
async function countActive(t: ReturnType<typeof convexTest>): Promise<number> {
  return t.run(async (ctx) => {
    const all = await ctx.db.query("cgvVersions").collect();
    return all.filter((v) => v.endedAt === undefined).length;
  });
}

// ---------------------------------------------------------------------------
// sha256Hex — pure hashing helper.
// ---------------------------------------------------------------------------

describe("2.1-C sha256Hex — deterministic 64-hex SHA-256 of the wording", () => {
  it("returns a 64-char lowercase hex string", async () => {
    const hash = await sha256Hex(FIXTURE_WORDING);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic (same input → same hash)", async () => {
    expect(await sha256Hex(FIXTURE_WORDING)).toBe(
      await sha256Hex(FIXTURE_WORDING),
    );
  });

  it("differs for different wordings", async () => {
    expect(await sha256Hex("a")).not.toBe(await sha256Hex("b"));
  });

  it("matches a known SHA-256 vector (empty string)", async () => {
    // Well-known: SHA-256("") = e3b0c442...
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

// ---------------------------------------------------------------------------
// publishCgvVersion — root, one active version invariant.
// ---------------------------------------------------------------------------

describe("2.1-C publishCgvVersion — versioned archival, one active at a time", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("creates a version with wording, SHA-256 hash, activatedAt, and NO endedAt", async () => {
    const before = Date.now();
    const versionId = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.customer.cgv.publishCgvVersion, {
        wording: FIXTURE_WORDING,
      });

    const row = await t.run((ctx) => ctx.db.get(versionId));
    expect(row?.wording).toBe(FIXTURE_WORDING);
    expect(row?.hash).toBe(await sha256Hex(FIXTURE_WORDING));
    expect(typeof row?.activatedAt).toBe("number");
    expect(row?.activatedAt).toBeGreaterThanOrEqual(before);
    expect(row?.endedAt).toBeUndefined();
  });

  it("closes the previous active version (endedAt set) when a new one is published", async () => {
    const v1 = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.customer.cgv.publishCgvVersion, {
        wording: `${FIXTURE_WORDING} v1`,
      });
    const v2 = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.customer.cgv.publishCgvVersion, {
        wording: `${FIXTURE_WORDING} v2`,
      });

    const r1 = await t.run((ctx) => ctx.db.get(v1));
    const r2 = await t.run((ctx) => ctx.db.get(v2));
    expect(r1?.endedAt).toBeTypeOf("number");
    expect(r2?.endedAt).toBeUndefined();
  });

  it("INVARIANT: exactly one active version after any number of publishes", async () => {
    const as = t.withIdentity({ subject: seed.adminId });
    for (let i = 0; i < 4; i += 1) {
      await as.mutation(api.lib.customer.cgv.publishCgvVersion, {
        wording: `${FIXTURE_WORDING} v${i}`,
      });
    }
    expect(await countActive(t)).toBe(1);
  });

  it("returns a distinct hash for distinct wordings", async () => {
    const as = t.withIdentity({ subject: seed.adminId });
    const a = await as.mutation(api.lib.customer.cgv.publishCgvVersion, {
      wording: "wording A",
    });
    const b = await as.mutation(api.lib.customer.cgv.publishCgvVersion, {
      wording: "wording B",
    });
    const ra = await t.run((ctx) => ctx.db.get(a));
    const rb = await t.run((ctx) => ctx.db.get(b));
    expect(ra?.hash).not.toBe(rb?.hash);
  });
});

// ---------------------------------------------------------------------------
// Auth gate — root-only.
// ---------------------------------------------------------------------------

describe("2.1-C publishCgvVersion — root-only gate", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated for an anonymous caller", async () => {
    await expect(
      t.mutation(api.lib.customer.cgv.publishCgvVersion, {
        wording: FIXTURE_WORDING,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a plain customer (not root)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.customerId })
        .mutation(api.lib.customer.cgv.publishCgvVersion, {
          wording: FIXTURE_WORDING,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("throws Forbidden for a tenant manager (resto role, not root)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.customer.cgv.publishCgvVersion, {
          wording: FIXTURE_WORDING,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});

// ---------------------------------------------------------------------------
// Cross-tenant fuzz — replay publishCgvVersion with unauthorized actors.
// ---------------------------------------------------------------------------

describe("2.1-C cross-tenant fuzz — publishCgvVersion rejects every non-root actor", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("non-root actors cannot publish a CGV version", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.cgv.publishCgvVersion],
      isQuery: () => false,
      tenantId: undefined, // root mutation, no tenantId arg
      actors: [
        { label: "A-manager", subject: seed.tenantA.managerId },
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: { wording: FIXTURE_WORDING },
    });
    expect(pairs).toBe(4);
    expect(leaks).toEqual([]);
  });
});
