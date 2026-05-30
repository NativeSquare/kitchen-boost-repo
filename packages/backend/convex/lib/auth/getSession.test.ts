import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/auth/, so Vite keys same-dir matches as "./x" but parent matches as
// "../../x" — convex-test's findModulesRoot needs ONE common prefix, so we
// normalise every key to be relative to the convex root (../../).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/auth/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * B-AUTH-1 — `getSession` skeleton (issue #162).
 *
 * Premier tracer-bullet de D1 (cf. ADR 0014 §3) : la query Convex publique qui
 * répond à la question « qui es-tu ? ». Trois branches de ce slice :
 *  1. caller non authentifié → throw `Not authenticated` (front affiche login).
 *  2. caller `kb_admin` (root) → `{ isAdmin: true, tenants: [] }` (le root n'a
 *     pas de ligne `userTenants` par convention, cf. `resolveEffectiveRole`).
 *  3. caller authentifié sans `kb_admin` ET sans aucune ligne `userTenants`
 *     active → `{ isAdmin: false, tenants: [] }` (front affiche « pas de resto
 *     rattaché »).
 *
 * La forme de retour est figée dès ce slice : la liste `tenants` reste vide
 * pour ces trois branches ; le slice B-AUTH-2 la remplira pour les gérants.
 * La query doit consommer UNIQUEMENT `getCurrentActor` (ADR 0011) — aucun
 * appel direct à `getAuthUserId`.
 */
describe("B-AUTH-1 getSession — three skeleton branches", () => {
  it("throws Not authenticated when no identity is attached", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.query(api.lib.auth.getSession.getSession, {}),
    ).rejects.toThrow(/not authenticated/i);
  });

  it("returns { isAdmin: true, tenants: [] } for a kb_admin root", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "root@kb.fr", role: "kb_admin" }),
    );
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session).toEqual({
      isAdmin: true,
      tenants: [],
      // `user` projection is asserted in its own describe block below — here we
      // only pin the shell-routing contract (isAdmin + tenants).
      user: { userId, name: undefined, email: "root@kb.fr", image: undefined },
    });
  });

  it("returns { isAdmin: false, tenants: [] } for an authenticated caller with no kb_admin and no userTenants row", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "orphan@x.fr", role: "customer" }),
    );
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session).toEqual({
      isAdmin: false,
      tenants: [],
      user: { userId, name: undefined, email: "orphan@x.fr", image: undefined },
    });
  });

  it("treats a user with no role field as a non-admin orphan (defaults to customer)", async () => {
    const t = convexTest(schema, modules);
    // A user row may exist without `role` set (template baseline); the resolver
    // treats it as a `customer`, so it falls into the no-tenant branch in this
    // slice (B-AUTH-2 will surface its tenant list if attachments exist).
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "noroles@x.fr" }),
    );
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session).toEqual({
      isAdmin: false,
      tenants: [],
      user: {
        userId,
        name: undefined,
        email: "noroles@x.fr",
        image: undefined,
      },
    });
  });

  // NOTE — the historical "userTenants row but still returns []" placeholder
  // from B-AUTH-1 is removed by B-AUTH-2 (issue #171): once a manager has at
  // least one ACTIVE attachment, `getSession` MUST surface it. The dedicated
  // mono-tenant case below is the new replacement assertion.
});

/**
 * B-AUTH-2 — `getSession` hydrate la liste `tenants` pour un gérant/staff
 * (issue #171). Deuxième tracer-bullet de D1 (ADR 0014 §3) : on lit les lignes
 * `userTenants` ACTIVES du caller (`detachedAt === undefined`), on joint chaque
 * ligne avec sa table `tenants` pour récupérer `slug` + `name`, et on renvoie
 * `{ tenantId, slug, name, role }` par ligne. Le `role` reste celui de la ligne
 * `userTenants` (`kb_manager | staff`) — PAS un badge global.
 *
 * Règles de résilience non négociables :
 *  - Une ligne `userTenants` avec `detachedAt !== undefined` est IGNORÉE (un
 *    rattachement révoqué disparaît immédiatement du switcher du gérant).
 *  - Une ligne pointant vers un tenant SUPPRIMÉ (`ctx.db.get(tenantId) === null`)
 *    est IGNORÉE silencieusement — pas de throw — pour rester résilient au cas
 *    où la suppression du tenant arrive après la révocation des rattachements.
 *
 * Le contrat `kb_admin` reste inchangé : `tenants: []` (le root n'a pas de
 * ligne `userTenants` par convention ; son propre switcher est hydraté par une
 * query séparée, hors scope de cet épique).
 */
describe("B-AUTH-2 getSession — hydrate tenants for managers/staff", () => {
  it("returns the single attached tenant for a mono-tenant manager", async () => {
    const t = convexTest(schema, modules);
    const { userId, tenantId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "khan@x.fr",
        role: "customer",
      });
      const tenantId = await ctx.db.insert("tenants", {
        slug: "khan",
        name: "Khan",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("userTenants", {
        userId,
        tenantId,
        role: "kb_manager",
        attachedAt: Date.now(),
        attachedBy: userId,
      });
      return { userId, tenantId };
    });
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session).toEqual({
      isAdmin: false,
      tenants: [{ tenantId, slug: "khan", name: "Khan", role: "kb_manager" }],
      user: { userId, name: undefined, email: "khan@x.fr", image: undefined },
    });
  });

  it("returns all three attached tenants for a multi-tenant manager (Walid case)", async () => {
    const t = convexTest(schema, modules);
    const { userId, ids } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "walid@x.fr",
        role: "customer",
      });
      const t1 = await ctx.db.insert("tenants", {
        slug: "thai-1",
        name: "Thai Street 1",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      const t2 = await ctx.db.insert("tenants", {
        slug: "thai-2",
        name: "Thai Street 2",
        siret: "2",
        status: "active",
        createdAt: Date.now(),
      });
      const t3 = await ctx.db.insert("tenants", {
        slug: "thai-3",
        name: "Thai Street 3",
        siret: "3",
        status: "active",
        createdAt: Date.now(),
      });
      for (const tenantId of [t1, t2, t3]) {
        await ctx.db.insert("userTenants", {
          userId,
          tenantId,
          role: "kb_manager",
          attachedAt: Date.now(),
          attachedBy: userId,
        });
      }
      return { userId, ids: [t1, t2, t3] };
    });
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session.isAdmin).toBe(false);
    expect(session.tenants).toHaveLength(3);
    // Order-independent comparison — index order is not part of the contract.
    const byId = new Map(session.tenants.map((row) => [row.tenantId, row]));
    expect(byId.get(ids[0]!)).toEqual({
      tenantId: ids[0],
      slug: "thai-1",
      name: "Thai Street 1",
      role: "kb_manager",
    });
    expect(byId.get(ids[1]!)).toEqual({
      tenantId: ids[1],
      slug: "thai-2",
      name: "Thai Street 2",
      role: "kb_manager",
    });
    expect(byId.get(ids[2]!)).toEqual({
      tenantId: ids[2],
      slug: "thai-3",
      name: "Thai Street 3",
      role: "kb_manager",
    });
  });

  it("ignores detached userTenants rows (mix of 2 active + 1 detached → 2 tenants)", async () => {
    const t = convexTest(schema, modules);
    const { userId, activeIds } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "mixed@x.fr",
        role: "customer",
      });
      const a = await ctx.db.insert("tenants", {
        slug: "active-1",
        name: "Active 1",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      const b = await ctx.db.insert("tenants", {
        slug: "active-2",
        name: "Active 2",
        siret: "2",
        status: "active",
        createdAt: Date.now(),
      });
      const d = await ctx.db.insert("tenants", {
        slug: "detached-3",
        name: "Detached 3",
        siret: "3",
        status: "active",
        createdAt: Date.now(),
      });
      for (const tenantId of [a, b]) {
        await ctx.db.insert("userTenants", {
          userId,
          tenantId,
          role: "kb_manager",
          attachedAt: Date.now(),
          attachedBy: userId,
        });
      }
      await ctx.db.insert("userTenants", {
        userId,
        tenantId: d,
        role: "staff",
        attachedAt: Date.now(),
        attachedBy: userId,
        detachedAt: Date.now(), // revoked → must NOT appear in the switcher
      });
      return { userId, activeIds: [a, b] };
    });
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session.tenants).toHaveLength(2);
    const ids = session.tenants.map((row) => row.tenantId).sort();
    expect(ids).toEqual([...activeIds].sort());
    // The detached row's slug must not leak in.
    expect(session.tenants.some((r) => r.slug === "detached-3")).toBe(false);
  });

  it("ignores active userTenants rows pointing to a deleted/null tenant (resilience, no throw)", async () => {
    const t = convexTest(schema, modules);
    const { userId, survivingTenantId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "orphan-link@x.fr",
        role: "customer",
      });
      // One healthy attachment.
      const survivingTenantId = await ctx.db.insert("tenants", {
        slug: "alive",
        name: "Alive",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("userTenants", {
        userId,
        tenantId: survivingTenantId,
        role: "kb_manager",
        attachedAt: Date.now(),
        attachedBy: userId,
      });
      // One attachment whose tenant gets deleted AFTER the row was written —
      // simulates the « tenant supprimé avant que les rattachements aient été
      // révoqués » edge case. The attachment is still active, but the join must
      // skip it silently (no throw, just drop the row).
      const doomedTenantId = await ctx.db.insert("tenants", {
        slug: "doomed",
        name: "Doomed",
        siret: "2",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.insert("userTenants", {
        userId,
        tenantId: doomedTenantId,
        role: "kb_manager",
        attachedAt: Date.now(),
        attachedBy: userId,
      });
      await ctx.db.delete(doomedTenantId);
      return { userId, survivingTenantId };
    });
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session).toEqual({
      isAdmin: false,
      tenants: [
        {
          tenantId: survivingTenantId,
          slug: "alive",
          name: "Alive",
          role: "kb_manager",
        },
      ],
      user: {
        userId,
        name: undefined,
        email: "orphan-link@x.fr",
        image: undefined,
      },
    });
  });

  it("surfaces the per-tenant role (staff stays staff, kb_manager stays kb_manager, not a global badge)", async () => {
    const t = convexTest(schema, modules);
    const { userId, managerTenantId, staffTenantId } = await t.run(
      async (ctx) => {
        const userId = await ctx.db.insert("users", {
          email: "mixed-roles@x.fr",
          role: "customer",
        });
        const managerTenantId = await ctx.db.insert("tenants", {
          slug: "owned",
          name: "Owned resto",
          siret: "1",
          status: "active",
          createdAt: Date.now(),
        });
        const staffTenantId = await ctx.db.insert("tenants", {
          slug: "helping",
          name: "Helping at",
          siret: "2",
          status: "active",
          createdAt: Date.now(),
        });
        await ctx.db.insert("userTenants", {
          userId,
          tenantId: managerTenantId,
          role: "kb_manager",
          attachedAt: Date.now(),
          attachedBy: userId,
        });
        await ctx.db.insert("userTenants", {
          userId,
          tenantId: staffTenantId,
          role: "staff",
          attachedAt: Date.now(),
          attachedBy: userId,
        });
        return { userId, managerTenantId, staffTenantId };
      },
    );
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    const byId = new Map(session.tenants.map((row) => [row.tenantId, row]));
    expect(byId.get(managerTenantId)?.role).toBe("kb_manager");
    expect(byId.get(staffTenantId)?.role).toBe("staff");
  });

  it("kb_admin keeps tenants: [] even with stray userTenants rows (root convention preserved)", async () => {
    // The root has no `userTenants` rows by convention — but if a stray one
    // existed, getSession must NOT surface it for a kb_admin: the root switcher
    // is hydrated by a separate query (out of scope here).
    const t = convexTest(schema, modules);
    const userId: Id<"users"> = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "root@kb.fr",
        role: "kb_admin",
      });
      const tenantId = await ctx.db.insert("tenants", {
        slug: "stray",
        name: "Stray",
        siret: "1",
        status: "active",
        createdAt: Date.now(),
      });
      // Stray row — should NOT bleed into the admin's session payload.
      await ctx.db.insert("userTenants", {
        userId,
        tenantId,
        role: "kb_manager",
        attachedAt: Date.now(),
        attachedBy: userId,
      });
      return userId;
    });
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session).toEqual({
      isAdmin: true,
      tenants: [],
      user: { userId, name: undefined, email: "root@kb.fr", image: undefined },
    });
  });
});

describe("getSession — user projection (NavUser footer payload)", () => {
  it("surfaces name + email + image when the users row carries them", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", {
        email: "complete@kb.fr",
        role: "kb_admin",
        name: "Alex Pelloux",
        image: "https://cdn.example/avatar.png",
      }),
    );
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session.user).toEqual({
      userId,
      name: "Alex Pelloux",
      email: "complete@kb.fr",
      image: "https://cdn.example/avatar.png",
    });
  });

  it("returns undefined for missing display fields rather than throwing (NavUser falls back to initials)", async () => {
    const t = convexTest(schema, modules);
    // Minimum viable users row — only the implicit auth fields. The shell's
    // NavUser renders initials from email or a generic fallback when name is
    // absent (cf. app-sidebar.tsx); the backend must not synthesise values.
    // `role` is left absent — getCurrentActor defaults it to "customer". The
    // user has no userTenants attachment → falls into `{ isAdmin: false,
    // tenants: [] }`, but the `user` projection still surfaces with all
    // optional fields undefined.
    const userId = await t.run(async (ctx) => ctx.db.insert("users", {}));
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session.user).toEqual({
      userId,
      name: undefined,
      email: undefined,
      image: undefined,
    });
  });
});

describe("B-AUTH-1 getSession — single sanctioned getAuthUserId site (ADR 0011)", () => {
  it("does NOT import getAuthUserId directly (must go through getCurrentActor)", async () => {
    // Pin the contract: identity flows through `getCurrentActor` only. The
    // implementation file must not import `getAuthUserId` from convex-auth.
    const sources = import.meta.glob("./*.{ts,js}", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;

    const importsAuth = (src: string) =>
      /import\s[^;]*\bgetAuthUserId\b[^;]*from\s*["']@convex-dev\/auth\/server["']/.test(
        src,
      );

    const offending = Object.entries(sources)
      .filter(([path]) => path.endsWith("getSession.ts"))
      .filter(([, src]) => importsAuth(src));
    expect(offending).toEqual([]);
  });
});
