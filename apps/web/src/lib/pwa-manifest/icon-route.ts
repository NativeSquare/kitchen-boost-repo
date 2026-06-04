/**
 * PWA-S2 (#450) — shared icon-route helper.
 *
 * The 3 dynamic icon routes (`/icon-192.png`, `/icon-512.png`,
 * `/apple-touch-icon.png`) share the SAME logic:
 *  1. Read the resolved `tenantId` from the `__Host-kb_tenant` cookie.
 *  2. Fetch the tenant's branding via `tenants.branding.byId`.
 *  3. If a `logoUrl` is set, FETCH it server-side and stream the bytes
 *     through (Content-Type → image/png, long cache).
 *  4. Otherwise serve a tiny placeholder PNG so the manifest install prompt
 *     still has SOMETHING to render (Chrome refuses to surface A2HS when
 *     a referenced icon is 404).
 *
 * Resizing on the fly is deferred V2 — the tenant's uploaded logo is
 * already a sane size and Android scales the icon for the launcher tile.
 * Adding `sharp` here would bloat the apps/web Lambda for marginal benefit.
 *
 * Cache strategy: the icon PNG bytes are immutable in practice — when the
 * gérant uploads a new logo, `tenant.updateSettings` re-stamps `logoUrl`
 * with a new key, so the cached PNG at the OLD path doesn't matter. We
 * still keep a short server-side cache (1h) to absorb the install-prompt
 * burst, mirroring the manifest endpoint.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

const TENANT_COOKIE = "__Host-kb_tenant";
/** PRD §10 Q4 — long cache, matches the manifest endpoint. */
const CACHE_CONTROL = "public, max-age=3600, s-maxage=3600";

/**
 * A 1×1 transparent PNG (67 bytes). The smallest valid PNG that Chrome will
 * accept as a manifest icon, used as the fallback when a tenant has no
 * uploaded logo yet (fresh wizard step 1, pre-Phase-C onboarding). The
 * fallback NEVER replaces a real logo — only fills the slot so A2HS works.
 */
const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function placeholderResponse(): NextResponse {
  const bytes = Buffer.from(PLACEHOLDER_PNG_BASE64, "base64");
  // Node Buffer extends Uint8Array; toResponseBody is happy with either.
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": CACHE_CONTROL,
    },
  });
}

async function readLogoUrl(): Promise<string | null> {
  const cookieStore = await cookies();
  const tenantId = cookieStore.get(TENANT_COOKIE)?.value as
    | Id<"tenants">
    | undefined;
  if (tenantId === undefined) return null;
  try {
    const row = await fetchQuery(api.lib.tenants.branding.byId, { tenantId });
    return row?.logoUrl ?? null;
  } catch {
    return null;
  }
}

/**
 * Serve a per-tenant icon at `size×size`. The size is informational only V1
 * — we serve the gérant's uploaded logo verbatim (no on-the-fly resize) and
 * let the browser scale. Future V2 resize would key the cache on size +
 * logoUrl.
 */
export async function serveTenantIcon(): Promise<NextResponse> {
  const logoUrl = await readLogoUrl();
  if (logoUrl === null) return placeholderResponse();
  try {
    const upstream = await fetch(logoUrl);
    if (!upstream.ok) return placeholderResponse();
    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        // Force PNG content-type even if the upstream lied — the manifest
        // declares `image/png` for every icon and a mismatch would break
        // Chrome's strict manifest validation.
        "Content-Type": "image/png",
        "Cache-Control": CACHE_CONTROL,
      },
    });
  } catch {
    return placeholderResponse();
  }
}
