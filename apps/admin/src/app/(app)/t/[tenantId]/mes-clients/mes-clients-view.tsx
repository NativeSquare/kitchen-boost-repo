/**
 * F-MES-CLIENTS [2/4] (#186) — `MesClientsView`, pure presentational shell
 * of the "Mes clients" KPI page.
 *
 * Owns the four branches the page can be in:
 *   - `kpis === undefined` → loading skeletons (3 card skeletons + title;
 *     no blank flash, no shell-swap when the data lands).
 *   - `kpis === null`     → error fallback (« Impossible de charger… ») —
 *     also covers the « Accès refusé » path (the backend's Forbidden bubbles
 *     up through `useQuery` → `useTenantQuery` and the page caller maps it
 *     to `null` so the view stays pure).
 *   - `kpis.total === 0`  → `MesClientsEmptyState` (slice 1 #181 regression).
 *   - else                → 3 segment cards (Actifs / Inactifs / VIP) with
 *     the raw counts. ONLY aggregates ever cross the wrapper boundary into
 *     the resto's view — the MOAT (PRD 70 §4.4 / Q90-Q2 / ADR 0010).
 *
 * Split out of `page.tsx` (which owns `useTenantQuery` /
 * `useAuditOnOpen` / `useMutation`) so vitest can pin every branch under
 * `environment: "node"` (no jsdom, no Convex test harness) — same React-
 * tree-serializer pattern as `monitoring/monitoring-view.tsx` and
 * `empty-state.tsx`. The page hands `kpis` in as a prop; the view is a pure
 * function of its props.
 *
 * Slice 1 contracts kept intact:
 *   - The empty-state copy + title stay verbatim — fallback for `total === 0`
 *     still reads as it did under #181.
 *   - PII labels are NEVER rendered, on ANY branch (anti-MOAT-leak: the error
 *     fallback would be the easiest place to slip a "emails clients
 *     introuvables" copy — explicitly forbidden by the anti-PII test).
 */
import type { CustomerKPIs } from "@packages/backend/convex/lib/customer/kpi";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { MesClientsEmptyState } from "./empty-state";

export type MesClientsViewProps = {
  /**
   * KPIs payload from `useTenantQuery(api.lib.customer.kpi.aggregateCustomerKPIs)`,
   * decorated by the page caller with a tri-state contract:
   *   - `undefined` → query in flight (Convex's loading sentinel)
   *   - `null`      → query failed (incl. Forbidden / « accès refusé »)
   *   - else        → resolved aggregates
   */
  kpis: CustomerKPIs | null | undefined;
};

/** The three V1 segments, frozen V1 labels (PRD 90 §3 + issue body). */
const SEGMENT_CARDS = [
  {
    key: "actif" as const,
    label: "Actifs",
    description: "≥ 1 commande sur 30 jours",
  },
  {
    key: "inactif" as const,
    label: "Inactifs",
    description: "0 commande sur 90 jours",
  },
  {
    key: "vip" as const,
    label: "VIP",
    description: "≥ 5 commandes ou LTV ≥ 150€",
  },
];

export function MesClientsView({ kpis }: MesClientsViewProps) {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Mes clients</h1>
      </div>
      <div className="px-4 lg:px-6">
        <MesClientsBody kpis={kpis} />
      </div>
    </div>
  );
}

function MesClientsBody({ kpis }: { kpis: CustomerKPIs | null | undefined }) {
  if (kpis === undefined) {
    return <SegmentCardsSkeleton />;
  }
  if (kpis === null) {
    // Error fallback — explicit copy, anti-PII (no email/phone/name/address
    // labels EVEN in the error path; the MOAT survives broken Convex calls).
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-muted-foreground text-sm">
          Impossible de charger vos KPI clients. Réessayez dans un instant.
        </p>
      </div>
    );
  }
  if (kpis.total === 0) {
    // Slice 1 (#181) regression: an empty tenant still shows the friendly
    // empty state — NOT 3 zero-cards (that would be a confusing "0/0/0"
    // surface on top of "aucun client encore"; the empty state is what the
    // PRD calls out as the V1 default).
    return <MesClientsEmptyState />;
  }
  return <SegmentCards segments={kpis.segments} />;
}

function SegmentCards({ segments }: { segments: CustomerKPIs["segments"] }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {SEGMENT_CARDS.map((card) => (
        <Card key={card.key}>
          <CardHeader>
            <CardTitle>{card.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {segments[card.key]}
            </p>
            <p className="text-muted-foreground mt-1 text-xs">
              {card.description}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function SegmentCardsSkeleton() {
  // 3 skeleton cards — same shape as SegmentCards so the layout doesn't
  // shift when the real data lands. The `animate-pulse` class (from the
  // shadcn Skeleton primitive) is the user-visible "loading" affordance.
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {SEGMENT_CARDS.map((card) => (
        <Card key={card.key}>
          <CardHeader>
            <CardTitle>
              <Skeleton className="h-5 w-20" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-9 w-16" />
            <Skeleton className="mt-2 h-3 w-32" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
