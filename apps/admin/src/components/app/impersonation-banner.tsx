"use client";

/**
 * F-SHELL-08 (#214) — `ImpersonationBanner`, mounted in the `/t/[tenantId]`
 * chrome-less layout (#175, ADR 0014 §8).
 *
 * The banner surfaces, in KitchenBoost's accent gold (`#E5A100`), the canonical
 * vocabulary « Mode admin — tu consultes <resto> » whenever a KB Admin is
 * impersonating a resto (i.e. `session.isAdmin && currentTenantId`). The
 * « Quitter » CTA navigates back to supervision via the SHARED
 * `SUPERVISION_ROUTE` constant (kept in lock-step with the TenantSwitcher's
 * « Supervision » entry — when `/pipeline` lands, ONE edit updates both).
 *
 * V1 scope (ADR 0014 §8): KB Admin only.
 *   - Gérant-side banner « KB est connecté à votre compte » → V2.
 *   - Audit log of who-impersonated-whom-when → V2.
 *   - Mode lecture seule pour tenant suspendu → géré PAR SURFACE plus tard.
 *
 * The branching is split between a pure decision (`decideImpersonationBanner`)
 * and a pure presentational view (`ImpersonationBannerView`) so vitest pins
 * every acceptance criterion of #214 in `node` env — same discipline as
 * `decideSessionGate` (#164), `decideTenantGate` (#175), `decideSidebarNav`
 * (#196), `decideTenantSwitcher` (#208), and the `NoTenantEmptyState`
 * handlers split. The default-export `ImpersonationBanner` is the
 * `"use client"` shell that wires `useSession()`, `useCurrentTenantId()`,
 * `useAllTenants()` and the router into the view.
 *
 * Why mount inside `/t/[tenantId]/layout.tsx` and not the global shell:
 *   - The layout is the FIRST place we have a guaranteed `tenantId` in
 *     context (provided by `<TenantProvider/>` — F-SHELL-04). Mounting
 *     anywhere else would either require duplicating the URL parse or
 *     hoisting the tenant id higher than the layout that owns it.
 *   - The structural absence on `/pipeline`, `/monitoring`, etc. is then a
 *     consequence of the file system (no `/t/[tenantId]` layout on those
 *     routes), not of a runtime guard that could be miswired.
 */

import { useRouter } from "next/navigation";

import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/session";
import type { SessionState } from "@/lib/session";

import { useCurrentTenantId, KB_CURRENT_TENANT_COOKIE } from "./tenant-context";
import { useAllTenants, type TenantOption } from "./tenant-switcher";

/**
 * Module-level helper — clears the `kb_current_tenant` cookie hint. Defined
 * at module scope (not inside the component body) so React 19's
 * `react-hooks/immutability` rule doesn't complain about a render-time
 * closure mutating an outer-scope value. Mirrors the same discipline
 * `tenant-switcher.tsx` uses for `persistTenantCookie` / `clearTenantCookie`.
 */
function clearTenantCookieHint(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${KB_CURRENT_TENANT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
}

// ---------------------------------------------------------------------------
// 1. Shared supervision route + handler factory
// ---------------------------------------------------------------------------

/**
 * Canonical supervision URL — the target of both the TenantSwitcher's
 * « Supervision » pinned entry AND the impersonation banner's « Quitter »
 * button. Lives here (rather than in a separate `lib/` file) so the two
 * shell surfaces are GUARANTEED to point at the same destination: editing
 * this constant updates both. Issue #214 acceptance reads `/pipeline`, but
 * that page doesn't exist yet (F-PIPELINE epic still in the backlog), so we
 * point at the live supervision route `/monitoring`. When `/pipeline` lands,
 * change this single line and re-point TenantSwitcher's SUPERVISION_PINNED
 * to the same value.
 */
export const SUPERVISION_ROUTE = "/monitoring";

export type ImpersonationHandlerDeps = {
  /** Router push (e.g. `(path) => router.push(path)`). Injected by the shell. */
  navigate: (path: string) => void;
  /** Clear the `kb_current_tenant` cookie hint. Injected so the handler stays
   *  pure (no `document` access in this module). */
  clearTenantHint: () => void;
};

export type ImpersonationHandlers = {
  /** Click handler for the « Quitter » button. Clears the cookie hint FIRST
   *  so the next fresh load doesn't re-impersonate via the hint, THEN
   *  navigates to supervision. */
  handleQuit: () => void;
};

export function makeImpersonationHandlers(
  deps: ImpersonationHandlerDeps,
): ImpersonationHandlers {
  return {
    handleQuit() {
      deps.clearTenantHint();
      deps.navigate(SUPERVISION_ROUTE);
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Pure types + decision
// ---------------------------------------------------------------------------

/** Result of `useAllTenants()` — same shape the TenantSwitcher consumes.
 *  `undefined` = in-flight (or admin gating skipped the query); array =
 *  resolved (possibly empty). */
export type TenantNameLookup = TenantOption[] | undefined;

export type ImpersonationBannerInput = {
  session: SessionState;
  /** Tenant id from the URL segment, or `null` if the banner is mounted
   *  outside `/t/[tenantId]/...`. Always non-null in the production
   *  wiring (the banner is rendered inside the layout that owns the
   *  segment), but the decision still guards defensively. */
  currentTenantId: Id<"tenants"> | null;
  tenantNameLookup: TenantNameLookup;
};

export type ImpersonationBannerDecision =
  | { kind: "hidden" }
  | { kind: "visible"; tenantId: Id<"tenants">; tenantName: string };

/**
 * Pure mapping `(session, currentTenantId, lookup) → decision`. See
 * `impersonation-banner.decision.test.ts` for the test matrix.
 */
export function decideImpersonationBanner(
  input: ImpersonationBannerInput,
): ImpersonationBannerDecision {
  const { session, currentTenantId, tenantNameLookup } = input;

  if (session.status !== "ready") return { kind: "hidden" };
  if (!session.session.isAdmin) return { kind: "hidden" };
  if (currentTenantId === null) return { kind: "hidden" };

  // Resolve the name. The lookup may be in-flight (undefined) or resolved
  // (array). When unresolved or missing, fall back to the tenantId itself
  // rather than hiding the banner — the impersonation state matters more
  // than the precise human name.
  const resolved = tenantNameLookup?.find(
    (t) => t.tenantId === currentTenantId,
  );
  const tenantName = resolved?.name ?? (currentTenantId as unknown as string);

  return { kind: "visible", tenantId: currentTenantId, tenantName };
}

// ---------------------------------------------------------------------------
// 3. Presentational view
// ---------------------------------------------------------------------------

export type ImpersonationBannerViewProps = {
  decision: ImpersonationBannerDecision;
  onQuit: () => void;
};

/**
 * Pure presentational shell — given a decision + an onQuit handler, render
 * the orange banner or nothing. No router, no Convex, no `useSession()`.
 *
 * Styling — KitchenBoost accent gold (`#E5A100` per the project brand) is
 * approximated via Tailwind's `amber-*` ramp:
 *   - `bg-amber-50` for the soft background,
 *   - `border-amber-300` for the rule,
 *   - `text-amber-900` / `text-amber-700` for the text + accent.
 * The exact tokens can later move to a dedicated CSS var if the brand grows
 * a real palette — the `data-slot="impersonation-banner"` hook stays stable
 * for tests and a11y audits regardless.
 */
export function ImpersonationBannerView({
  decision,
  onQuit,
}: ImpersonationBannerViewProps) {
  if (decision.kind === "hidden") return null;

  return (
    <div
      data-slot="impersonation-banner"
      role="status"
      aria-live="polite"
      className={cn(
        "flex w-full items-center justify-between gap-3 border-b px-4 py-2 text-sm",
        "border-amber-300 bg-amber-50 text-amber-900",
      )}
    >
      <span className="flex-1 truncate">
        <span className="font-semibold">Mode admin</span>
        {" — tu consultes "}
        <span
          className="font-semibold"
          data-slot="impersonation-banner-tenant-name"
        >
          {decision.tenantName}
        </span>
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={onQuit}
        data-slot="impersonation-banner-quit"
        className="border-amber-400 bg-white text-amber-900 hover:bg-amber-100"
      >
        Quitter
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Default-export shell — wires hooks + router into the view
// ---------------------------------------------------------------------------

/**
 * Production component, mounted in `/t/[tenantId]/layout.tsx` directly above
 * `{children}` (inside the `<TenantProvider/>` so `useCurrentTenantId()`
 * resolves).
 *
 * The tenant-name lookup re-uses `useAllTenants()` (the same hook the
 * TenantSwitcher consumes in the shared header). Convex `useQuery` dedupes
 * identical calls in the same render tree, so this is free — and it keeps
 * the banner from needing its own dedicated `getTenantName` backend query
 * (out of #214 scope, per epic #139 — "no new backend query in this issue").
 */
export function ImpersonationBanner() {
  const session = useSession();
  const currentTenantId = useCurrentTenantId();
  const tenantNameLookup = useAllTenants();
  const router = useRouter();

  const decision = decideImpersonationBanner({
    session,
    currentTenantId,
    tenantNameLookup,
  });

  const { handleQuit } = makeImpersonationHandlers({
    navigate: (path) => router.push(path),
    clearTenantHint: clearTenantCookieHint,
  });

  return <ImpersonationBannerView decision={decision} onQuit={handleQuit} />;
}
