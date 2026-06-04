/**
 * PWA-S1 (#449) — Next.js 16 middleware (named `proxy.ts` per the Next 16
 * convention — replaces the older `middleware.ts` filename, same as
 * `apps/admin/src/proxy.ts`).
 *
 * Scope of this middleware: ONE thing — the host → tenantId resolution shell
 * for the PWA Client (PRD §10 PWA Client, ADR 0008 « cookie host-only »).
 *
 * Flow on every request:
 *  1. Read the `host` header + the `__Host-kb_tenant` cookie.
 *  2. Ask the pure decision function (`decideTenantResolution`) what to do.
 *     The IO adapters (Convex `fetchQuery`) are wired here; the branching
 *     logic + the edge-cases all live in the unit-tested
 *     `lib/tenant-resolver/decide-tenant-resolution.ts`.
 *  3. Verdict `rewrite` → `NextResponse.rewrite` internal (NEVER redirect —
 *     preserves SEO + the cookie scope on the SAME host), optionally
 *     stamping `__Host-kb_tenant` on the FIRST hit of a host.
 *  4. Verdict `error` → `NextResponse.rewrite` to `/erreur`, optionally
 *     clearing the cookie when it pointed at a dead / inactive tenant
 *     (US 67, tenant orphan).
 *
 * The cookie is `__Host-` prefixed → `Secure` + no `Domain` + `Path=/` are
 * mandatory (browser enforces). This pins the cookie to the resolved host,
 * so it can NEVER leak across tenant hosts (each resto = its own host =
 * separate cookie jar, ADR 0008 amendment 2026-05-25).
 *
 * Why the lookups are PUBLIC queries (`api.lib.tenants.resolution.*`) and not
 * Convex Auth-gated — the middleware runs BEFORE any auth (cookie is the
 * tenant cookie, not a Convex Auth session cookie). The exposed projection
 * is MINIMAL (no SIRET / Stripe ids), and the real isolation barrier is
 * BACKEND (`tenantQuery` / `publicTenantQuery` / `customerQuery` wrappers,
 * ADR 0010) — never this surface.
 */
import { type NextRequest, NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import {
  decideTenantResolution,
  type ResolvedTenant,
} from "@/lib/tenant-resolver";
import {
  WALLET_BRIDGE_COOKIE_MAX_AGE_S,
  WALLET_BRIDGE_PENDING_COOKIE,
  decideWalletBridgeInterception,
} from "@/lib/wallet-bridge";

const TENANT_COOKIE = "__Host-kb_tenant";
const ROOT_DOMAIN = "kitchen-boost.fr";
/** 30-day cookie lifetime (PRD §10 — refresh on every hit). */
const COOKIE_MAX_AGE_S = 60 * 60 * 24 * 30;

/**
 * Adapters that turn the public resolution queries into the shape the pure
 * `decideTenantResolution` function expects. Kept inline so the IO surface is
 * one file; the decision logic itself stays unit-tested in
 * `lib/tenant-resolver/decide-tenant-resolution.test.ts`.
 */
async function fetchBySlug(slug: string): Promise<ResolvedTenant | null> {
  return fetchQuery(api.lib.tenants.resolution.bySlug, { slug });
}

async function fetchByCustomDomain(
  customDomain: string,
): Promise<ResolvedTenant | null> {
  return fetchQuery(api.lib.tenants.resolution.byCustomDomain, {
    customDomain,
  });
}

async function fetchById(tenantId: string): Promise<ResolvedTenant | null> {
  // Cast through `unknown` — the cookie value is an opaque string here; the
  // Convex argument validator rejects a syntactically-invalid id with a
  // throw, which we catch as "null" (treat as orphan, clear cookie).
  try {
    return await fetchQuery(api.lib.tenants.resolution.byId, {
      tenantId: tenantId as Id<"tenants">,
    });
  } catch {
    return null;
  }
}

export default async function proxy(
  request: NextRequest,
): Promise<NextResponse> {
  const host = request.headers.get("host") ?? "";
  const cookieTenantId = request.cookies.get(TENANT_COOKIE)?.value ?? null;

  // PWA-S9b (#461) — handle the Wallet pass back-of-pass `?wallet=<serial>`
  // deep-link FIRST (decisions-log Q5, US 39 / 40 / 41 / 42). We must do
  // this BEFORE returning a tenant-rewrite, because cleaning the URL
  // (`?wallet` stripped from the address bar — US 42) requires a 307
  // redirect, not a Next rewrite (rewrite keeps the URL the browser sees
  // — the param would stay).
  //
  // Ordering rationale:
  //  1. The TENANT cookie must still be set on this hop, so the redirect
  //     target's first paint can read it (and so RSC layout / pages can
  //     resolve the tenant). We compute the tenant verdict first and only
  //     short-circuit on a `rewrite` verdict — an `error` verdict bypasses
  //     the bridge (wrong host → not a real tap, never bridge).
  //  2. The BRIDGE cookie is set on the same response carrying the tenant
  //     cookie + the 307. The client `<WalletBridgeRunner>` then reads
  //     `__Host-kb_wallet_bridge_pending` from RSC, runs `signIn` and
  //     calls `/api/wallet-bridge/clear` to wipe it.
  //  3. For `kind: "strip-only"` (malformed serial, US 42 « graceful »),
  //     we still 307 to the clean URL but do NOT set the bridge cookie.
  //     The user sees a clean address bar and a normal anonymous flow —
  //     no crash, no probing surface.

  const tenantVerdict = await decideTenantResolution({
    host,
    cookieTenantId,
    rootDomain: ROOT_DOMAIN,
    fetchBySlug,
    fetchByCustomDomain,
    fetchById,
    // Trust the cookie on the fast path; the downstream tenant-scoped
    // queries throw if the tenant has been deleted in the meantime — see
    // PWA-S1 (#449) decision log. A future hook (e.g. tenant-lifecycle
    // bump) can flip this to `true` selectively without touching the
    // decision function.
    revalidateCookie: false,
  });

  if (tenantVerdict.kind === "rewrite") {
    const bridgeVerdict = decideWalletBridgeInterception({
      url: request.nextUrl.toString(),
    });
    if (bridgeVerdict.kind !== "passthrough") {
      // 307 to the clean URL (preserves the verb, same as rewrite does for
      // its target). We carry BOTH cookies on the same response so the
      // browser stamps the tenant cookie + the bridge-pending cookie in
      // ONE round-trip — the next hit already has both.
      const response = NextResponse.redirect(bridgeVerdict.cleanUrl, 307);
      if (tenantVerdict.setCookie) {
        response.cookies.set({
          name: TENANT_COOKIE,
          value: tenantVerdict.tenantId,
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: COOKIE_MAX_AGE_S,
        });
      }
      if (bridgeVerdict.kind === "intercept") {
        // Short-lived (5 min) — the client runs the `signIn` chain on
        // first mount of the redirect target. If something stalls
        // (background tab, JS disabled), the cookie expires rather than
        // hanging a stale serial indefinitely. `__Host-` pins the cookie
        // to the resolved host (no `Domain`), so a bridge cookie minted
        // on resto A can never leak to resto B — same isolation rule as
        // `__Host-kb_tenant` (ADR 0008 amendment 2026-05-25).
        response.cookies.set({
          name: WALLET_BRIDGE_PENDING_COOKIE,
          value: bridgeVerdict.serial,
          httpOnly: false, // the client-side `<WalletBridgeRunner>` reads it
          secure: true,
          sameSite: "lax",
          path: "/",
          maxAge: WALLET_BRIDGE_COOKIE_MAX_AGE_S,
        });
      }
      return response;
    }

    // Pass through unchanged. NEVER redirect — a redirect would lose the
    // cookie (it would be set on the destination URL, not the request
    // origin). Rewrite preserves the URL the browser sees while letting
    // Next render whatever is at the URL path.
    const response = NextResponse.next();
    if (tenantVerdict.setCookie) {
      response.cookies.set({
        name: TENANT_COOKIE,
        value: tenantVerdict.tenantId,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: COOKIE_MAX_AGE_S,
        // No `domain`: required by the `__Host-` prefix (host-only cookie).
      });
    }
    return response;
  }

  // tenantVerdict.kind === "error"
  const errorUrl = request.nextUrl.clone();
  errorUrl.pathname = "/erreur";
  errorUrl.searchParams.set("reason", tenantVerdict.reason);
  const response = NextResponse.rewrite(errorUrl);
  if (tenantVerdict.clearCookie) {
    response.cookies.delete(TENANT_COOKIE);
  }
  return response;
}

export const config = {
  // Run middleware on every page route but skip static assets + Next internals.
  // The /api/* routes are excluded — the web-push send route does its own
  // HMAC verification and is not tenant-scoped at the edge.
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
