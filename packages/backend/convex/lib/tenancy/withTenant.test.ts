import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "./fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/tenancy/, so Vite keys same-dir matches as "./x" but parent matches
// as "../../x" — convex-test's findModulesRoot needs ONE common prefix, so we
// normalise every key to be relative to the convex root (../../).
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
 * 1.x-C — tenancy wrappers (root + resto) + cross-tenant fuzz harness.
 *
 * These tests are written BEFORE the implementation (TDD red). They pin the
 * contract of the four wrappers built on `getCurrentActor` (ADR 0011) that
 * replace the absent Postgres RLS with 100% applicative isolation (ADR 0010):
 *
 *  - `kbAdminQuery` / `kbAdminMutation` — require global role `kb_admin`,
 *    act on ANY tenant, no `tenantId` argument.
 *  - `tenantQuery` / `tenantMutation({ allow })` — `tenantId` is an EXPLICIT
 *    argument; throw Forbidden when the tenant is inaccessible OR the effective
 *    role is not in `allow` (default `["kb_manager"]`).
 *
 * `convex/lib/tenancy/_probes.ts` exposes thin probe functions built with each
 * wrapper so the tests (and the reusable fuzz harness) can drive them through
 * the real Convex function pipeline via `t.withIdentity({ subject })`.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("1.x-C kbAdmin* wrappers — root access", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("kbAdminQuery throws for an unauthenticated caller", async () => {
    await expect(
      t.query(api.lib.tenancy._probes.adminProbeQuery, {}),
    ).rejects.toThrow();
  });

  it("kbAdminQuery throws when the actor is not kb_admin (a kb_manager)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .query(api.lib.tenancy._probes.adminProbeQuery, {}),
    ).rejects.toThrow(/forbidden/i);
  });

  it("kbAdminQuery throws when the actor is a plain customer", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.customerId })
        .query(api.lib.tenancy._probes.adminProbeQuery, {}),
    ).rejects.toThrow(/forbidden/i);
  });

  it("kbAdminQuery succeeds for kb_admin and exposes the resolved actor", async () => {
    const res = await t
      .withIdentity({ subject: seed.adminId })
      .query(api.lib.tenancy._probes.adminProbeQuery, {});
    expect(res.role).toBe("kb_admin");
    expect(res.userId).toBe(seed.adminId);
  });

  it("kbAdminMutation lets kb_admin act on ANY tenant (no tenantId gate)", async () => {
    // kb_admin reads tenant B's name through an admin mutation, with no
    // userTenants row on B — root is unlimited.
    const name = await t
      .withIdentity({ subject: seed.adminId })
      .mutation(api.lib.tenancy._probes.adminReadTenantName, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(name).toBe(seed.tenantB.name);
  });

  it("kbAdminMutation throws for a non-admin", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .mutation(api.lib.tenancy._probes.adminReadTenantName, {
          tenantId: seed.tenantB.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("1.x-C tenant* wrappers — resto isolation + allow", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("requires an explicit tenantId argument (rejects when missing)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        // @ts-expect-error tenantId is a required explicit argument
        .query(api.lib.tenancy._probes.managerProbeQuery, {}),
    ).rejects.toThrow();
  });

  it("throws for an unauthenticated caller", async () => {
    await expect(
      t.query(api.lib.tenancy._probes.managerProbeQuery, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow();
  });

  it("lets a kb_manager access their OWN tenant", async () => {
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.tenancy._probes.managerProbeQuery, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(res.tenantId).toBe(seed.tenantA.tenantId);
    expect(res.effectiveRole).toBe("kb_manager");
  });

  it("throws Forbidden when a kb_manager targets a tenant they do NOT belong to", async () => {
    // manager of A reaches for B → cross-tenant, must be refused with 0 leak.
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .query(api.lib.tenancy._probes.managerProbeQuery, {
          tenantId: seed.tenantB.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("kb_admin passes a tenant* wrapper on ANY tenant (root override)", async () => {
    const res = await t
      .withIdentity({ subject: seed.adminId })
      .query(api.lib.tenancy._probes.managerProbeQuery, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(res.effectiveRole).toBe("kb_admin");
  });

  it("respects `allow`: a staff is BLOCKED on an action that allows only kb_manager", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.staffId })
        .query(api.lib.tenancy._probes.managerProbeQuery, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("respects `allow`: a staff IS allowed on an action that allows staff", async () => {
    const res = await t
      .withIdentity({ subject: seed.tenantA.staffId })
      .query(api.lib.tenancy._probes.staffProbeQuery, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(res.effectiveRole).toBe("staff");
  });

  it("a kb_manager IS allowed on a staff+manager action (allow widens, not narrows)", async () => {
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.tenancy._probes.staffProbeQuery, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(res.effectiveRole).toBe("kb_manager");
  });

  it("throws Forbidden on a REVOKED access (detachedAt set)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.detachedUserId })
        .query(api.lib.tenancy._probes.managerProbeQuery, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("tenantMutation enforces the same gate (write path)", async () => {
    // manager of A writes via tenantMutation on B → Forbidden.
    await expect(
      t
        .withIdentity({ subject: seed.tenantA.managerId })
        .mutation(api.lib.tenancy._probes.managerProbeMutation, {
          tenantId: seed.tenantB.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
    // own tenant → ok.
    const ok = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.tenancy._probes.managerProbeMutation, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(ok.tenantId).toBe(seed.tenantA.tenantId);
  });
});

describe("1.x-C cross-tenant fuzz harness — 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  // The REUSABLE harness: replay each tenant-scoped function under every
  // unauthorized actor against an inaccessible tenant and assert it throws.
  // Subsequent stories register their own functions in this list (see fuzz.ts).
  it("every tenant-scoped probe throws when replayed cross-tenant", async () => {
    const targets = [
      api.lib.tenancy._probes.managerProbeQuery,
      api.lib.tenancy._probes.staffProbeQuery,
      api.lib.tenancy._probes.managerProbeMutation,
    ];

    // Unauthorized actors against tenant A: B's manager/staff (wrong tenant),
    // the detached user (revoked), the plain customer, and unauthenticated.
    const unauthorized: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];

    const { leaks } = await runCrossTenantFuzz(t, {
      functions: targets,
      isQuery: (fn) => fn !== api.lib.tenancy._probes.managerProbeMutation,
      tenantId: seed.tenantA.tenantId,
      actors: unauthorized,
    });

    expect(leaks).toEqual([]);
  });

  it("the SAME harness confirms an admin function rejects every non-admin", async () => {
    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [api.lib.tenancy._probes.adminProbeQuery],
      isQuery: () => true,
      // admin functions have no tenantId; harness omits it when undefined.
      tenantId: undefined,
      actors: [
        { label: "A-manager", subject: seed.tenantA.managerId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(leaks).toEqual([]);
  });
});
