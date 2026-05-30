"use client";

/**
 * F-SHELL-02 — `SessionGuard` (ADR 0014 §3).
 *
 * Replaces the legacy root-only `AdminGuard` (which queried
 * `api.table.admin.currentAdmin` and only admitted `role === "kb_admin"`).
 * Decides entry into the `(app)` shell based on the session reported by
 * `useSession()`:
 *
 *   - `loading`        → render a loading skeleton (don't render children,
 *                         don't redirect — query still in flight).
 *   - `unauthenticated`→ push `/login?next=<currentPath>`.
 *   - `ready` + `isAdmin === false && tenants.length === 0` →
 *                         render `<NoTenantAttached />`.
 *   - `ready` otherwise → render children (KB Admin root, gérant avec au
 *                         moins un tenant, gérant + admin mixte).
 *
 * The garde does NOT pick a default route (e.g. `/pipeline` vs
 * `/t/[id]/...`); that's the job of a separate root-entry redirect
 * tracer-bullet. It only admits or refuses entry.
 *
 * Security note: this garde is UX-only. The real isolation barrier is the
 * backend wrappers `tenantQuery` / `kbAdminQuery` (ADR 0010) — if a route
 * leaked into the wrong bundle, Convex would still throw Forbidden.
 *
 * The branching is extracted into `decideSessionGate()` (a pure function)
 * so the acceptance criteria can be pinned by vitest in node env, without a
 * DOM — matches the existing reducer/reducer-test split in `lib/session/`.
 */
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { Spinner } from "@/components/ui/spinner";
import { NoTenantAttached } from "./no-tenant-attached";
import { useSession } from "@/lib/session";
import type { SessionState } from "@/lib/session";

/** Action the React shell should take given the current session state. */
export type SessionGateDecision =
  | { kind: "wait" }
  | { kind: "redirect-to-login" }
  | { kind: "no-tenant" }
  | { kind: "allow" };

/**
 * Pure mapping `SessionState -> SessionGateDecision`. No React, no router,
 * no Convex — the React layer is a thin shell that executes the decision.
 */
export function decideSessionGate(state: SessionState): SessionGateDecision {
  if (state.status === "loading") {
    return { kind: "wait" };
  }
  if (state.status === "unauthenticated") {
    return { kind: "redirect-to-login" };
  }
  // status === "ready"
  const { isAdmin, tenants } = state.session;
  if (!isAdmin && tenants.length === 0) {
    return { kind: "no-tenant" };
  }
  return { kind: "allow" };
}

function buildLoginHref(pathname: string | null): string {
  // Preserve the deep-link the user was trying to reach so we can bounce
  // them back after login. Empty/`/` pathname → plain `/login` (no point
  // round-tripping `next=/`).
  if (!pathname || pathname === "/") return "/login";
  return `/login?next=${encodeURIComponent(pathname)}`;
}

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const state = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const decision = decideSessionGate(state);

  useEffect(() => {
    if (decision.kind === "redirect-to-login") {
      router.replace(buildLoginHref(pathname));
    }
  }, [decision.kind, router, pathname]);

  if (decision.kind === "wait" || decision.kind === "redirect-to-login") {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (decision.kind === "no-tenant") {
    return <NoTenantAttached />;
  }

  return <>{children}</>;
}
