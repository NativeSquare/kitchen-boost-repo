import { ConvexError, v } from "convex/values";
import { query } from "../../_generated/server";
import { getCurrentActor } from "./getCurrentActor";

/**
 * B-AUTH-1 — `getSession`, the bootstrap query that answers « qui es-tu ? »
 * pour le shell unique d'`apps/admin` (ADR 0014 §3).
 *
 * Premier tracer-bullet de D1 : on ne livre ici que les TROIS branches qui ne
 * touchent pas encore aux tenants ; la liste reste vide dans toutes. Le slice
 * suivant (B-AUTH-2) remplira `tenants` pour les gérants.
 *
 *  1. caller non authentifié → throw `Not authenticated` (le front affichera la
 *     page login).
 *  2. caller `users.role === kb_admin` → `{ isAdmin: true, tenants: [] }`. Le
 *     root n'a PAS de ligne `userTenants` par convention
 *     (`getCurrentActor.resolveEffectiveRole`).
 *  3. caller authentifié sans `kb_admin` ET sans aucune ligne `userTenants`
 *     active → `{ isAdmin: false, tenants: [] }` (le front affichera « pas de
 *     resto rattaché »). Dans CE slice on retourne déjà cette forme pour TOUT
 *     non-admin, attaché ou non — `tenants: []` est correct pour la branche
 *     orphan ET sert de placeholder explicite pour le gérant tant que B-AUTH-2
 *     n'a pas branché le store.
 *
 * Cette query consomme UNIQUEMENT `getCurrentActor` — c'est le seul point
 * d'intégration sanctionné avec Convex Auth (ADR 0011). Ne JAMAIS appeler
 * `getAuthUserId` ici. Read-only, self-scoped, donc sûre à exposer avant les
 * wrappers tenancy (la frontière de sécurité reste backend, ADR 0010).
 */

/**
 * Forme de retour figée dès ce slice. `tenants` carries, per tenant accessible
 * by the caller, the minimal coordinates the front needs to navigate
 * (`/t/[tenantId]/...`) et étiqueter chaque option du switcher (ADR 0014 §3).
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
    // B-AUTH-2 remplira `tenants` pour les non-admin attachés ; pour ce slice
    // les trois branches retournent la même liste vide — la SHAPE est figée.
    return {
      isAdmin: actor.role === "kb_admin",
      tenants: [],
    };
  },
});
