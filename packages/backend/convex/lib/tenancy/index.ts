/**
 * Public API of the `tenancy` foundation module — the FIRST line of defence of
 * the 100% applicative multi-tenant isolation (ADR 0010), built on the single
 * sanctioned identity point `getCurrentActor` (ADR 0011).
 *
 * Business code imports its query/mutation builders from HERE, never from
 * Convex's raw `query` / `mutation`:
 *  - `kbAdminQuery` / `kbAdminMutation` — root (kb_admin) scope, any tenant.
 *    Used directly: `kbAdminQuery({ args, handler })`.
 *  - `tenantQuery` / `tenantMutation` — resto scope, explicit `tenantId` arg,
 *    allow-listed effective roles. They are FACTORIES taking `{ allow }`
 *    (default `["kb_manager"]`) and returning the builder, so usage is
 *    `tenantQuery({ allow: ["kb_manager", "staff"] })({ args, handler })` (or
 *    `tenantQuery()({ args, handler })` for the default allow). The handler ctx
 *    gains `{ actor, tenantId }`.
 *
 * The reusable cross-tenant fuzz harness (`runCrossTenantFuzz`,
 * `seedTwoTenantsAllRoles`) lives in `./fuzz` and is imported directly by test
 * suites (it depends on the convex-test handle), not re-exported here — a barrel
 * re-export would pull a test-only helper into the deploy graph.
 *
 * (The probe Convex functions in `_probes.ts` are test fixtures, registered by
 * their own module path, not part of this contract.)
 */
export {
  kbAdminMutation,
  kbAdminQuery,
  tenantMutation,
  tenantQuery,
  type TenantRole,
} from "./withTenant";
