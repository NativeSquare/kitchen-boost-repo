import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * #394 — `app` module tests (PRD 20 §13 + ADR 0017 « couche native »).
 *
 * Pins the contract of the SINGLE public entry point the native force-update
 * gate hits at boot — `app.minBuildVersion()` — and of its sister mutation
 * `app.setMinBuildVersion()` that KB ops uses to react to a CVE on the binary.
 *
 * Three properties pinned here:
 *
 *  - **Public read** — `minBuildVersion()` is callable WITHOUT auth (the gate
 *    runs BEFORE login on a freshly opened app, ADR 0017). Returns a safe
 *    default `1` when no row exists yet, the configured value otherwise.
 *  - **kb_admin write** — only the global root role can flip the value (kb
 *    managers, staff, customers, unauth callers are rejected). Mirrors the
 *    `kbAdminMutation` gate.
 *  - **Validation** — invalid values (< 1, non-integer) are rejected; the
 *    singleton stays at most ONE row across reseeds (no duplicate insert).
 */

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/app/${path.slice(2)}` : path,
    loader,
  ]),
);

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("#394 app.minBuildVersion — public read", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns the safe default `1` when no row exists (fresh deploy)", async () => {
    expect(await t.query(api.lib.app.app.minBuildVersion, {})).toBe(1);
  });

  it("returns the configured value after kb_admin set it (round-trip)", async () => {
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.app.app.setMinBuildVersion, { value: 42 });

    expect(await t.query(api.lib.app.app.minBuildVersion, {})).toBe(42);
  });

  it("is PUBLIC — unauthenticated callers read it (the boot gate runs BEFORE login)", async () => {
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.app.app.setMinBuildVersion, { value: 7 });

    // No `.withIdentity(...)` — anonymous caller. The boot gate has no session
    // yet; if this throws, the app stays stuck on splash forever.
    expect(await t.query(api.lib.app.app.minBuildVersion, {})).toBe(7);
  });

  it("kb_manager / customer can also read it (publicly accessible)", async () => {
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.app.app.setMinBuildVersion, { value: 12 });

    expect(
      await t
        .withIdentity({ subject: seed.tenantA.managerId })
        .query(api.lib.app.app.minBuildVersion, {}),
    ).toBe(12);
    expect(
      await t
        .withIdentity({ subject: seed.customerId })
        .query(api.lib.app.app.minBuildVersion, {}),
    ).toBe(12);
  });
});

describe("#394 app.setMinBuildVersion — kb_admin gate", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("kb_admin (root) can flip the value", async () => {
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.app.app.setMinBuildVersion, { value: 100 });
    expect(await t.query(api.lib.app.app.minBuildVersion, {})).toBe(100);
  });

  it("kb_manager is rejected (Forbidden — kbAdminMutation gate)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.app.app.setMinBuildVersion, { value: 99 }),
    ).rejects.toThrow();
  });

  it("plain customer is rejected", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.customerId })
        .mutation(api.lib.app.app.setMinBuildVersion, { value: 99 }),
    ).rejects.toThrow();
  });

  it("staff is rejected", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.staffId })
        .mutation(api.lib.app.app.setMinBuildVersion, { value: 99 }),
    ).rejects.toThrow();
  });

  it("unauthenticated caller is rejected", async () => {
    await expect(
      t.mutation(api.lib.app.app.setMinBuildVersion, { value: 99 }),
    ).rejects.toThrow();
  });
});

describe("#394 app.setMinBuildVersion — validation + singleton invariant", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("rejects value < 1 (every shipped binary has nativeBuildVersion >= 1)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.app.app.setMinBuildVersion, { value: 0 }),
    ).rejects.toThrow();
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.app.app.setMinBuildVersion, { value: -5 }),
    ).rejects.toThrow();
  });

  it("rejects non-integer values (build numbers are integers on iOS and Android)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.app.app.setMinBuildVersion, { value: 1.5 }),
    ).rejects.toThrow();
  });

  it("upserts the same singleton row across re-calls (no duplicate insert)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await asAdmin.mutation(api.lib.app.app.setMinBuildVersion, { value: 3 });
    await asAdmin.mutation(api.lib.app.app.setMinBuildVersion, { value: 4 });
    await asAdmin.mutation(api.lib.app.app.setMinBuildVersion, { value: 5 });

    expect(await t.query(api.lib.app.app.minBuildVersion, {})).toBe(5);

    // Exactly ONE row exists — no duplicate-singleton drift across upserts.
    const rows = await t.run(async (ctx) =>
      ctx.db.query("appConfig").collect(),
    );
    expect(rows).toHaveLength(1);
  });
});
