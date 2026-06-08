/**
 * PWA-S1 (#449) — `decideTenantResolution` — the PURE decision function that
 * powers the PWA edge middleware (`apps/web/src/proxy.ts`).
 *
 * The middleware is the host → tenantId resolution shell described in PRD
 * §10 PWA Client + ADR 0008 (cookie host-only). It's deliberately thin: it
 * reads `host` + cookie, asks THIS function what to do, then performs the IO
 * (Convex round-trip, `Set-Cookie`, `NextResponse.rewrite` / error). The
 * decision logic lives HERE so vitest can pin every branch without spinning
 * up Next.js or an edge runtime.
 *
 * Verdict is a discriminated union (`{ kind: "rewrite", ... } | { kind:
 * "error", ... }`) so the IO layer can `switch (verdict.kind)` without
 * peeking at the strings.
 */
import type { Id } from "@packages/backend/convex/_generated/dataModel";

/** Minimal projection returned by the public `tenants.resolution.*` queries. */
export type ResolvedTenant = {
  tenantId: Id<"tenants">;
  slug: string;
  name: string;
  status: "active" | "pending" | "suspended" | "disabled";
};

/** Async resolver injected by the middleware (Convex `fetchQuery` in prod). */
type FetchResolver<TKey extends string> = (
  key: TKey,
) => Promise<ResolvedTenant | null>;

export type TenantResolutionInput = {
  /** Raw `host` header from the request (may include port + mixed-case). */
  host: string;
  /** Tenant id read from the `__Host-kb_tenant` cookie, or `null`. */
  cookieTenantId: string | null;
  /** Marketing apex (`kitchen-boost.com`). Everything under it is a tenant. */
  rootDomain: string;
  /** Convex `fetchQuery(api.lib.tenants.resolution.byId)` adapter. */
  fetchById: FetchResolver<string>;
  /** Convex `fetchQuery(api.lib.tenants.resolution.bySlug)` adapter. */
  fetchBySlug: FetchResolver<string>;
  /** Convex `fetchQuery(api.lib.tenants.resolution.byCustomDomain)` adapter. */
  fetchByCustomDomain: FetchResolver<string>;
  /**
   * Force a `byId` round-trip on every cookie hit (default = false, fast
   * path). Wire to `true` from the middleware on auth-sensitive routes or
   * for the auto-invalidation hook (e.g. after the tenant lifecycle changes
   * on KB Admin). Cookie fast path stays the norm — re-validating EVERY
   * request would defeat the cookie's whole purpose.
   */
  revalidateCookie?: boolean;
};

export type TenantResolutionVerdict =
  | {
      kind: "rewrite";
      tenantId: string;
      /**
       * `true` on the first hit of a host (no cookie yet, or malformed
       * cookie that we cleared): the middleware sets `__Host-kb_tenant` so
       * subsequent hits skip the round-trip.
       */
      setCookie: boolean;
    }
  | {
      kind: "error";
      reason: "tenant-not-found" | "tenant-inactive" | "apex-host";
      /**
       * `true` when a stale `__Host-kb_tenant` cookie was the source of the
       * error (orphan tenant / lifecycle-off / malformed): the middleware
       * MUST clear it before rendering the error page so the next hit
       * doesn't keep pointing at the same dead row.
       */
      clearCookie: boolean;
    };

/** Strip a possible `:port` suffix and lowercase the host. */
function normaliseHost(host: string): string {
  const noPort = host.split(":")[0] ?? "";
  return noPort.toLowerCase();
}

/**
 * Derive the sub-domain slug from a `<slug>.<rootDomain>` host, IF the host
 * is EXACTLY one label deeper than the root domain. Anything else (apex,
 * custom domain, multi-label) returns `null` so the caller treats it as a
 * custom-domain candidate (or apex).
 *
 * The single-label depth guard prevents an accidental tenant-takeover via a
 * wildcard DNS misconfig (e.g. `weird.bunsbao.kitchen-boost.com` must NOT
 * automatically resolve to `bunsbao`).
 */
function deriveSlug(normalisedHost: string, rootDomain: string): string | null {
  const suffix = `.${rootDomain.toLowerCase()}`;
  if (!normalisedHost.endsWith(suffix)) return null;
  const head = normalisedHost.slice(0, normalisedHost.length - suffix.length);
  if (head === "" || head.includes(".")) return null;
  return head;
}

/** A cookie value is "present" iff it's a non-empty string. */
function isUsableCookie(
  cookieTenantId: string | null,
): cookieTenantId is string {
  return typeof cookieTenantId === "string" && cookieTenantId.length > 0;
}

/** Cookie value valid + (optionally) revalidated → fast-path rewrite. */
async function decideCookiePath(
  cookieTenantId: string,
  input: TenantResolutionInput,
): Promise<TenantResolutionVerdict> {
  if (input.revalidateCookie !== true) {
    // Fast path: trust the cookie. The downstream tenant-scoped queries
    // will reject if the tenant has been deleted in the meantime — the
    // middleware doesn't have to.
    return { kind: "rewrite", tenantId: cookieTenantId, setCookie: false };
  }
  const row = await input.fetchById(cookieTenantId);
  if (row === null) {
    return { kind: "error", reason: "tenant-not-found", clearCookie: true };
  }
  if (row.status !== "active") {
    return { kind: "error", reason: "tenant-inactive", clearCookie: true };
  }
  return { kind: "rewrite", tenantId: row.tenantId, setCookie: false };
}

/** No usable cookie → resolve from the host. */
async function decideHostPath(
  input: TenantResolutionInput,
): Promise<TenantResolutionVerdict> {
  const host = normaliseHost(input.host);
  if (host === "" || host === input.rootDomain.toLowerCase()) {
    return { kind: "error", reason: "apex-host", clearCookie: false };
  }
  const slug = deriveSlug(host, input.rootDomain);
  const row =
    slug === null
      ? await input.fetchByCustomDomain(host)
      : await input.fetchBySlug(slug);
  if (row === null) {
    return { kind: "error", reason: "tenant-not-found", clearCookie: false };
  }
  if (row.status !== "active") {
    return { kind: "error", reason: "tenant-inactive", clearCookie: false };
  }
  return { kind: "rewrite", tenantId: row.tenantId, setCookie: true };
}

/**
 * Top-level decision:
 *  - Cookie present + usable → cookie path (fast or revalidated).
 *  - No cookie / malformed cookie → host path (slug OR custom domain).
 *
 * A malformed cookie (empty string here, since the middleware can pass any
 * stored cookie verbatim) is treated as no cookie — the middleware decides
 * whether to clear the actual `Set-Cookie` header on the way out (a malformed
 * cookie is rare enough to not be worth its own verdict shape).
 */
export async function decideTenantResolution(
  input: TenantResolutionInput,
): Promise<TenantResolutionVerdict> {
  if (isUsableCookie(input.cookieTenantId)) {
    return decideCookiePath(input.cookieTenantId, input);
  }
  return decideHostPath(input);
}
