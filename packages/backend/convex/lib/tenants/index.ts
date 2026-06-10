/**
 * Public API of the `tenants` backend module — PWA-S1 (#449).
 *
 * The PWA edge middleware (`apps/web/src/proxy.ts`) consumes the resolution
 * queries below to map a request `host` (or a `__Host-kb_tenant` cookie)
 * onto the right `tenants` row before any auth runs. The lookups are PUBLIC
 * (anonymous) by construction — see `resolution.ts` for why a plain `query`
 * (rather than `publicTenantQuery`) is the right wrapper here.
 *
 * Convex registers functions by their module PATH, so callers invoke the
 * queries as `api.lib.tenants.resolution.{bySlug,byCustomDomain,byId}`;
 * re-exporting here states the module's contract in one place without
 * changing the paths.
 *
 * Distinct from `lib/admin/tenants.ts` (root-only CRUD-ish projections used
 * by the KB Admin shell) and `lib/tenancy/tenantsStore.ts` (the sanctioned
 * `ctx.db` seam ALL business code routes through, ADR 0010). This module is
 * the public PWA-facing read surface — and that's all.
 */
export * as resolution from "./resolution";
export * as branding from "./branding";
export * as payment from "./payment";
