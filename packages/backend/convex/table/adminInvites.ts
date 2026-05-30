import { defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * B-AUTH-3 (EPIC #134, Option A) — Extension du schéma pour porter aussi des
 * invites gérant en plus des invites admin root, sans casser le flow existant.
 *
 *  - `targetRole` (optional union `kb_admin | kb_manager`) — défaut implicite
 *    `kb_admin` pour les invites legacy (rétrocompat : les lignes existantes ne
 *    portent pas ce champ et sont des invites root). Une future mutation
 *    `acceptInvite` étendue (slice ultérieur) discriminera là-dessus pour soit
 *    set `users.role = "kb_admin"` (comportement actuel) soit créer une ligne
 *    `userTenants(userId, tenantId, role: "kb_manager", ...)`.
 *  - `tenantId` (optional id `tenants`) — populé uniquement pour les invites
 *    `kb_manager` (cible le resto sur lequel attacher le gérant) ; absent pour
 *    `kb_admin` (l'admin root n'est attaché à aucun tenant, ADR 0014 §3).
 *  - Index `by_email_tenant` (`[email, tenantId]`) — consommé par B-AUTH-4
 *    (`inviteManager`) pour détecter une invite pending pour le couple
 *    `(email, tenantId)`, le même email pouvant légitimement être invité sur
 *    plusieurs restos (cas Walid Thai Street).
 *
 * Aucune mutation n'est touchée par ce slice : `inviteAdmin`, `getInvite`,
 * `listInvites`, `cancelInvite`, `acceptInvite` continuent de fonctionner
 * exactement comme avant.
 */
const documentSchema = {
  email: v.string(),
  name: v.string(),
  token: v.string(),
  invitedBy: v.id("users"),
  expiresAt: v.number(),
  acceptedAt: v.optional(v.number()),
  targetRole: v.optional(
    v.union(v.literal("kb_admin"), v.literal("kb_manager")),
  ),
  tenantId: v.optional(v.id("tenants")),
};

export const adminInvites = defineTable(documentSchema)
  .index("by_token", ["token"])
  .index("by_email", ["email"])
  .index("by_email_tenant", ["email", "tenantId"]);

export const adminInviteValidator = v.object({
  _id: v.id("adminInvites"),
  _creationTime: v.number(),
  email: v.string(),
  name: v.string(),
  token: v.string(),
  invitedBy: v.id("users"),
  expiresAt: v.number(),
  acceptedAt: v.optional(v.number()),
  targetRole: v.optional(
    v.union(v.literal("kb_admin"), v.literal("kb_manager")),
  ),
  tenantId: v.optional(v.id("tenants")),
});
