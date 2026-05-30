"use client";

import { AdminGuard } from "@/components/app/admin-guard";
import { ApplicationShell } from "@/components/application-shell2";
import { SessionLoader } from "@/lib/session";

/**
 * (app) layout — mounts the SessionLoader above the existing shell so
 * every screen under `(app)` can read the session via `useSession()`
 * (F-SHELL-01, ADR 0014 §3).
 *
 * The legacy `AdminGuard` (root-only, on `currentAdmin`) is intentionally
 * left in place: replacing it with a session-based garde that admits
 * managers too is a separate tracer-bullet — see ADR 0014 §"Conséquences".
 * Until then, F-SHELL-01 is transport-only: the session is broadcast, no
 * garde / redirect happens here.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionLoader>
      <AdminGuard>
        <ApplicationShell>{children}</ApplicationShell>
      </AdminGuard>
    </SessionLoader>
  );
}
