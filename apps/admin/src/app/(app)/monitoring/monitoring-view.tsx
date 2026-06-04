"use client";

/**
 * F-MONITORING — `MonitoringView` (issue #184 / filters slice #197, parent
 * EPIC #147).
 *
 * Pure presentational shell of the `/monitoring` route: takes the resolved
 * `session` + the `incidents` snapshot + the controlled `filters` as props
 * and decides what to render. Splitting it out of `page.tsx` (which owns
 * `useSession()` / `useQuery(api.lib.admin.monitoring.previewIncidents)`
 * / filter `useState`) lets vitest pin every branch — access denied,
 * loading, empty, 3-kind table, filtered-empty — under the lean `node`
 * env (no jsdom, no Convex test harness), same React-tree-serializer
 * pattern already used by neighbouring tests.
 *
 * Branches:
 *   - `session.isAdmin === false` → shared `UnauthorizedCard` (« Accès non
 *     autorisé ») with a back link to `/`. The card is the single source
 *     for the three refusal sites of the shell — tenant gate, monitoring,
 *     no-tenant — so the vocabulary stays consistent (A4 de la checklist
 *     E2E manuelle). The real security boundary remains backend
 *     (`kbAdminQuery` rejects, ADR 0014).
 *   - `incidents === undefined` → loading state (the query is still in
 *     flight — must NOT look like the empty state).
 *   - `incidents.length === 0` → « Aucun incident actif » global empty
 *     state.
 *   - `filteredIncidents.length === 0` → « Aucun incident ne correspond
 *     aux filtres » filtered empty state (distinct copy so the user
 *     understands their filters caused the void, not the system).
 *   - else → shadcn `<Table>` with one row per filtered incident.
 *
 * Filters (issue #197): three AND-combined client-side filters rendered
 * above the table — kind (shadcn `Select`), tenant (shadcn `Combobox`),
 * severity (shadcn `Select`). State is owned upstream and threaded as
 * `filters` + `onFiltersChange` so this component stays pure-callable
 * for vitest. When the caller omits them, the view falls back to
 * `ALL_PASS_FILTERS` + a no-op handler (preserves the pre-#197 contract).
 */
import Link from "next/link";

import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";
import type { SessionState } from "@/lib/session";
import { UnauthorizedCard } from "@/components/app/unauthorized-card";

import { Badge } from "@/components/ui/badge";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  ALL_FILTER,
  ALL_PASS_FILTERS,
  collectTenantOptions,
  filterIncidents,
  toIncidentRow,
  type IncidentFilters,
  type IncidentRow,
} from "./lib";
import { IncidentDetailSheet } from "./incident-detail-sheet";

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
  /**
   * Controlled filter state. Optional so callers (and tests) can omit it
   * and get the pre-#197 unfiltered view. Pure callers (vitest) supply
   * their own value to pin filter behaviour without mounting React.
   */
  filters?: IncidentFilters;
  /** Controlled-state setter for the 3 filter dropdowns. */
  onFiltersChange?: (filters: IncidentFilters) => void;
  /**
   * Controlled drill-down selection (issue #207). Optional so vitest can
   * omit it and keep `MonitoringView` pure-callable. The real `page.tsx`
   * owns the `useState` and threads it down.
   */
  selectedIncident?: Incident | null;
  /** Setter for the drill-down panel — `null` clears the selection. */
  onSelectedIncidentChange?: (incident: Incident | null) => void;
};

export function MonitoringView({
  session,
  incidents,
  now,
  filters = ALL_PASS_FILTERS,
  onFiltersChange,
  selectedIncident = null,
  onSelectedIncidentChange,
}: MonitoringViewProps) {
  // ── Access guard (UX layer; real isolation is backend `kbAdminQuery`) ──
  // Uses the shared UnauthorizedCard so the vocabulary stays consistent with
  // every other auth refusal in the shell (manager-on-other-tenant, no-tenant
  // empty state). See `components/app/unauthorized-card.tsx`.
  if (session.status !== "ready" || !session.session.isAdmin) {
    return (
      <UnauthorizedCard
        description={
          <>
            Cette page est réservée à l&apos;équipe KitchenBoost. Si vous pensez
            que c&apos;est une erreur, contactez le support.
          </>
        }
        primaryAction={{ label: "Retour au dashboard", href: "/" }}
      />
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
        <MonitoringBody
          incidents={incidents}
          now={now}
          filters={filters}
          onFiltersChange={onFiltersChange}
          selectedIncident={selectedIncident}
          onSelectedIncidentChange={onSelectedIncidentChange}
        />
      </div>
    </div>
  );
}

function MonitoringBody({
  incidents,
  now,
  filters,
  onFiltersChange,
  selectedIncident,
  onSelectedIncidentChange,
}: {
  incidents: Incident[] | undefined;
  now: number;
  filters: IncidentFilters;
  onFiltersChange?: (filters: IncidentFilters) => void;
  selectedIncident: Incident | null;
  onSelectedIncidentChange?: (incident: Incident | null) => void;
}) {
  if (incidents === undefined) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">Chargement en cours…</p>
      </div>
    );
  }
  // The « global empty » state short-circuits BEFORE the filter bar so the
  // « no data at all » message stays unambiguous (no controls to fiddle
  // with when there's nothing to filter in the first place).
  if (incidents.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">Aucun incident actif.</p>
      </div>
    );
  }

  const tenantOptions = collectTenantOptions(incidents);
  const filtered = filterIncidents(incidents, filters);
  // Build the rows alongside the incident reference so the row click can
  // hand the original `Incident` back to the drill-down panel (the row
  // shape loses the per-kind raw fields the panel renders).
  const pairs = filtered.map((incident) => ({
    incident,
    row: toIncidentRow(incident, now),
  }));
  return (
    <div className="flex flex-col gap-4">
      <FiltersBar
        filters={filters}
        tenantOptions={tenantOptions}
        onFiltersChange={onFiltersChange}
      />
      {pairs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Aucun incident ne correspond aux filtres.
          </p>
        </div>
      ) : (
        <IncidentsTable
          pairs={pairs}
          onRowSelect={(incident) => onSelectedIncidentChange?.(incident)}
        />
      )}
      <IncidentDetailSheet
        incident={selectedIncident}
        open={selectedIncident !== null}
        onOpenChange={(open) => {
          if (!open) onSelectedIncidentChange?.(null);
        }}
      />
    </div>
  );
}

function FiltersBar({
  filters,
  tenantOptions,
  onFiltersChange,
}: {
  filters: IncidentFilters;
  tenantOptions: string[];
  onFiltersChange?: (filters: IncidentFilters) => void;
}) {
  const update = (patch: Partial<IncidentFilters>) => {
    onFiltersChange?.({ ...filters, ...patch });
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="monitoring-filter-kind" className="text-xs">
          Type
        </Label>
        <Select
          value={filters.kind}
          onValueChange={(value) =>
            update({ kind: value as IncidentFilters["kind"] })
          }
        >
          <SelectTrigger id="monitoring-filter-kind" className="w-[200px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>Tous</SelectItem>
            <SelectItem value="webhook_latency">webhook_latency</SelectItem>
            <SelectItem value="kyc_pending">kyc_pending</SelectItem>
            <SelectItem value="paid_no_course">paid_no_course</SelectItem>
            <SelectItem value="auto_expired_burst">
              auto_expired_burst
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="monitoring-filter-tenant" className="text-xs">
          Tenant
        </Label>
        <Combobox
          items={[ALL_FILTER, ...tenantOptions]}
          value={filters.tenantId}
          onValueChange={(value) =>
            update({
              tenantId:
                typeof value === "string" && value.length > 0
                  ? value
                  : ALL_FILTER,
            })
          }
        >
          <ComboboxInput
            id="monitoring-filter-tenant"
            placeholder="Tenant"
            className="w-[220px]"
          />
          <ComboboxContent>
            <ComboboxList>
              <ComboboxItem value={ALL_FILTER}>Tous</ComboboxItem>
              {tenantOptions.map((tenantId) => (
                <ComboboxItem key={tenantId} value={tenantId}>
                  {tenantId}
                </ComboboxItem>
              ))}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="monitoring-filter-severity" className="text-xs">
          Sévérité
        </Label>
        <Select
          value={filters.severity}
          onValueChange={(value) =>
            update({ severity: value as IncidentFilters["severity"] })
          }
        >
          <SelectTrigger id="monitoring-filter-severity" className="w-[180px]">
            <SelectValue placeholder="Sévérité" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_FILTER}>Toutes</SelectItem>
            <SelectItem value="critical">critical</SelectItem>
            <SelectItem value="warning">warning</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function IncidentsTable({
  pairs,
  onRowSelect,
}: {
  pairs: { incident: Incident; row: IncidentRow }[];
  onRowSelect: (incident: Incident) => void;
}) {
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
          {pairs.map(({ incident, row }) => (
            <TableRow
              key={row.key}
              onClick={() => onRowSelect(incident)}
              className="hover:bg-muted/50 cursor-pointer"
            >
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
                  // Stop propagation so clicking the per-row link navigates
                  // instead of opening the drill-down panel (the row's
                  // onClick would otherwise fire too).
                  <Link
                    href={row.href}
                    onClick={(e) => e.stopPropagation()}
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
