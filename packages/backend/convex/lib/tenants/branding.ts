/**
 * PWA-S2 (#450) — PUBLIC tenant BRANDING query consumed by the PWA dynamic
 * manifest endpoint (`apps/web/src/app/manifest.webmanifest/route.ts`) +
 * the 3 dynamic icon routes (`/icon-192.png`, `/icon-512.png`,
 * `/apple-touch-icon.png`). These routes read the resolved tenantId from the
 * `__Host-kb_tenant` cookie set by the PWA edge middleware (#449) and need
 * the tenant's display name + primary color + logo URL to serve a branded
 * manifest + branded PNG icons (PRD §10 PWA Client Q4 manifest dynamique).
 *
 * SEPARATE from `lib/tenants/resolution.ts` (kept to the minimal `{ tenantId,
 * slug, name, status }` projection so SIRET / Stripe ids never leak through
 * the resolution surface). Branding is a distinct read concern — a tenant
 * may exist (resolution succeeds) but have no branding yet (fresh wizard
 * step 1, no logo/color uploaded). The route handlers fall back to safe
 * defaults via `decideManifest` (KB green + placeholder icon).
 *
 * Wrapper: PLAIN `query` (NOT `publicTenantQuery`). The PWA edge middleware
 * runs PRE-auth — the resolution step is precisely what yields the
 * `tenantId`, so we can't gate on it via `publicTenantQuery`. The MINIMAL
 * projection here (`name` / `primaryColor?` / `logoUrl?`) is what keeps
 * sensitive fields (siret, stripeStatus, printerConfig, uberCustomerId) off
 * the wire — same discipline as `resolution.ts`. The real isolation barrier
 * is downstream (`tenantQuery` / `publicTenantQuery` / `customerQuery`
 * wrappers, ADR 0010), never this surface.
 *
 * Tenant-not-found returns `null` (same tri-state convention as resolution).
 */
import { v } from "convex/values";
import { query } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { getTenantById } from "../tenancy";

/**
 * Minimal projection returned by the branding query. Strict subset of the
 * `tenants` row + flattened branding sub-object. `primaryColor` + `logoUrl`
 * stay optional — a freshly-provisioned tenant has neither.
 */
export type TenantBrandingProjection = {
  tenantId: Id<"tenants">;
  name: string;
  primaryColor?: string;
  logoUrl?: string;
};

/**
 * Resolve branding for a `__Host-kb_tenant=<id>` cookie value. The PWA
 * manifest endpoint + the 3 icon routes call this on every request that
 * hits the route. Returns `null` for an unknown / deleted tenant so the
 * routes serve a generic KB-branded fallback.
 */
export const byId = query({
  args: { tenantId: v.id("tenants") },
  returns: v.union(
    v.object({
      tenantId: v.id("tenants"),
      name: v.string(),
      primaryColor: v.optional(v.string()),
      logoUrl: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args): Promise<TenantBrandingProjection | null> => {
    const row = await getTenantById(ctx, args.tenantId);
    if (row === null) return null;
    return {
      tenantId: row._id,
      name: row.name,
      primaryColor: row.branding?.primaryColor,
      logoUrl: row.branding?.logoUrl,
    };
  },
});
