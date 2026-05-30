import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
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
    expect(session).toEqual({ isAdmin: true, tenants: [] });
  });

  it("returns { isAdmin: false, tenants: [] } for an authenticated caller with no kb_admin and no userTenants row", async () => {
    const t = convexTest(schema, modules);
    const userId = await t.run(async (ctx) =>
      ctx.db.insert("users", { email: "orphan@x.fr", role: "customer" }),
    );
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session).toEqual({ isAdmin: false, tenants: [] });
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
    expect(session).toEqual({ isAdmin: false, tenants: [] });
  });

  it("returns { isAdmin: false, tenants: [] } even when a userTenants row exists (slice B-AUTH-2 fills the list)", async () => {
    // This slice deliberately ignores `userTenants` — the contract is the SHAPE
    // (isAdmin + tenants array). Filling `tenants` for managers is the next
    // tracer-bullet (B-AUTH-2). A manager today therefore still observes the
    // empty list, not an undefined/missing field.
    const t = convexTest(schema, modules);
    const { userId } = await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "mgr@x.fr",
        role: "customer",
      });
      const tenantId = await ctx.db.insert("tenants", {
        slug: "t1",
        name: "Resto 1",
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
      return { userId };
    });
    const session = await t
      .withIdentity({ subject: userId })
      .query(api.lib.auth.getSession.getSession, {});
    expect(session).toEqual({ isAdmin: false, tenants: [] });
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
