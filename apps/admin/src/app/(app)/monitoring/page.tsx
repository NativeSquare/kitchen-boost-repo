"use client";

/**
 * F-MONITORING — `/monitoring` route (issue #184 / filters slice #197,
 * parent EPIC #147).
 *
 * Thin wiring layer: reads the session via `useSession` (F-SHELL, ADR 0014
 * §3) and the incidents via `useQuery(api.lib.admin.monitoring.previewIncidents)`
 * — both reactive — and hands them to the pure `MonitoringView`. Owns the
 * client-side filter state (kind / tenant / severity, issue #197) so the
 * view stays pure-callable from vitest.
 *
 * The page lives directly under `(app)/monitoring/` (NOT under
 * `(app)/t/[tenantId]/...`) because monitoring is KB-Admin-global ops, not
 * tenant-scoped (cf. `docs/contexts/kb-admin/CONTEXT.md` « Mode supervision »
 * and EPIC #147 "Implementation Decisions").
 *
 * The front guard here is UX-only — the real isolation barrier is backend
 * (`previewIncidents` is exposed via `kbAdminQuery`, so any non-root actor
 * is refused with a Forbidden, ADR 0010). If a `kb_manager` lands on the
 * page anyway (URL share, etc.), the `useSession`-driven check below
 * displays « Accès refusé » before the Convex query even fires.
 */
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";

import { api } from "@packages/backend/convex/_generated/api";

import { useSession } from "@/lib/session";

import { ALL_PASS_FILTERS, type IncidentFilters } from "./lib";
import { MonitoringView } from "./monitoring-view";

/**
 * Subscribe to the wall clock through state + a 1-minute ticker so the
 * « depuis X heures » column refreshes itself without a page reload. The
 * initial value uses `useState`'s lazy initializer (only runs on mount,
 * NOT every render), which keeps the component body itself pure — the
 * React Compiler refuses an unguarded `Date.now()` call in render.
 */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function MonitoringPage() {
  const session = useSession();
  // We still subscribe to the query for KB Admin sessions; for non-admin
  // sessions the View short-circuits to « Accès refusé » before reading
  // `incidents`. Calling the hook unconditionally keeps the React hook order
  // stable across re-renders.
  const incidents = useQuery(api.lib.admin.monitoring.previewIncidents);
  const now = useNow();
  const [filters, setFilters] = useState<IncidentFilters>(ALL_PASS_FILTERS);
  return (
    <MonitoringView
      session={session}
      incidents={incidents}
      now={now}
      filters={filters}
      onFiltersChange={setFilters}
    />
  );
}
