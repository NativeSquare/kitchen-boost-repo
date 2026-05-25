import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "./fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/tenancy/, so Vite keys same-dir matches as "./x" but parent matches
// as "../../x"; normalise every key to be relative to the convex root (../../)
// so convex-test's findModulesRoot sees ONE common prefix.
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
 * 1.x-G — audit log of sensitive actions, HYBRID composition policy.
 *
 * Tests written BEFORE the implementation (TDD red). They pin the contract of:
 *
 *  - `logAudit(ctx, {...})` — writes ONE `auditLog` row (actorUserId, actorRole,
 *    action, tenantId?, targetType?, targetId?, metadata?, timestamp). Callable
 *    explicitly from any mutation handler.
 *  - `kbAdminMutation` — AUTO-logs every one of its mutations (composition INSIDE
 *    the wrapper): a row appears with the resolved root actor, the declared
 *    action, the tenantId if present in args, and a timestamp — without the
 *    handler calling logAudit itself.
 *  - `tenantMutation` — logs ONLY when the function declares `audit: true`. An
 *    untagged tenantMutation produces NO row.
 *
 * The auditLog table (1.x-A / #2) already exists in schema with the exact fields
 * and the `by_tenant` / `by_actor` / `by_timestamp` indexes; this story does not
 * touch the schema. Probes in `_probes.ts` give the suite wrapper-built targets.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** Read every auditLog row (test-only direct read, bypassing the wrappers). */
async function readAuditLog(
  t: ReturnType<typeof convexTest>,
): Promise<Doc<"auditLog">[]> {
  return t.run((ctx) => ctx.db.query("auditLog").collect());
}

describe("1.x-G logAudit — explicit call", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("writes one auditLog row with the expected fields", async () => {
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.tenancy._probes.explicitLogProbe, {
        tenantId: seed.tenantA.tenantId,
      });

    // The host wrapper is a kbAdminMutation, which ALSO auto-logs; assert on the
    // explicit row specifically (composition is additive, by design).
    const rows = await readAuditLog(t);
    const row = rows.find((r) => r.action === "probe.explicit");
    expect(row).toBeDefined();
    expect(row?.actorUserId).toBe(seed.adminId);
    expect(row?.actorRole).toBe("kb_admin");
    expect(row?.tenantId).toBe(seed.tenantA.tenantId);
    expect(row?.targetType).toBe("tenant");
    expect(row?.targetId).toBe(seed.tenantA.tenantId);
    expect(row?.metadata).toEqual({ note: "hello" });
    expect(typeof row?.timestamp).toBe("number");
    expect(row?.timestamp).toBeGreaterThan(0);
  });

  it("omits optional fields when not supplied", async () => {
    // explicitLogMinimalProbe logs only action (no tenant/target/metadata).
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.tenancy._probes.explicitLogMinimalProbe, {});

    const rows = await readAuditLog(t);
    // kbAdminMutation auto-logs too, so filter to the explicit minimal action.
    const minimal = rows.find((r) => r.action === "probe.minimal");
    expect(minimal).toBeDefined();
    expect(minimal?.tenantId).toBeUndefined();
    expect(minimal?.targetType).toBeUndefined();
    expect(minimal?.targetId).toBeUndefined();
    expect(minimal?.metadata).toBeUndefined();
  });
});

describe("1.x-G kbAdminMutation — auto-logs every mutation", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("produces an auditLog row automatically (actor, action, tenantId, timestamp)", async () => {
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.tenancy._probes.adminAuditedMutation, {
        tenantId: seed.tenantB.tenantId,
      });

    const rows = await readAuditLog(t);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actorUserId).toBe(seed.adminId);
    expect(row.actorRole).toBe("kb_admin");
    // action falls back to the declared `action`, else the function path.
    expect(row.action).toBe("admin.audited");
    // tenantId pulled from the business args when present.
    expect(row.tenantId).toBe(seed.tenantB.tenantId);
    expect(typeof row.timestamp).toBe("number");
  });

  it("logs even when the admin mutation takes NO tenantId (tenantId omitted)", async () => {
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.tenancy._probes.adminProbeNoTenantMutation, {});

    const rows = await readAuditLog(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBe(seed.adminId);
    expect(rows[0].tenantId).toBeUndefined();
  });

  it("does NOT log when the admin mutation is refused (non-admin caller)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.tenancy._probes.adminAuditedMutation, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);

    const rows = await readAuditLog(t);
    expect(rows).toEqual([]);
  });
});

describe("1.x-G tenantMutation — opt-in via audit:true", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("a tenantMutation tagged audit:true produces a row (actor, action, tenantId, timestamp)", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.tenancy._probes.tenantAuditedMutation, {
        tenantId: seed.tenantA.tenantId,
      });

    const rows = await readAuditLog(t);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.actorUserId).toBe(seed.tenantA.managerId);
    expect(row.actorRole).toBe("kb_manager");
    expect(row.action).toBe("tenant.audited");
    expect(row.tenantId).toBe(seed.tenantA.tenantId);
    expect(typeof row.timestamp).toBe("number");
  });

  it("an UNTAGGED tenantMutation produces NO row", async () => {
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.tenancy._probes.managerProbeMutation, {
        tenantId: seed.tenantA.tenantId,
      });

    const rows = await readAuditLog(t);
    expect(rows).toEqual([]);
  });

  it("does NOT log when a tagged tenantMutation is refused (cross-tenant)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.tenancy._probes.tenantAuditedMutation, {
          tenantId: seed.tenantB.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);

    const rows = await readAuditLog(t);
    expect(rows).toEqual([]);
  });

  it("records the effective role of the actor (kb_admin on a tenant action via root override)", async () => {
    await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.tenancy._probes.tenantAuditedMutation, {
        tenantId: seed.tenantA.tenantId,
      });

    const rows = await readAuditLog(t);
    expect(rows).toHaveLength(1);
    expect(rows[0].actorUserId).toBe(seed.adminId);
    expect(rows[0].actorRole).toBe("kb_admin");
    expect(rows[0].tenantId).toBe(seed.tenantA.tenantId);
  });
});
