/**
 * Public API of the `auth` foundation module.
 *
 * `getCurrentActor` is the single sanctioned integration point with Convex Auth
 * (ADR 0011) — the only place allowed to call `getAuthUserId`. Business wrappers
 * (`tenantQuery` / `tenantMutation` / `kbAdminQuery`, story 1.x-C) consume it.
 * Import the actor resolver and its types from here, never from Convex Auth
 * directly.
 *
 * (The `whoAmI` Convex query is exposed as a function via its own file path
 * `api.lib.auth.getCurrentActor.whoAmI`; it is not re-exported here because
 * Convex registers functions by their module path, not via barrel files.)
 */
export {
  getCurrentActor,
  type Actor,
  type CurrentActor,
  type GlobalRole,
  type EffectiveRole,
} from "./getCurrentActor";

/**
 * `getSession` (B-AUTH-1) — bootstrap query of the unique shell described by
 * ADR 0014 §3. Re-exported from the module's barrel for non-Convex callers
 * (other backend modules / type imports). Convex itself still registers the
 * function by file path (`api.lib.auth.getSession.getSession`).
 */
export { getSession } from "./getSession";

/**
 * `listTenantSessions` / `revokeSession` (#396) — KB Admin Sessions actives
 * page + auto-logout côté native (#400). NOT re-exported through this barrel
 * to avoid a load-time cycle: `lib/auth/sessions.ts` depends on
 * `lib/tenancy/withTenant.ts` (for the `tenantQuery` / `tenantMutation`
 * wrappers), which in turn depends on `lib/auth/getCurrentActor.ts`. The
 * Convex `api.lib.auth.sessions.*` reference works without the barrel
 * re-export (Convex registers functions by file path, not by re-export). If
 * future callers need a type import, they should reach into `./sessions`
 * directly.
 */
