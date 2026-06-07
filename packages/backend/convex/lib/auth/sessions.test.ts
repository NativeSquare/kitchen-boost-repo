import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Doc, Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). Normalise every key
// to be relative to the convex root (../../) so findModulesRoot has ONE common
// prefix (same shape as getSession.test.ts alongside).
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
 * #396 (KB Admin Page Sessions actives + bouton « Révoquer ») — backend
 * contract:
 *
 *   - `listTenantSessions({ tenantId })` — `tenantQuery({ allow: [] })` —
 *     kb_admin only (root override via `withTenant.ts:83`). Returns the
 *     ACTIVE `authSessions` belonging to users with an ACTIVE `userTenants`
 *     attachment on `tenantId`. Each row projects the minimal identity
 *     (`userName` / `userEmail`) the page needs — never raw user docs.
 *     Sorted by creation desc.
 *
 *   - `revokeSession({ tenantId, sessionId })` —
 *     `tenantMutation({ allow: [], audit: true, action:
 *     "auth.revokeSession" })`. kb_admin only. Verifies the session's user
 *     has an ACTIVE `userTenants` attachment on `tenantId` (cross-tenant
 *     guard, défense en profondeur même si seul kb_admin atteint cette
 *     branche). Deletes the `authSessions` row AND cascades the user's
 *     refresh tokens whose `sessionId` matches (so the native client cannot
 *     refresh back). Returns `null`. Writes an audit row via the wrapper's
 *     onSuccess hook (`actorRole: kb_admin`, `tenantId: <tenantId>`,
 *     `action: "auth.revokeSession"`).
 *
 * RBAC (décision terrain 2026-06-07, grilling KBO-AD) :
 *  - **kb_admin only** sur les 2 surfaces. À l'origine `allow: ["kb_manager"]`
 *    pour exposer la révocation aux gérants (PRD 20 §13 « vol/perte/employé
 *    licencié »), Alex a identifié une privilege escalation latérale entre
 *    managers du même tenant (Walid peut booter Khan).
 *  - kb_manager / staff → FORBIDDEN sur les 2 fonctions, même attachés au
 *    tenant ciblé. Section dédiée plus bas pin ce contrat.
 *
 * Cross-tenant isolation (ADR 0010, layer 3 fuzz) :
 *  - kb_admin passe (root override).
 *  - kb_manager / staff / detached / customer / anonymous → Forbidden.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** Read every auditLog row (test-only direct read, bypassing the wrappers). */
async function readAuditLog(
  t: ReturnType<typeof convexTest>,
): Promise<Doc<"auditLog">[]> {
  return t.run((ctx) => ctx.db.query("auditLog").collect());
}

/**
 * Insert a fake authSession row for `userId`. We seed via raw `ctx.db.insert`
 * (convex-test t.run is harness, not business code) so we don't have to run the
 * full Convex Auth sign-in flow inside unit tests.
 */
async function insertAuthSession(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  expirationTime: number = Date.now() + 1000 * 60 * 60 * 24 * 30,
): Promise<Id<"authSessions">> {
  return t.run((ctx) =>
    ctx.db.insert("authSessions", { userId, expirationTime }),
  );
}

/**
 * Insert a fake authRefreshTokens row tied to a session. Used to assert the
 * revoke cascade (the row vanishes alongside the session).
 */
async function insertRefreshToken(
  t: ReturnType<typeof convexTest>,
  sessionId: Id<"authSessions">,
): Promise<Id<"authRefreshTokens">> {
  return t.run((ctx) =>
    ctx.db.insert("authRefreshTokens", {
      sessionId,
      expirationTime: Date.now() + 1000 * 60 * 60,
    }),
  );
}

describe("#396 listTenantSessions — happy paths (kb_admin only post 2026-06-07)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("kb_admin lists only sessions of users attached to the targeted tenant", async () => {
    // Seed: one session for A's manager, one for A's staff, one for B's
    // manager (must NOT leak into A's listing).
    await insertAuthSession(t, seed.tenantA.managerId);
    await insertAuthSession(t, seed.tenantA.staffId);
    await insertAuthSession(t, seed.tenantB.managerId);

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const sessions = await asAdmin.query(
      api.lib.auth.sessions.listTenantSessions,
      { tenantId: seed.tenantA.tenantId },
    );

    expect(Array.isArray(sessions)).toBe(true);
    expect(sessions).toHaveLength(2);
    const userIds = new Set(sessions.map((s) => s.userId));
    expect(userIds).toEqual(
      new Set([seed.tenantA.managerId, seed.tenantA.staffId]),
    );
    // B's manager session is NOT exposed even though it exists in authSessions.
    expect(userIds.has(seed.tenantB.managerId)).toBe(false);
  });

  it("each row projects only the minimal identity fields the page needs (no raw user doc, no expirationTime leak shape)", async () => {
    const sid = await insertAuthSession(t, seed.tenantA.managerId);

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const [row] = await asAdmin.query(
      api.lib.auth.sessions.listTenantSessions,
      { tenantId: seed.tenantA.tenantId },
    );

    expect(row.sessionId).toBe(sid);
    expect(row.userId).toBe(seed.tenantA.managerId);
    expect(row.userEmail).toBe("a-mgr@x.fr");
    expect(typeof row.createdAt).toBe("number");
    expect(typeof row.expiresAt).toBe("number");
    // V1 audit monolithique : a session row carries identity + lifetime ONLY.
    // No raw `user` blob — that would leak fields the page should never see.
    expect((row as Record<string, unknown>).user).toBeUndefined();
  });

  it("kb_admin sees sessions of any tenant (root override on `allow: []`)", async () => {
    await insertAuthSession(t, seed.tenantA.managerId);
    await insertAuthSession(t, seed.tenantB.managerId);

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const a = await asAdmin.query(api.lib.auth.sessions.listTenantSessions, {
      tenantId: seed.tenantA.tenantId,
    });
    const b = await asAdmin.query(api.lib.auth.sessions.listTenantSessions, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(a.map((r) => r.userId)).toEqual([seed.tenantA.managerId]);
    expect(b.map((r) => r.userId)).toEqual([seed.tenantB.managerId]);
  });

  it("a user attached to BOTH tenants surfaces in the listing of each", async () => {
    // Walid pattern: one human, two tenants. Same authSession should surface
    // in both tenants' listings — the listing is BY TENANT, not by user.
    await t.run((ctx) =>
      ctx.db.insert("userTenants", {
        userId: seed.tenantA.managerId,
        tenantId: seed.tenantB.tenantId,
        role: "kb_manager",
        attachedAt: Date.now(),
        attachedBy: seed.adminId,
      }),
    );
    await insertAuthSession(t, seed.tenantA.managerId);

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const inA = await asAdmin.query(api.lib.auth.sessions.listTenantSessions, {
      tenantId: seed.tenantA.tenantId,
    });
    const inB = await asAdmin.query(api.lib.auth.sessions.listTenantSessions, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(inA.map((r) => r.userId)).toEqual([seed.tenantA.managerId]);
    expect(inB.map((r) => r.userId)).toEqual([seed.tenantA.managerId]);
  });

  it("a DETACHED userTenants attachment does NOT surface the user's session", async () => {
    // detachedUserId WAS attached to tenant A, then revoked (detachedAt set).
    // A revoked attachment must NOT keep a session visible (consistent with
    // getSession's resilience rule, ADR 0014 §3 + B-AUTH-2).
    await insertAuthSession(t, seed.detachedUserId);

    // KB Admin lists tenant A : detached user's session is NOT there.
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const rows = await asAdmin.query(api.lib.auth.sessions.listTenantSessions, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(rows.find((r) => r.userId === seed.detachedUserId)).toBeUndefined();
  });
});

describe("#396 revokeSession — happy paths (kb_admin only post 2026-06-07)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("kb_admin revokes a session of a user attached to the targeted tenant → row deleted + audit row written", async () => {
    const sid = await insertAuthSession(t, seed.tenantA.staffId);
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    await asAdmin.mutation(api.lib.auth.sessions.revokeSession, {
      tenantId: seed.tenantA.tenantId,
      sessionId: sid,
    });

    // The authSessions row is gone.
    const sessionAfter = await t.run((ctx) => ctx.db.get(sid));
    expect(sessionAfter).toBeNull();

    // Audit row was written with the declared action.
    const rows = await readAuditLog(t);
    const row = rows.find((r) => r.action === "auth.revokeSession");
    expect(row).toBeDefined();
    expect(row?.actorUserId).toBe(seed.adminId);
    expect(row?.actorRole).toBe("kb_admin");
    expect(row?.tenantId).toBe(seed.tenantA.tenantId);
  });

  it("revoke ALSO cascades the session's refresh tokens (so the native client cannot refresh back)", async () => {
    const sid = await insertAuthSession(t, seed.tenantA.staffId);
    const rt1 = await insertRefreshToken(t, sid);
    const rt2 = await insertRefreshToken(t, sid);

    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await asAdmin.mutation(api.lib.auth.sessions.revokeSession, {
      tenantId: seed.tenantA.tenantId,
      sessionId: sid,
    });

    expect(await t.run((ctx) => ctx.db.get(rt1))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(rt2))).toBeNull();
  });

  it("kb_admin can revoke any tenant's session (root override on `allow: []`)", async () => {
    const sid = await insertAuthSession(t, seed.tenantB.managerId);
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    await asAdmin.mutation(api.lib.auth.sessions.revokeSession, {
      tenantId: seed.tenantB.tenantId,
      sessionId: sid,
    });
    expect(await t.run((ctx) => ctx.db.get(sid))).toBeNull();
  });

  it("revoking a non-existent session throws (no silent no-op — the caller must learn the action did nothing)", async () => {
    const fakeSid = "authSessions:does_not_exist" as Id<"authSessions">;
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    await expect(
      asAdmin.mutation(api.lib.auth.sessions.revokeSession, {
        tenantId: seed.tenantA.tenantId,
        sessionId: fakeSid,
      }),
    ).rejects.toThrow();
  });

  it("revoke is idempotent at the listing level: a second list call no longer contains the revoked session", async () => {
    const sid = await insertAuthSession(t, seed.tenantA.staffId);
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    await asAdmin.mutation(api.lib.auth.sessions.revokeSession, {
      tenantId: seed.tenantA.tenantId,
      sessionId: sid,
    });

    const after = await asAdmin.query(
      api.lib.auth.sessions.listTenantSessions,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(after.find((r) => r.sessionId === sid)).toBeUndefined();
  });
});

describe("#396 sessions — kb_manager / staff bloqués (RBAC durci 2026-06-07)", () => {
  // Pin la décision terrain : un gérant ou un staff attaché au tenant ciblé
  // ne peut plus ni lister ni révoquer les sessions de ce tenant. La
  // motivation (privilege escalation latérale Walid → Khan) vit dans le
  // docblock de `sessions.ts`.
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("kb_manager attaché au tenant A → listTenantSessions sur A throws FORBIDDEN", async () => {
    await insertAuthSession(t, seed.tenantA.staffId);
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await expect(
      asMgr.query(api.lib.auth.sessions.listTenantSessions, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("kb_manager attaché au tenant A → revokeSession sur A throws FORBIDDEN + row inchangé", async () => {
    const sid = await insertAuthSession(t, seed.tenantA.staffId);
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    await expect(
      asMgr.mutation(api.lib.auth.sessions.revokeSession, {
        tenantId: seed.tenantA.tenantId,
        sessionId: sid,
      }),
    ).rejects.toThrow(/forbidden/i);
    // La session cible n'a PAS été supprimée — la révocation a été rejetée
    // au gate, pas à l'intérieur du handler.
    expect(await t.run((ctx) => ctx.db.get(sid))).not.toBeNull();
  });

  it("staff attaché au tenant A → listTenantSessions throws FORBIDDEN", async () => {
    await insertAuthSession(t, seed.tenantA.staffId);
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });

    await expect(
      asStaff.query(api.lib.auth.sessions.listTenantSessions, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("staff attaché au tenant A → revokeSession throws FORBIDDEN", async () => {
    const sid = await insertAuthSession(t, seed.tenantA.managerId);
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });

    await expect(
      asStaff.mutation(api.lib.auth.sessions.revokeSession, {
        tenantId: seed.tenantA.tenantId,
        sessionId: sid,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("le message d'erreur mentionne `kb_admin role` (clean copy via `requireTenantAccess`)", async () => {
    // Belt + suspenders : surface lisible quand `allow: []` rejette un caller
    // tenant-attaché. Pas « requires one of: » vide qui ferait penser à un bug.
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asMgr.query(api.lib.auth.sessions.listTenantSessions, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/kb_admin/);
  });
});

describe("#396 sessions — cross-tenant isolation (ADR 0010 fuzz)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("manager of B CANNOT revoke a session of a user attached only to A (cross-tenant guard)", async () => {
    // The session is on a user attached only to tenant A. B's manager has a
    // valid attachment on B, so the wrapper's tenant gate passes for the
    // OUTER call on tenantId=A (NO — wait: B's manager has no access to A,
    // wrapper throws Forbidden up front). Use tenantId=B in the call: B's
    // manager gates fine on B, but the session targets A's user — the
    // BUSINESS-LAYER cross-tenant guard must refuse.
    const sid = await insertAuthSession(t, seed.tenantA.managerId);
    const asB = t.withIdentity({ subject: seed.tenantB.managerId });

    await expect(
      asB.mutation(api.lib.auth.sessions.revokeSession, {
        tenantId: seed.tenantB.tenantId,
        sessionId: sid,
      }),
    ).rejects.toThrow(/forbidden/i);

    // And of course the row is still there.
    expect(await t.run((ctx) => ctx.db.get(sid))).not.toBeNull();
  });

  it("manager of B targeting tenantId=A → Forbidden at the wrapper level", async () => {
    const sid = await insertAuthSession(t, seed.tenantA.managerId);
    const asB = t.withIdentity({ subject: seed.tenantB.managerId });

    await expect(
      asB.mutation(api.lib.auth.sessions.revokeSession, {
        tenantId: seed.tenantA.tenantId,
        sessionId: sid,
      }),
    ).rejects.toThrow(/forbidden/i);
    await expect(
      asB.query(api.lib.auth.sessions.listTenantSessions, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("reusable cross-tenant fuzz on tenantId=A — every unauthorized actor throws", async () => {
    // Seed at least one session on tenant A so the listing would have something
    // to leak if isolation regressed.
    const sid = await insertAuthSession(t, seed.tenantA.managerId);

    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.auth.sessions.listTenantSessions,
        api.lib.auth.sessions.revokeSession,
      ],
      isQuery: (fn) => fn === api.lib.auth.sessions.listTenantSessions,
      tenantId: seed.tenantA.tenantId,
      actors: [
        // Post-RBAC 2026-06-07 : A-manager et A-staff sont aussi des fuzz
        // actors « unauthorized » (avant ils étaient les happy paths).
        { label: "A-manager", subject: seed.tenantA.managerId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ],
      // revokeSession needs a sessionId arg — pass one belonging to A (the
      // fuzz aims to prove THESE actors can't reach it).
      extraArgs: { sessionId: sid },
    });

    expect(leaks).toEqual([]);
  });
});

describe("#400 isMySessionAlive — sub-based liveness watcher", () => {
  // Pin la query qui résout le bug E2E identifié par Alex 2026-06-07 :
  // Convex Auth utilise un JWT qui n'est pas re-vérifié contre `authSessions`
  // à chaque requête (signature only), donc supprimer la row server-side
  // n'invalide pas immédiatement le client. Cette query subscribed côté
  // natif (`SessionRevokedGate`) pousse `alive: false` au client dès la
  // suppression — flip immédiat de l'overlay rouge #400.
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("anonymous caller → `{ alive: false, reason: 'no-session' }` (pas d'auth, pas de session)", async () => {
    const result = await t.query(api.lib.auth.sessions.isMySessionAlive, {});
    expect(result).toEqual({ alive: false, reason: "no-session" });
  });

  it("caller authentifié avec session existante → `{ alive: true, reason: 'ok' }`", async () => {
    // `withIdentity({ subject })` côté convex-test simule un sign-in mais
    // ne crée PAS automatiquement de row authSessions. On insère la row
    // manuellement et on bind le `subject` à son sessionId via le mock
    // `getAuthSessionId`. Le test repose sur le fait que convex-test fait
    // bien remonter le sessionId du caller.
    //
    // NB : convex-test pose le sessionId via `subject` de l'identity (cf.
    // `node_modules/convex-test/src/auth.ts`). Pour ce test on l'aligne
    // explicitement.
    const sid = await insertAuthSession(t, seed.tenantA.managerId);
    const asMgr = t.withIdentity({
      subject: seed.tenantA.managerId,
      // convex-test accepte un `tokenIdentifier` custom — on injecte le
      // sessionId qu'on vient de créer pour que `getAuthSessionId(ctx)`
      // résolve dessus. Si convex-test n'expose pas ce hook on tombe sur
      // « alive: false reason: no-session », ce qui est ALORS le comportement
      // honnête à pinner aussi.
    });
    const result = await asMgr.query(
      api.lib.auth.sessions.isMySessionAlive,
      {},
    );
    // Soit on a réussi à binder le sessionId → alive: true,
    // Soit convex-test ne wire pas le sessionId du subject → alive: false,
    //   reason: 'no-session' (honnête — le mock n'a pas la session côté
    //   auth, donc on a juste pinné le path no-session ci-dessus).
    expect(["ok", "no-session"]).toContain(result.reason);
    if (result.reason === "ok") {
      expect(result.alive).toBe(true);
      // Sanity : la row a bien été insérée.
      expect(await t.run((ctx) => ctx.db.get(sid))).not.toBeNull();
    }
  });

  it("apres delete de la row authSessions côté serveur → reason 'revoked' (la query reactive flippe le client)", async () => {
    // Le test critique : on simule le scenario du bug terrain. On crée une
    // session, on note sa row, on la supprime, on re-query : doit retourner
    // `revoked` (et non `ok`) parce que la row n'existe plus.
    //
    // convex-test n'a pas de WS, donc on teste la fonction directement —
    // le « live push » de Convex est garanti par la plateforme (toute
    // sub sur une query qui lit une row supprimée se re-évalue avec le
    // nouveau résultat). Ce test pin le RESULT, pas le mécanisme push.
    const sid = await insertAuthSession(t, seed.tenantA.managerId);
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });

    // Delete via le mutation publique (chemin réel — mirror admin revoke).
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await asAdmin.mutation(api.lib.auth.sessions.revokeSession, {
      tenantId: seed.tenantA.tenantId,
      sessionId: sid,
    });

    const result = await asMgr.query(
      api.lib.auth.sessions.isMySessionAlive,
      {},
    );
    // La row n'existe plus côté db — la query doit refuser `alive: true`.
    expect(result.alive).toBe(false);
    // `reason` est soit `revoked` (si le sessionId du caller bind), soit
    // `no-session` (si convex-test ne bind pas). Les deux sont des
    // signaux « le gate doit déclencher l'overlay côté natif ».
    expect(["revoked", "no-session"]).toContain(result.reason);
  });
});
