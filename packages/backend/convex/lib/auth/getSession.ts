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
 *
 * `user` (ajouté lors du cleanup scaffold root-only) porte le minimum dont le
 * shell a besoin pour le NavUser footer (nom/email/avatar), commun KB Admin ET
 * KB Manager. Remplace l'ancien `api.table.admin.currentAdmin` qui filtrait
 * sur `role === "kb_admin"` (un manager ressortait `null` → NavUser vide).
 * Chaque champ est `optional` parce que le baseline `users` de Convex Auth
 * peut ne pas les avoir tous (un compte fraîchement signUp peut n'avoir que
 * `email`, l'`image` n'est posée que pour les providers OAuth, etc.).
 */
const sessionTenantValidator = v.object({
  tenantId: v.id("tenants"),
  slug: v.string(),
  name: v.string(),
  role: v.union(v.literal("kb_manager"), v.literal("staff")),
});

const sessionUserValidator = v.object({
  userId: v.id("users"),
  name: v.optional(v.string()),
  email: v.optional(v.string()),
  image: v.optional(v.string()),
});

const sessionValidator = v.object({
  isAdmin: v.boolean(),
  tenants: v.array(sessionTenantValidator),
  user: sessionUserValidator,
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

    // Le NavUser du shell consomme `user` quel que soit le rôle. On lit le row
    // `users` UNE fois ici (la même Doc que `getCurrentActor` a déjà chargée
    // pour résoudre le rôle) et on projette le strict minimum d'affichage.
    const userRow = await ctx.db.get(actor.userId);
    // userRow ne peut pas être null à ce stade (getCurrentActor l'a déjà lu),
    // mais on le narrow côté types par sécurité.
    const userProjection = {
      userId: actor.userId,
      name: userRow?.name,
      email: userRow?.email,
      image: userRow?.image,
    };

    // Root override : convention « pas de ligne userTenants » + switcher root
    // hydraté ailleurs. On ne LIT MÊME PAS userTenants pour un kb_admin — toute
    // ligne parasite resterait invisible côté shell.
    if (actor.role === "kb_admin") {
      return { isAdmin: true, tenants: [], user: userProjection };
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

    return { isAdmin: false, tenants, user: userProjection };
  },
});
