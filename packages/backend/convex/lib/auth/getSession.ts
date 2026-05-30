import { ConvexError, v } from "convex/values";
import { query } from "../../_generated/server";
import { getCurrentActor } from "./getCurrentActor";

/**
 * B-AUTH-1 + B-AUTH-2 — `getSession`, the bootstrap query that answers
 * « qui es-tu ? » pour le shell unique d'`apps/admin` (ADR 0014 §3).
 *
 * Branches contractuelles :
 *  1. caller non authentifié → throw `Not authenticated` (le front affichera la
 *     page login).
 *  2. caller `users.role === kb_admin` → `{ isAdmin: true, tenants: [] }`. Le
 *     root n'a PAS de ligne `userTenants` par convention
 *     (`getCurrentActor.resolveEffectiveRole`) — son propre switcher est
 *     hydraté par une query séparée (hors scope de cet épique). Une éventuelle
 *     ligne `userTenants` parasite ne doit PAS fuiter ici.
 *  3. caller authentifié non-admin → on lit ses lignes `userTenants` ACTIVES
 *     (`detachedAt === undefined`) via l'index `by_user`, on joint chaque ligne
 *     avec sa table `tenants` pour récupérer `slug` + `name`, et on renvoie
 *     `{ tenantId, slug, name, role }` par ligne. `role` reste celui de la
 *     ligne `userTenants` (`kb_manager | staff`), PAS un badge global — un
 *     humain peut être manager ici et staff ailleurs (Walid).
 *
 * Règles de résilience (B-AUTH-2) non négociables :
 *  - Une ligne `userTenants` avec `detachedAt !== undefined` est IGNORÉE : un
 *    rattachement révoqué disparaît immédiatement du switcher (pas besoin
 *    d'attendre une suppression dure côté tenant).
 *  - Une ligne pointant vers un tenant `null` (supprimé entre la révocation et
 *    le ménage des rattachements) est IGNORÉE silencieusement — pas de throw.
 *    Mieux vaut un switcher légèrement réduit qu'une session qui plante.
 *
 * Cette query consomme UNIQUEMENT `getCurrentActor` — c'est le seul point
 * d'intégration sanctionné avec Convex Auth (ADR 0011). Ne JAMAIS appeler
 * `getAuthUserId` ici. Read-only, self-scoped (lit uniquement les rattachements
 * du caller), donc sûre à exposer avant les wrappers tenancy (la frontière de
 * sécurité reste backend, ADR 0010).
 */

/**
 * Forme de retour figée dès B-AUTH-1 et désormais hydratée par B-AUTH-2.
 * `tenants` porte, pour chaque tenant accessible par le caller, les coordonnées
 * minimales dont le front a besoin pour naviguer (`/t/[tenantId]/...`) et
 * étiqueter chaque option du switcher (ADR 0014 §3).
 */
const sessionTenantValidator = v.object({
  tenantId: v.id("tenants"),
  slug: v.string(),
  name: v.string(),
  role: v.union(v.literal("kb_manager"), v.literal("staff")),
});

const sessionValidator = v.object({
  isAdmin: v.boolean(),
  tenants: v.array(sessionTenantValidator),
});

export const getSession = query({
  args: {},
  returns: sessionValidator,
  handler: async (ctx) => {
    const actor = await getCurrentActor(ctx);
    if (actor === null) {
      // Le front bascule sur la page login sur ce throw (cf. ADR 0014 §3).
      throw new ConvexError({ message: "Not authenticated" });
    }

    // Root override : convention « pas de ligne userTenants » + switcher root
    // hydraté ailleurs. On ne LIT MÊME PAS userTenants pour un kb_admin — toute
    // ligne parasite resterait invisible côté shell.
    if (actor.role === "kb_admin") {
      return { isAdmin: true, tenants: [] };
    }

    // Gérant / staff : on agrège les rattachements ACTIFS uniquement.
    const attachments = await ctx.db
      .query("userTenants")
      .withIndex("by_user", (q) => q.eq("userId", actor.userId))
      .collect();

    const tenants: Array<{
      tenantId: (typeof attachments)[number]["tenantId"];
      slug: string;
      name: string;
      role: "kb_manager" | "staff";
    }> = [];

    for (const attachment of attachments) {
      // Soft-detach (révocation) → la ligne n'est plus servie au shell.
      if (attachment.detachedAt !== undefined) continue;

      const tenant = await ctx.db.get(attachment.tenantId);
      // Tenant supprimé entre la révocation des rattachements et le ménage :
      // résilience, on ignore silencieusement plutôt que faire échouer toute la
      // bootstrap query.
      if (tenant === null) continue;

      tenants.push({
        tenantId: attachment.tenantId,
        slug: tenant.slug,
        name: tenant.name,
        role: attachment.role,
      });
    }

    return { isAdmin: false, tenants };
  },
});
