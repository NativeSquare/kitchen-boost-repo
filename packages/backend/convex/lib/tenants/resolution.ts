/**
 * PWA-S1 (#449) — PUBLIC tenant RESOLUTION queries consumed by the PWA edge
 * middleware (`apps/web/src/proxy.ts`) to map a request `host` (or a cookie
 * tenantId) onto the right `tenants` row (PRD §10 PWA Client, ADR 0008
 * « cookie host-only »).
 *
 * Three lookups, ALL public + unauthenticated (the middleware runs PRE-auth):
 *  - `bySlug(slug)`         — `<slug>.kitchen-boost.com` first-hit path
 *  - `byCustomDomain(domain)` — custom domain first-hit path (`bunsbao.fr`)
 *  - `byId(tenantId)`       — `__Host-kb_tenant=<id>` cookie revalidation
 *
 * Why a PLAIN `query` (not `publicTenantQuery`) — `publicTenantQuery` requires
 * a `tenantId` arg by construction; resolution is precisely the step that
 * yields the `tenantId`, so we can't gate on it here. We instead lean on
 * MINIMAL projection: each query returns only `{ tenantId, slug, name,
 * status }` — never `Doc<"tenants">` — so a future client logger or shared
 * type cannot leak `siret` / `stripeAccountId` / Stripe status / Uber
 * customer id / printer config / branding through this surface.
 *
 * Tenant-not-found returns `null` (not throw): the middleware needs to render
 * the « Resto non disponible » page or clear an orphan cookie without
 * catching an exception across an Edge-runtime boundary. Same tri-state
 * `undefined | null | row` convention as the rest of the codebase.
 *
 * Status is surfaced (not filtered to `active` here) so the middleware can
 * apply its own lifecycle gate — a `suspended` / `disabled` tenant is also
 * refused at the PWA edge, but the decision lives in
 * `decide-tenant-resolution.ts` (apps/web), not here, so the public read
 * stays a pure data lookup.
 */
import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { tenantStatus } from "../../table/tenants";
import {
  getTenantById,
  getTenantByCustomDomain,
  getTenantBySlug,
} from "../tenancy";

/**
 * Minimal projection returned by the three resolution queries — keeps SIRET /
 * Stripe ids / printer config / Uber customer id off the wire. Mirrored as
 * `ResolvedTenant` in the apps/web decision module so the two stay in lockstep.
 */
export type TenantResolutionProjection = {
  tenantId: Id<"tenants">;
  slug: string;
  name: string;
  status: "active" | "pending" | "suspended" | "disabled";
};

function project(row: {
  _id: Id<"tenants">;
  slug: string;
  name: string;
  status: "active" | "pending" | "suspended" | "disabled";
}): TenantResolutionProjection {
  return {
    tenantId: row._id,
    slug: row.slug,
    name: row.name,
    status: row.status,
  };
}

/**
 * Resolve a tenant from the `<slug>` of `<slug>.kitchen-boost.com`. Called by
 * the PWA edge middleware on the FIRST hit of a new sub-domain (before the
 * `__Host-kb_tenant` cookie is set). Returns `null` for an unknown slug so
 * the middleware routes to the « Resto non disponible » page.
 */
export const bySlug = query({
  args: { slug: v.string() },
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      slug: v.string(),
      name: v.string(),
      status: tenantStatus,
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<TenantResolutionProjection | null> => {
    const row = await getTenantBySlug(ctx, args.slug);
    if (row === null) return null;
    return project(row);
  },
});

/**
 * Resolve a tenant from a CUSTOM domain (`bunsbao.fr`). Called by the PWA
 * edge middleware when the request `host` does NOT match the bootstrap
 * `<slug>.kitchen-boost.com` pattern. Returns `null` for an unknown domain.
 */
export const byCustomDomain = query({
  args: { customDomain: v.string() },
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      slug: v.string(),
      name: v.string(),
      status: tenantStatus,
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<TenantResolutionProjection | null> => {
    const row = await getTenantByCustomDomain(ctx, args.customDomain);
    if (row === null) return null;
    return project(row);
  },
});

/**
 * Revalidate a stale `__Host-kb_tenant=<id>` cookie. The middleware calls
 * this when it doesn't trust the cookie blindly (configured via the
 * `revalidateCookie` flag in `decide-tenant-resolution.ts`). A dangling id
 * (tenant deleted between visits) returns `null` so the middleware clears
 * the cookie + routes to « Resto non disponible » (US 67, tenant orphan).
 */
export const byId = query({
  args: { tenantId: v.id("tenants") },
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      slug: v.string(),
      name: v.string(),
      status: tenantStatus,
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<TenantResolutionProjection | null> => {
    const row = await getTenantById(ctx, args.tenantId);
    if (row === null) return null;
    return project(row);
  },
});
