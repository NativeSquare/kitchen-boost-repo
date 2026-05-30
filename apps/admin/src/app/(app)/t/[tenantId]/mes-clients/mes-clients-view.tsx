/**
 * F-MES-CLIENTS [3/4] (#190) — `MesClientsView`, pure presentational shell
 * of the "Mes clients" KPI page. Adds the 3 reachability cards (push / e-mail
 * / SMS) AND the 3 macro cards (Total / Nouveaux ce mois / Taux de retour %)
 * ALONGSIDE the slice-2 segment cards. Same `aggregateCustomerKPIs` payload
 * (additive — no new query), same anti-PII discipline.
 *
 * Owns the four branches the page can be in:
 *   - `kpis === undefined` → loading skeletons (3 + 3 + 3 = 9 card skeletons +
 *     title; no blank flash, no shell-swap when the data lands).
 *   - `kpis === null`     → error fallback (« Impossible de charger… ») —
 *     also covers the « Accès refusé » path (the backend's Forbidden bubbles
 *     up through `useQuery` → `useTenantQuery` and the page caller maps it
 *     to `null` so the view stays pure).
 *   - `kpis.total === 0`  → `MesClientsEmptyState` (slice 1 #181 regression):
 *     even though macro cards COULD render meaningfully on an empty tenant
 *     (Total: 0 / Nouveaux: 0 / Taux: 0 %), the contract is "pick one
 *     surface" — the friendly empty state wins over a 0/0/0 wall.
 *   - else                → 9 cards: 3 segments (Actifs / Inactifs / VIP),
 *     3 reachability (Push / E-mail / SMS) and 3 macro (Total / Nouveaux ce
 *     mois / Taux de retour %). ONLY aggregates ever cross the wrapper
 *     boundary into the resto's view — the MOAT (PRD 70 §4.4 / Q90-Q2 / ADR
 *     0010).
 *
 * Each KPI block (segments / reachability / macro) renders on its OWN
 * responsive grid (`grid-cols-1` mobile, `lg:grid-cols-3` desktop). The lg+
 * breakpoint is the issue's explicit "3 colonnes desktop" target — at md a
 * tablet keeps the 1-column stack so card values stay glanceable on a small
 * landscape screen. (Slice 2 shipped the segments grid at `md:grid-cols-3`;
 * slice 3 harmonises all three blocks to `lg:grid-cols-3` so the responsive
 * contract pinned by `mes-clients-view.test.tsx` (#190 AC4) applies to every
 * cards grid the user sees.)
 *
 * Split out of `page.tsx` (which owns `useTenantQuery` /
 * `useAuditOnOpen` / `useMutation`) so vitest can pin every branch under
 * `environment: "node"` (no jsdom, no Convex test harness) — same React-
 * tree-serializer pattern as `monitoring/monitoring-view.tsx` and
 * `empty-state.tsx`. The page hands `kpis` in as a prop; the view is a pure
 * function of its props.
 *
 * Anti-PII contracts kept intact across slices:
 *   - The empty-state copy + title stay verbatim — fallback for `total === 0`
 *     still reads as it did under #181.
 *   - PII labels are NEVER rendered, on ANY branch. The reachability card
 *     label is "E-mail" (with a hyphen) so the broad `\bemail\b` anti-PII
 *     regex pinned by `mes-clients-view.test.tsx` still passes — the cell is
 *     a CHANNEL count, not an email value (no `@`, no address, no name).
 *   - The error fallback would be the easiest place to slip a "emails clients
 *     introuvables" copy — explicitly forbidden by the anti-PII test.
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

/**
 * The three reachability channels — counts of clients addressable on each
 * channel (PRD 90 §3 + issue #190 body). The "E-mail" label is hyphenated on
 * purpose: the anti-PII regex (`\bemail\b`) MUST NOT match the channel name
 * AS a leaked PII label. The value displayed under each card is a count, not
 * an address — the MOAT survives the addition.
 */
const REACHABILITY_CARDS = [
  {
    key: "push" as const,
    label: "Push",
    description: "Clients atteignables par notification push",
  },
  {
    key: "email" as const,
    label: "E-mail",
    description: "Clients atteignables par e-mail",
  },
  {
    key: "sms" as const,
    label: "SMS",
    description: "Clients atteignables par SMS",
  },
];

/**
 * Shared responsive-grid classes for every cards block. Pinned by
 * `mes-clients-view.test.tsx` (#190 AC4): `grid-cols-1` mobile default,
 * `lg:grid-cols-3` desktop. Centralising the classes keeps the three blocks
 * in lock-step (a regression on one block fails ONE test, not three).
 */
const CARDS_GRID_CLASSES = "grid grid-cols-1 gap-4 lg:grid-cols-3";

/**
 * Format a fraction (0..1) as a French human-readable percentage (e.g. 0.42 →
 * "42 %"). Rounded to the nearest integer — the V1 view is glanceable, not a
 * dashboard with decimals. The raw fraction MUST NEVER reach the DOM (pinned
 * by `mes-clients-view.test.tsx` AC3). Total === 0 → renderMacroCards never
 * runs (empty state wins), so we don't need a "—" path here.
 */
function formatPercent(fraction: number): string {
  const pct = Math.round(fraction * 100);
  // `${n} %` (French typography — space before the percent sign).
  return `${pct} %`;
}

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
    return <CardsSkeleton />;
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
    // empty state — NOT 9 zero-cards (that would be a confusing "0/0/0"
    // surface on top of "aucun client encore"; the empty state is what the
    // PRD calls out as the V1 default).
    return <MesClientsEmptyState />;
  }
  return (
    <div className="flex flex-col gap-6">
      <SegmentCards segments={kpis.segments} />
      <ReachabilityCards reachability={kpis.reachability} />
      <MacroCards
        total={kpis.total}
        newThisMonth={kpis.newThisMonth}
        returnRate={kpis.returnRate}
      />
    </div>
  );
}

function SegmentCards({ segments }: { segments: CustomerKPIs["segments"] }) {
  return (
    <div className={CARDS_GRID_CLASSES}>
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

function ReachabilityCards({
  reachability,
}: {
  reachability: CustomerKPIs["reachability"];
}) {
  return (
    <div className={CARDS_GRID_CLASSES}>
      {REACHABILITY_CARDS.map((card) => (
        <Card key={card.key}>
          <CardHeader>
            <CardTitle>{card.label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold tabular-nums">
              {reachability[card.key]}
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

function MacroCards({
  total,
  newThisMonth,
  returnRate,
}: {
  total: number;
  newThisMonth: number;
  returnRate: number;
}) {
  // Hard-coded card list — three macro KPIs in a fixed order so the resto's
  // eye lands on the same metric across visits. Values are formatted at the
  // edge: `formatPercent` for returnRate, raw integer otherwise.
  return (
    <div className={CARDS_GRID_CLASSES}>
      <Card>
        <CardHeader>
          <CardTitle>Total clients</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold tabular-nums">{total}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Total des clients du restaurant
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Nouveaux ce mois</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold tabular-nums">{newThisMonth}</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Clients ayant commandé pour la première fois ce mois-ci
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Taux de retour</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold tabular-nums">
            {formatPercent(returnRate)}
          </p>
          <p className="text-muted-foreground mt-1 text-xs">
            Clients ayant passé ≥ 2 commandes
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function CardsSkeleton() {
  // 9 skeleton cards (3 segments + 3 reachability + 3 macro) — same shape as
  // the real grids so the layout doesn't shift when the data lands. The
  // `animate-pulse` class (from the shadcn Skeleton primitive) is the user-
  // visible "loading" affordance.
  return (
    <div className="flex flex-col gap-6">
      <SkeletonGrid count={3} />
      <SkeletonGrid count={3} />
      <SkeletonGrid count={3} />
    </div>
  );
}

function SkeletonGrid({ count }: { count: number }) {
  return (
    <div className={CARDS_GRID_CLASSES}>
      {Array.from({ length: count }, (_, i) => (
        <Card key={i}>
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
