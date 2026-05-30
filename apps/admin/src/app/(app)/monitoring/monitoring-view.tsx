"use client";

/**
 * F-MONITORING — `MonitoringView` (issue #184, parent EPIC #147).
 *
 * Pure presentational shell of the `/monitoring` route: takes the resolved
 * `session` + the `incidents` snapshot as props and decides what to render.
 * Splitting it out of `page.tsx` (which owns `useSession()` /
 * `useQuery(api.lib.admin.monitoring.previewIncidents)`) lets vitest pin
 * every branch — access denied, loading, empty, 3-kind table — under the
 * lean `node` env (no jsdom, no Convex test harness), same React-tree-
 * serializer pattern already used by neighbouring tests.
 *
 * Branches:
 *   - `session.isAdmin === false` → « Accès refusé » + back link to `/`.
 *     This is the UX layer; the real security boundary is backend
 *     (`kbAdminQuery` rejects, ADR 0014).
 *   - `incidents === undefined` → loading state (the query is still in
 *     flight — must NOT look like the empty state).
 *   - `incidents.length === 0` → « Aucun incident actif » empty state.
 *   - else → shadcn `<Table>` with one row per incident, per-kind inline
 *     fields (provider+externalId+latencyMs for `webhook_latency` ;
 *     prospectName+provider+since for `kyc_pending` ; orderId+tenantId for
 *     `paid_no_course`), and a contextual link cell when buildable.
 */
import Link from "next/link";

import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";
import type { SessionState } from "@/lib/session";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { toIncidentRow, type IncidentRow } from "./lib";

export type MonitoringViewProps = {
  /** The resolved session (decided by the `(app)` SessionGuard upstream). */
  session: SessionState;
  /** Incidents from `useQuery(api.lib.admin.monitoring.previewIncidents)`. */
  incidents: Incident[] | undefined;
  /**
   * Reference "now" used to format `pendingSinceMs`. ALWAYS required (callers
   * inject it — `page.tsx` reads `Date.now()` outside this component so the
   * React Compiler can keep `MonitoringView` pure).
   */
  now: number;
};

export function MonitoringView({
  session,
  incidents,
  now,
}: MonitoringViewProps) {
  // ── Access guard (UX layer; real isolation is backend `kbAdminQuery`) ──
  if (session.status !== "ready" || !session.session.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Accès refusé</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          Cette page est réservée à l&apos;équipe KitchenBoost. Si vous pensez
          que c&apos;est une erreur, contactez le support.
        </p>
        <Link
          href="/"
          className="text-sm text-blue-600 underline hover:no-underline"
        >
          Retour au dashboard
        </Link>
      </div>
    );
  }

  // ── Page shell ────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Monitoring</h1>
        <p className="text-muted-foreground text-sm">
          Incidents ops actifs détectés sur l&apos;ensemble des tenants.
        </p>
      </div>
      <div className="px-4 lg:px-6">
        <MonitoringBody incidents={incidents} now={now} />
      </div>
    </div>
  );
}

function MonitoringBody({
  incidents,
  now,
}: {
  incidents: Incident[] | undefined;
  now: number;
}) {
  if (incidents === undefined) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">Chargement en cours…</p>
      </div>
    );
  }
  if (incidents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">Aucun incident actif.</p>
      </div>
    );
  }
  const rows = incidents.map((incident) => toIncidentRow(incident, now));
  return <IncidentsTable rows={rows} />;
}

function IncidentsTable({ rows }: { rows: IncidentRow[] }) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader className="bg-muted">
          <TableRow>
            <TableHead>Type</TableHead>
            <TableHead>Cible</TableHead>
            <TableHead>Sévérité</TableHead>
            <TableHead>Détails</TableHead>
            <TableHead>Depuis</TableHead>
            <TableHead>Lien</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.key}>
              <TableCell className="font-medium">{row.typeLabel}</TableCell>
              <TableCell>{row.targetLabel}</TableCell>
              <TableCell>
                <SeverityBadge severity={row.severity} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.details}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.sinceText ?? "—"}
              </TableCell>
              <TableCell>
                {row.href === undefined ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Link
                    href={row.href}
                    className="text-blue-600 hover:underline"
                  >
                    Ouvrir
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function SeverityBadge({ severity }: { severity: IncidentRow["severity"] }) {
  if (severity === "critical") {
    return (
      <Badge
        variant="outline"
        className="border-red-200 bg-red-50 text-red-700"
      >
        critical
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-orange-200 bg-orange-50 text-orange-700"
    >
      warning
    </Badge>
  );
}
