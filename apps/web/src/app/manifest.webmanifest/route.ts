/**
 * PWA-S2 (#450) — dynamic per-tenant Web App Manifest endpoint.
 *
 * Routed at `/manifest.webmanifest` so the HTML `<link rel="manifest" href="/
 * manifest.webmanifest">` (root layout) lands here. The route reads the
 * resolved `tenantId` from the `__Host-kb_tenant` cookie set by the PWA
 * edge middleware (#449), fetches the tenant's branding via the PUBLIC
 * `tenants.branding.byId` query (#450 backend brick), and serves the JSON
 * shape decided by the pure `decideManifest` (vitest-pinned).
 *
 * Cache strategy (PRD §10 PWA Client Q4): `Cache-Control: public, max-age=
 * 3600, s-maxage=3600` — Chrome caches the parsed manifest aggressively for
 * the A2HS prompt + the standalone shell. Branding edits land within 1h
 * (acceptable trade-off vs round-tripping Convex on every PWA frame).
 *
 * Falls back to a generic KitchenBoost manifest when:
 *  - no cookie is set (the user landed at the apex `kitchen-boost.fr`, or
 *    the middleware was bypassed for an asset request, etc.);
 *  - the cookie tenantId no longer resolves (deleted between visits — same
 *    « tenant orphan » story as #449, but the cookie clear happens server-
 *    side by the edge, not here).
 * The generic fallback keeps Chrome happy (a missing manifest blocks A2HS)
 * and degrades gracefully.
 *
 * Runtime: defaults to Node — the route does a Convex `fetchQuery`, which is
 * compatible with both runtimes; Node is the safer default until we measure
 * cold-start cost vs Edge.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { decideManifest, type ManifestInputs } from "@/lib/pwa-manifest";

const TENANT_COOKIE = "__Host-kb_tenant";
/** PRD §10 Q4 — 1 hour CDN cache for branding edits to propagate. */
const CACHE_CONTROL = "public, max-age=3600, s-maxage=3600";

async function readBranding(
  tenantId: Id<"tenants"> | undefined,
): Promise<ManifestInputs> {
  if (tenantId === undefined) {
    // No cookie ⇒ generic KB shell. The fallback is "" — `decideManifest`
    // promotes it to "KitchenBoost".
    return { name: "" };
  }
  try {
    const row = await fetchQuery(api.lib.tenants.branding.byId, { tenantId });
    if (row === null) return { name: "" };
    return {
      name: row.name,
      primaryColor: row.primaryColor,
      logoUrl: row.logoUrl,
    };
  } catch {
    // A malformed cookie (not a valid Id format) throws inside the Convex
    // arg validator — degrade to the generic shell rather than 500.
    return { name: "" };
  }
}

export async function GET(): Promise<NextResponse> {
  const cookieStore = await cookies();
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;
  const branding = await readBranding(tenantId);
  const manifest = decideManifest(branding);
  return NextResponse.json(manifest, {
    headers: {
      // Web App Manifest registered MIME type.
      "Content-Type": "application/manifest+json",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}
