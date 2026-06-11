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
import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

import { useSession } from "@/lib/session";

import { ALL_PASS_FILTERS, type IncidentFilters } from "./lib";
import { MonitoringView } from "./monitoring-view";
import { TenantsMissingAddressSection } from "./tenants-missing-address-section";

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
  // `previewIncidents` is exposed via `kbAdminQuery` — Convex throws
  // `FORBIDDEN: kb_admin role required` for any non-root caller. If we fired
  // the query unconditionally, a manager landing on `/monitoring` would
  // surface a raw Convex error boundary INSTEAD of the View's UnauthorizedCard
  // (A4 of the manual E2E checklist — the access refusal must be the explicit
  // shared card, not a stack trace). Skip the query unless the caller is a
  // resolved root admin; the View still renders for every session, just
  // without firing the network round-trip first.
  const isAdmin = session.status === "ready" && session.session.isAdmin;
  const incidents = useQuery(
    api.lib.admin.monitoring.previewIncidents,
    isAdmin ? {} : "skip",
  );
  // Address-first slice 4 — legacy tenants whose 4-tuple is incomplete. Same
  // root-only gate (`kbAdminQuery` backend) so we mirror the `skip` discipline
  // here to avoid surfacing the raw Convex forbidden boundary above the
  // UnauthorizedCard for non-root sessions.
  const tenantsMissingAddress = useQuery(
    api.lib.admin.addressAudit.listTenantsWithMissingAddress,
    isAdmin ? {} : "skip",
  );
  const now = useNow();
  const [filters, setFilters] = useState<IncidentFilters>(ALL_PASS_FILTERS);
  // Drill-down panel selection (issue #207). Owned here so `MonitoringView`
  // stays a pure-callable function for vitest.
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(
    null,
  );
  return (
    <>
      <MonitoringView
        session={session}
        incidents={incidents}
        now={now}
        filters={filters}
        onFiltersChange={setFilters}
        selectedIncident={selectedIncident}
        onSelectedIncidentChange={setSelectedIncident}
      />
      {isAdmin ? (
        <div className="px-4 lg:px-6 pb-6">
          <TenantsMissingAddressSection rows={tenantsMissingAddress} />
        </div>
      ) : null}
    </>
  );
}
