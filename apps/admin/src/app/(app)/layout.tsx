"use client";

import { SessionGuard } from "@/components/app/session-guard";
import { ApplicationShell } from "@/components/application-shell2";
import { Toaster } from "@/components/ui/sonner";
import { SessionLoader } from "@/lib/session";

/**
 * (app) layout — mounts the SessionLoader above the existing shell so
 * every screen under `(app)` can read the session via `useSession()`
 * (F-SHELL-01, ADR 0014 §3), and the SessionGuard right under it so the
 * shell only renders for authorised actors (F-SHELL-02, issue #164).
 *
 * The SessionGuard admits entry if `isAdmin === true` OR `tenants.length > 0`
 * (per ADR 0014 §3); it does NOT pick a default route — that's a separate
 * root-entry redirect tracer-bullet. The real isolation barrier remains
 * backend (`tenantQuery` / `kbAdminQuery`, ADR 0010).
 *
 * `<Toaster />` (Sonner) is mounted ONCE here so every page under (app) gets
 * toast feedback for free. Prior to 2026-06-01 it was only mounted ad-hoc on
 * `/pipeline/page.tsx`, which meant `toast.success(...)` / `toast.error(...)`
 * calls from sibling pages (Paramètres, Menu, Commandes, Mes clients,
 * Campagnes, …) fired silently — the P1 E2E spot-check surfaced this on
 * the Paramètres « Identité visuelle » save (cf. [docs/tests/E2E-checklist.md](../../../docs/tests/E2E-checklist.md)
 * groupe P). Mounting at the layout level is the canonical Sonner pattern
 * and removes per-page boilerplate.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionLoader>
      <SessionGuard>
        <ApplicationShell>{children}</ApplicationShell>
        <Toaster />
      </SessionGuard>
    </SessionLoader>
  );
}
