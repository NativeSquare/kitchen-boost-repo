"use client";

/**
 * Root entry — role-aware redirect under the (app) shell.
 *
 * Lives under `(app)/` so it inherits `SessionLoader` + `SessionGuard`
 * (apps/admin/src/app/(app)/layout.tsx). When this component renders we are
 * GUARANTEED that `session.status === "ready"` AND (`isAdmin` ||
 * `tenants.length > 0`) — the no-tenant case is intercepted upstream by the
 * guard and replaced with `<NoTenantEmptyState/>`, so the redirect logic
 * below only ever runs for a usable actor.
 *
 * Routing matrix (ADR 0014 §5):
 *   - KB Admin   → `/monitoring` (supervision space).
 *     The intended landing is `/pipeline` (ADR 0014 §5 — the Kanban is the
 *     KB Admin home), but that page is a separate epic still in the
 *     backlog. `/monitoring` is the only live supervision route today and
 *     is in the sidebar, so the redirect doesn't strand the user on a 404.
 *     When `/pipeline` ships, change the line below — the contract stays.
 *   - KB Manager → `/t/<firstTenantId>/menu` (operational space, default
 *     resto = first own tenant). Matches the sidebar fallback in
 *     `decideSidebarNav` so the chrome and the URL agree.
 *
 * Replaces the legacy `apps/admin/src/app/page.tsx` (`redirect("/team")`)
 * which pointed at the now-deleted scaffold `(app)/team/` page — a route
 * that was NOT in the new sidebar (ADR 0014 §1 + §56 removed Users/Team
 * entirely). That redirect was dead code surviving the F-SHELL-06 sidebar
 * swap; it's gone with this slice.
 */
import * as React from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { useSession } from "@/lib/session";

export default function RootHome() {
  const session = useSession();
  const router = useRouter();

  React.useEffect(() => {
    // SessionGuard renders a spinner / NoTenantEmptyState upstream when the
    // session isn't ready / has no actor — but the effect deps still need to
    // narrow defensively (no redirect if the guard somehow lets us through
    // before resolution).
    if (session.status !== "ready") return;
    const { isAdmin, tenants } = session.session;
    if (isAdmin) {
      router.replace("/monitoring");
      return;
    }
    if (tenants.length > 0) {
      router.replace(`/t/${tenants[0].tenantId}/menu`);
    }
    // The third case (non-admin + no tenants) is handled by SessionGuard's
    // `no-tenant` branch — we never reach this code path for it.
  }, [session, router]);

  // Brief spinner while `useEffect` schedules the navigation. Matches the
  // visual the guard uses, so the user never sees a flash of empty content.
  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}
