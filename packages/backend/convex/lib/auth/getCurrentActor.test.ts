import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory).
const modules = import.meta.glob(["../../**/*.{ts,js}", "!../../**/*.test.*"]);

/**
 * 1.x-B — getCurrentActor, the SINGLE sanctioned `getAuthUserId` call site
 * (ADR 0011). These tests exercise the resolution of the normalised identity
 * and the per-tenant effective role for every actor type, written BEFORE the
 * implementation (TDD red).
 *
 * The actor is read through a thin test-only probe query (`whoAmI`) defined in
 * the module so we can drive it with `t.withIdentity({ subject })` — Convex
 * Auth's `getAuthUserId` reads `identity.subject` and keeps the part before the
 * "|" divider, so `subject: <userId>` resolves to that user.
 */
describe("1.x-B getCurrentActor — normalised identity", () => {
  it("returns null for an unauthenticated caller (no identity)", async () => {
    const t = convexTest(schema, modules);
    const actor = await t.query(api.lib.auth.getCurrentActor.whoAmI, {});
    expect(actor).toBeNull();
  });

  it("normalises a kb_admin (global role on users, no tenantId)", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "root@kb.fr", role: "kb_admin" }),
    );
    const actor = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getCurrentActor.whoAmI, {});
    expect(actor).toEqual({
      userId,
      role: "kb_admin",
      isAnonymous: false,
      effectiveRole: null,
    });
  });

  it("normalises an anonymous customer", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { role: "customer", isAnonymous: true }),
    );
    const actor = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getCurrentActor.whoAmI, {});
    expect(actor).toEqual({
      userId,
      role: "customer",
      isAnonymous: true,
      effectiveRole: null,
    });
  });

  it("treats a user with no role field as a (non-anonymous) customer", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "eater@x.fr" }),
    );
    const actor = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getCurrentActor.whoAmI, {});
    expect(actor?.role).toBe("customer");
    expect(actor?.isAnonymous).toBe(false);
  });
});

describe("1.x-B getCurrentActor — per-tenant effective role", () => {
  async function seedUserWithTenant(
    t: ReturnType<typeof convexTest>,
    role: "kb_manager" | "staff",
  ): Promise<{ userId: Id<"users">; tenantId: Id<"tenants"> }> {
    return t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: `${role}@x.fr`,
        role: "customer",
      });
      const tenantId = await ctx.db.insert("tenants", {
        slug: `s-${role}`,
        name: "n",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("userTenants", {
        userId,
        tenantId,
        role,
        attachedAt: Date.now(),
        attachedBy: userId,
      });
      return { userId, tenantId };
    });
  }

  it("resolves kb_manager effective role on a tenant via userTenants.role", async () => {
    const t = convexTest(schema, modules);
    const { userId, tenantId } = await seedUserWithTenant(t, "kb_manager");
    const actor = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getCurrentActor.whoAmI, { tenantId });
    expect(actor?.effectiveRole).toBe("kb_manager");
    expect(actor?.role).toBe("customer"); // global role stays customer
  });

  it("resolves staff effective role on a tenant via userTenants.role", async () => {
    const t = convexTest(schema, modules);
    const { userId, tenantId } = await seedUserWithTenant(t, "staff");
    const actor = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getCurrentActor.whoAmI, { tenantId });
    expect(actor?.effectiveRole).toBe("staff");
  });

  it("gives kb_admin an effective role on ANY tenant without a userTenants row", async () => {
    const t = convexTest(schema, modules);
    const { userId, tenantId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "root@kb.fr",
        role: "kb_admin",
      });
      const tenantId = await ctx.db.insert("tenants", {
        slug: "any",
        name: "n",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      return { userId, tenantId };
    });
    const actor = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getCurrentActor.whoAmI, { tenantId });
    expect(actor?.role).toBe("kb_admin");
    expect(actor?.effectiveRole).toBe("kb_admin");
  });

  it("returns null effective role when the user has NO attachment to the tenant", async () => {
    const t = convexTest(schema, modules);
    // user is kb_manager of tenant A, queries tenant B (no row) → no role on B.
    const { userId } = await seedUserWithTenant(t, "kb_manager");
    const otherTenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        slug: "other",
        name: "n",
        siret: "2",
        status: "active",
        createdAt: Date.now(),
      }),
    );
    const actor = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getCurrentActor.whoAmI, { tenantId: otherTenantId });
    expect(actor?.effectiveRole).toBeNull();
  });

  it("ignores a DETACHED attachment (detachedAt set) — no effective role", async () => {
    const t = convexTest(schema, modules);
    const { userId, tenantId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "ex-staff@x.fr",
        role: "customer",
      });
      const tenantId = await ctx.db.insert("tenants", {
        slug: "detached",
        name: "n",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("userTenants", {
        userId,
        tenantId,
        role: "staff",
        attachedAt: Date.now(),
        attachedBy: userId,
        detachedAt: Date.now(), // detached → no longer grants a role
      });
      return { userId, tenantId };
    });
    const actor = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getCurrentActor.whoAmI, { tenantId });
    expect(actor?.effectiveRole).toBeNull();
  });

  it("returns null effective role when no tenantId is supplied", async () => {
    const t = convexTest(schema, modules);
    const { userId } = await seedUserWithTenant(t, "kb_manager");
    const actor = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getCurrentActor.whoAmI, {});
    expect(actor?.effectiveRole).toBeNull();
  });
});

describe("1.x-B getCurrentActor — single sanctioned getAuthUserId site (ADR 0011)", () => {
  it("is the ONLY module under convex/ that imports getAuthUserId", async () => {
    // Guards ADR 0011: identity must flow through getCurrentActor only.
    // The interim template call sites (users.ts, admin.ts) are migrated by the
    // wrappers story (1.x-C); this asserts no NEW leak and that getCurrentActor
    // itself is the sanctioned home. We scan the loaded function modules' source.
    const sources = import.meta.glob("../../**/*.{ts,js}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes(".test."))
      .filter(([, src]) => /getAuthUserId/.test(src))
      .map(([path]) => path);

    // getCurrentActor.ts is the sanctioned site and MUST be among them.
    expect(offenders.some((p) => p.includes("getCurrentActor"))).toBe(true);

    // No site OUTSIDE convex/lib/auth/ may import getAuthUserId. (Interim
    // template sites in convex/table/ are tracked by 1.x-C; this test pins the
    // new module's contract and prevents regressions in fresh code.)
    const outsideAuthLib = offenders.filter((p) => !p.includes("lib/auth/"));
    // Documented interim exceptions migrated by 1.x-C.
    const interimExceptions = ["table/users.ts", "table/admin.ts"];
    const unexpected = outsideAuthLib.filter(
      (p) => !interimExceptions.some((e) => p.endsWith(e)),
    );
    expect(unexpected).toEqual([]);
  });
});
