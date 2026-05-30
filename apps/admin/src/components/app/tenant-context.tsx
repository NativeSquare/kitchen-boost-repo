"use client";

/**
 * F-SHELL-04 — `TenantContext`, `useCurrentTenantId`, the cookie helpers, and
 * the pure `decideTenantGate()` consumed by the chrome-less layout under
 * `apps/admin/src/app/(app)/t/[tenantId]/`.
 *
 * One module exposes three concerns, deliberately kept together because they
 * all express the same invariant (ADR 0014 §4): "the tenant courant lives in
 * the URL, the cookie is only a hint, and every consumer reads it through one
 * sanctioned brand-preserving hook":
 *
 *   1. The React context + `useCurrentTenantId()` hook — the front-side
 *      equivalent of the backend `ctx.tenantId` injection (the
 *      `no-untenanted-query` discipline, ADR 0010). Every surface under
 *      `/t/[id]/...` reads its tenantId through this hook (and, ultimately,
 *      through `useTenantQuery` / `useTenantMutation` — F-SHELL-05).
 *
 *   2. The pure `decideTenantGate(input)` — the layout's WHAT-TO-DO branching,
 *      extracted from React so vitest can pin every acceptance criterion of
 *      issue #175 without jsdom / RTL (same split as `decideSessionGate`).
 *
 *   3. The cookie helpers (`parseTenantCookie` / `formatTenantCookie` +
 *      `KB_CURRENT_TENANT_COOKIE`) — the ONLY place that knows the
 *      `kb_current_tenant` name / serialisation. Used by the layout on entry
 *      (write) and by the redirect branch (read, as a hint).
 *
 * Hard rules (ADR 0014):
 *   - The cookie is NEVER the source of truth. URL > session > cookie hint.
 *   - The KB Manager can NEVER reach a tenant they don't own (redirect; the
 *     backend would refuse anyway, ADR 0010 — this is UX, not security).
 *   - The KB Admin sees a clean 404 on a non-existent tenantId (we DO probe
 *     the DB for existence; without the probe the shell would render a broken
 *     surface that only fails on the first `tenantQuery`).
 */
import { createContext, useContext, type ReactNode } from "react";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { SessionState } from "@/lib/session";

// ---------------------------------------------------------------------------
// 1. React context + hook
// ---------------------------------------------------------------------------

/**
 * Context value = the validated `tenantId` for the surfaces mounted under
 * `/t/[tenantId]/...`. `null` outside such a layout — `useCurrentTenantId`
 * detects that and throws (programmer error).
 */
const TenantContext = createContext<Id<"tenants"> | null>(null);

export function TenantProvider({
  tenantId,
  children,
}: {
  tenantId: Id<"tenants">;
  children: ReactNode;
}) {
  return (
    <TenantContext.Provider value={tenantId}>{children}</TenantContext.Provider>
  );
}

/**
 * Pure core of `useCurrentTenantId` — given the raw context read, returns the
 * branded `Id<"tenants">` or throws. Extracted so the throw contract is
 * pinned by vitest without rendering React.
 */
export function readTenantIdOrThrow(
  value: Id<"tenants"> | null,
): Id<"tenants"> {
  if (value === null) {
    throw new Error(
      "useCurrentTenantId() called outside a /t/[tenantId]/... layout. " +
        "Every surface under (app)/t/[tenantId] is mounted under <TenantProvider/>; " +
        "if you see this error, you're either rendering a /t/* surface without the layout, " +
        "or calling the hook from a supervision route (/pipeline/...) where there is no tenant context.",
    );
  }
  return value;
}

/**
 * Hook — the SANCTIONED way to read the tenant courant inside any surface
 * under `/t/[tenantId]/...`. Returns a branded `Id<"tenants">` (no raw
 * strings reach downstream callers — useTenantQuery / URL builders).
 */
export function useCurrentTenantId(): Id<"tenants"> {
  return readTenantIdOrThrow(useContext(TenantContext));
}

/** Test-only escape hatch (not re-exported from any index). */
export const __TenantContextForTesting = TenantContext;

// ---------------------------------------------------------------------------
// 2. Pure decision: `decideTenantGate`
// ---------------------------------------------------------------------------

/** Convex `useQuery` observation for the kb_admin tenant-existence probe.
 *  `undefined` = in flight; `{ exists: true }` = tenant exists in DB;
 *  `{ exists: false }` = tenant does not exist (clean 404). */
export type AdminTenantLookup = { exists: boolean } | undefined;

export type TenantGateInput = {
  session: SessionState;
  /** The `tenantId` parsed from the URL segment `/t/[tenantId]/...`. */
  urlTenantId: Id<"tenants">;
  /** The current `kb_current_tenant` cookie value (hint only). */
  cookieTenantId: Id<"tenants"> | undefined;
  /** Convex lookup observation — only consulted when `session.isAdmin === true`. */
  adminTenantLookup: AdminTenantLookup;
};

/**
 * History — an earlier version of this union carried a `{kind: "redirect"}`
 * branch used to SILENTLY teleport a KB Manager away from a `/t/<id>` they
 * didn't own to a `/t/<owned>` of theirs. That UX was indistinguishable from
 * a routing bug (A4 of the manual E2E checklist — the user saw the URL
 * change but never learned WHY). It was replaced by `not-authorized`, which
 * still carries the redirect target (`redirectTo`) but lets the React layer
 * render an UnauthorizedCard with a CTA the user must click — making the
 * refusal explicit.
 */
export type TenantGateDecision =
  | { kind: "wait" }
  | { kind: "not-authorized"; redirectTo: Id<"tenants"> }
  | { kind: "not-found" }
  | { kind: "allow"; tenantId: Id<"tenants"> };

/**
 * Pure mapping from the layout's inputs to the action the React shell
 * executes. Treats unauthenticated as `wait` (the parent SessionGuard owns
 * the /login redirect — we just don't render anything tenant-scoped until the
 * session resolves).
 */
export function decideTenantGate(input: TenantGateInput): TenantGateDecision {
  const { session, urlTenantId, cookieTenantId, adminTenantLookup } = input;

  // Session not resolved yet → defer. SessionGuard handles login redirect.
  if (session.status !== "ready") {
    return { kind: "wait" };
  }

  const { isAdmin, tenants } = session.session;

  if (isAdmin) {
    // Root override: any existing tenant is reachable. We still PROBE the DB
    // for existence so a bogus URL doesn't render a broken shell — the probe
    // is the only way to surface a clean 404 from the layout itself.
    if (adminTenantLookup === undefined) {
      return { kind: "wait" };
    }
    return adminTenantLookup.exists
      ? { kind: "allow", tenantId: urlTenantId }
      : { kind: "not-found" };
  }

  // KB Manager / staff: the tenant MUST be in their attached list.
  const ownsUrlTenant = tenants.some((t) => t.tenantId === urlTenantId);
  if (ownsUrlTenant) {
    return { kind: "allow", tenantId: urlTenantId };
  }

  // Not owned → surface explicitly as `not-authorized` (no silent redirect,
  // A4 of the manual E2E checklist). The layout renders an UnauthorizedCard
  // with a CTA pointing at `redirectTo` so the user CHOOSES the navigation
  // rather than being teleported away. `redirectTo` is the same fallback
  // target the old silent-redirect picked: cookie hint when still valid,
  // otherwise the first tenant of the list.
  //
  // Edge case — empty list isn't expected here (SessionGuard would already
  // render NoTenantEmptyState upstream), but if it ever leaks we treat it
  // as `not-found` rather than crash (defensive — the typed return must
  // always provide a usable shape).
  const cookieValid =
    cookieTenantId !== undefined &&
    tenants.some((t) => t.tenantId === cookieTenantId);
  const target = cookieValid ? cookieTenantId : tenants[0]?.tenantId;
  if (target === undefined) {
    return { kind: "not-found" };
  }
  return { kind: "not-authorized", redirectTo: target };
}

// ---------------------------------------------------------------------------
// 3. Cookie helpers — `kb_current_tenant`
// ---------------------------------------------------------------------------

/** Canonical cookie name (ADR 0014 §4 + multi-tenant CONTEXT). */
export const KB_CURRENT_TENANT_COOKIE = "kb_current_tenant";

/** ~1 year. The cookie is a hint, not a token — generous TTL is fine. */
const KB_CURRENT_TENANT_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * Parse a `document.cookie`-shaped string and return the `kb_current_tenant`
 * payload (if present and well-formed). Returns `undefined` otherwise.
 */
export function parseTenantCookie(
  cookieString: string,
): Id<"tenants"> | undefined {
  if (!cookieString) return undefined;
  const parts = cookieString.split(";");
  for (const raw of parts) {
    const trimmed = raw.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const name = trimmed.slice(0, eq);
    if (name !== KB_CURRENT_TENANT_COOKIE) continue;
    const value = trimmed.slice(eq + 1);
    if (!value) return undefined;
    try {
      return decodeURIComponent(value) as unknown as Id<"tenants">;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Build the exact `document.cookie` assignment string the layout writes on
 * every successful entry into `/t/[tenantId]/...`. `Path=/` so the hint is
 * shared across the whole shell; `SameSite=Lax` so deep links from outside
 * the app still carry it; `Max-Age` for session-survival.
 */
export function formatTenantCookie(tenantId: Id<"tenants">): string {
  const encoded = encodeURIComponent(tenantId as unknown as string);
  return (
    `${KB_CURRENT_TENANT_COOKIE}=${encoded}` +
    `; Path=/` +
    `; Max-Age=${KB_CURRENT_TENANT_MAX_AGE_SECONDS}` +
    `; SameSite=Lax`
  );
}
