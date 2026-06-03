import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { tenantMutation, tenantQuery } from "../tenancy";

/**
 * #396 (KB Admin — Page Sessions actives + bouton « Révoquer »).
 *
 * Page UI Admin par tenant + mutation backend partagée avec #400 côté native
 * (auto-logout sur session révoquée). Implémente la « Révocation session
 * distante » du PRD 20 §13 (vol / perte / employé licencié / device en SAV,
 * compliance RGPD Article 2 ter contrat). ADR 0014 (shell KB Admin scoping
 * RBAC) — la frontière de sécurité reste backend (ADR 0010), pas la
 * navigation front.
 *
 * Surface backend (les deux fonctions sont Convex-registered par PATH —
 * appelées `api.lib.auth.sessions.listTenantSessions` et
 * `api.lib.auth.sessions.revokeSession`) :
 *
 *  - `listTenantSessions({ tenantId })` — `tenantQuery({ allow:
 *    ["kb_manager"] })`. Retourne les `authSessions` ACTIVES dont le
 *    `userId` a une ligne `userTenants` ACTIVE sur ce tenant. Projection
 *    minimale (sessionId + identité + lifetime) — JAMAIS le row `users`
 *    brut ni l'`expirationTime` Convex Auth interne.
 *
 *  - `revokeSession({ tenantId, sessionId })` — `tenantMutation({ allow:
 *    ["kb_manager"], audit: true, action: "auth.revokeSession" })`.
 *    Vérifie que la session cible appartient à un user attaché au
 *    `tenantId` (cross-tenant guard, layer 1 — ADR 0010 / fuzz). Supprime
 *    le row `authSessions` ET cascade les `authRefreshTokens` indexés par
 *    `sessionId` (sinon le client peut refresh la session révoquée). La
 *    ligne d'audit est écrite par le wrapper (composition `onSuccess`,
 *    même transaction).
 *
 * Pourquoi `lib/auth/` plutôt que `lib/admin/` :
 *  - `lib/auth/**` est l'un des SANCTIONED PATHS de `no-untenanted-query`
 *    (ADR 0010, eslint config) — c'est le seul endroit du codebase autorisé
 *    à toucher `authSessions` et `authRefreshTokens`, les tables propres à
 *    Convex Auth (cf. `getCurrentActor` pour l'autre site sanctionné).
 *  - La mutation est **partagée** avec #400 côté native (auto-logout sur
 *    session révoquée détecté en sub Convex temps réel). Elle DOIT vivre
 *    dans le domaine `auth`, pas dans le shell KB Admin.
 *
 * Pourquoi PAS d'augmentation de schéma :
 *  - Convex Auth gère déjà la persistance des sessions (`authTables`). La
 *    table `authSessions` ne porte que `{ userId, expirationTime,
 *    _creationTime }` — pas de device / IP / UA / last_seen. Les fields
 *    `device` / `osVersion` du PRD 20 §13 viendront via la table `devices`
 *    existante (#393) une fois liée à la session côté native (#400). V1
 *    minimal : on expose ce que la base contient (identité + lifetime),
 *    le reste s'enrichit incrémentalement.
 */

/**
 * Forme d'une ligne du listing exposée au front. Inclut le `sessionId` (clé
 * de révocation), l'identité minimale (`userName?` / `userEmail?` — projetés
 * du row `users`, JAMAIS le doc brut), et le lifetime (`createdAt` /
 * `expiresAt` — ms epoch). PAS d'`expirationTime` brut (le nom Convex Auth
 * fuirait l'implémentation IdP — ADR 0011 « identité encapsulée »).
 */
const sessionRowValidator = v.object({
  sessionId: v.id("authSessions"),
  userId: v.id("users"),
  userName: v.optional(v.string()),
  userEmail: v.optional(v.string()),
  createdAt: v.number(),
  expiresAt: v.number(),
});

/**
 * Reusable helper : projecte un `authSessions` doc + le `users` row joint
 * vers la shape exposée par le listing. Centralisé pour que le validateur
 * `sessionRowValidator` et la projection effective restent en phase.
 */
function projectSessionRow(
  session: Doc<"authSessions">,
  user: Doc<"users"> | null,
): {
  sessionId: Id<"authSessions">;
  userId: Id<"users">;
  userName: string | undefined;
  userEmail: string | undefined;
  createdAt: number;
  expiresAt: number;
} {
  return {
    sessionId: session._id,
    userId: session.userId,
    userName: user?.name,
    userEmail: user?.email,
    createdAt: session._creationTime,
    expiresAt: session.expirationTime,
  };
}

/**
 * Identifie l'ensemble des `userId` ayant une ligne `userTenants` ACTIVE sur
 * `tenantId`. Source de vérité du « périmètre sessions » exposé pour ce
 * tenant — alignée sur `getCurrentActor.resolveEffectiveRole` (un
 * `detachedAt` set = pas d'accès). `kb_admin` n'a pas de ligne ; le root
 * override passe par le wrapper, pas par cette fonction.
 */
async function listActiveUserIdsForTenant(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Set<Id<"users">>> {
  const attachments = await ctx.db
    .query("userTenants")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  const userIds = new Set<Id<"users">>();
  for (const row of attachments) {
    if (row.detachedAt !== undefined) continue;
    userIds.add(row.userId);
  }
  return userIds;
}

// ---------------------------------------------------------------------------
// `listTenantSessions` — query
// ---------------------------------------------------------------------------

export const listTenantSessions = tenantQuery({
  allow: ["kb_manager"],
})({
  args: {},
  returns: v.array(sessionRowValidator),
  handler: async (ctx) => {
    const userIds = await listActiveUserIdsForTenant(ctx, ctx.tenantId);
    if (userIds.size === 0) return [];

    // For each in-scope user, list their active authSessions via the
    // by-userId index Convex Auth ships on the table. Sessions are sorted by
    // creation time desc (most recent first) so the page lists the freshest
    // session at the top.
    const rows: Array<ReturnType<typeof projectSessionRow>> = [];
    for (const userId of userIds) {
      const sessions = await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", userId))
        .collect();
      const user = await ctx.db.get(userId);
      for (const session of sessions) {
        rows.push(projectSessionRow(session, user));
      }
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    return rows;
  },
});

// ---------------------------------------------------------------------------
// `revokeSession` — mutation (shared with #400 native auto-logout)
// ---------------------------------------------------------------------------

export const revokeSession = tenantMutation({
  allow: ["kb_manager"],
})({
  args: { sessionId: v.id("authSessions") },
  returns: v.null(),
  audit: true,
  action: "auth.revokeSession",
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (session === null) {
      // Pas de no-op silencieux : le client doit savoir que la révocation
      // n'a rien fait (race conditions, sessionId périmé, …).
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Session introuvable",
      });
    }

    // Cross-tenant guard (layer 1) — le wrapper a déjà gated l'accès du
    // CALLER au tenant ; reste à vérifier que la session CIBLE appartient à
    // un user du même tenant (sinon Walid → Khan tentant de révoquer une
    // session de B depuis le shell de A passerait). On accepte un caller
    // `kb_admin` (root override) sur la cible aussi : si la session-cible
    // user est attached ailleurs, on ne refuse PAS un admin (le root a
    // illimité par définition, cf. ADR 0010). Sinon, le user-cible doit
    // avoir une ligne active sur `ctx.tenantId`.
    if (ctx.actor.role !== "kb_admin") {
      const targetUserIds = await listActiveUserIdsForTenant(ctx, ctx.tenantId);
      if (!targetUserIds.has(session.userId)) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Forbidden: cette session n'appartient pas à ce tenant",
        });
      }
    }

    // Cascade les refresh tokens de la session — sinon le client peut
    // échanger un refresh token valide contre une nouvelle paire et la
    // révocation n'a aucun effet (cf. `deleteAllRefreshTokens` dans
    // `@convex-dev/auth/src/server/implementation/refreshTokens.ts`).
    const refreshTokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", sessionId))
      .collect();
    for (const rt of refreshTokens) {
      await ctx.db.delete(rt._id);
    }

    await ctx.db.delete(sessionId);
    return null;
  },
});
