/**
 * F-STATS-DASHBOARD [3/8] (#253) — `StatsView`, the presentational shell of
 * the resto stats page `/t/[tenantId]/stats/page.tsx`.
 *
 * Owns the visual structure :
 *   1. Title « Statistiques » + the `RangePicker` (7 / 30 / 90 jours).
 *   2. « Chiffres bruts » bloc — 2 `KpiCard`s (panier moyen + total commandes)
 *      driven by the `rangeAggregates` Convex query.
 *   3. Responsive grid of 5 placeholder cards (Revenus, Top items, Heures
 *      de pointe, Conversion, Direct vs Marketplace) — real graph blocks
 *      will land in stories 4-8 (PRD 70 §4.10).
 *
 * Tri-state contract for `rangeAggregates` (mirror of the backend query) :
 *   - `undefined` → loading : KpiCards show `<Skeleton/>` ; placeholder cards
 *     also show skeletons in their content zone.
 *   - `null`      → error : surface an FR error banner + retry CTA. The page
 *     wires `onRetry` to refetch.
 *   - non-null    → render the 2 chiffres bruts (empty state — all zeros — is
 *     a first-class normal render with formatted "0,00 €" / "0").
 *
 * Why we receive props (rangeAggregates / range / onRangeChange / tenantId)
 * instead of calling hooks here : the view's unit test calls the function
 * pointer directly under `environment: "node"` (no React renderer, no
 * provider). Calling `useTenantQuery()` / `useState()` deep inside the view
 * would throw at test time. The page (`page.tsx`) owns the hooks and threads
 * everything down.
 *
 * Reuses the `KpiCard` primitive from `../_components/KpiCard.tsx` (introduced
 * by #252 for the dashboard home) — no parallel KPI surface.
 */
import * as React from "react";

import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { KpiCard } from "../_components/KpiCard";

import type { RangeDays } from "@/lib/stats-range";
import { RangePicker } from "./_components/RangePicker";

/** Shape of the `rangeAggregates` backend query result. */
export type RangeAggregates = {
  /** Average basket on the window, in cents. */
  panierMoyen: number;
  /** Number of paid orders on the window. */
  totalCommandes: number;
};

export type StatsViewProps = {
  /** Current tenant (forwarded to children that need it — graph blocks 4-8). */
  tenantId: Id<"tenants">;
  /** Currently selected range. */
  range: RangeDays;
  /** Page-owned setter for the range `useState`. */
  onRangeChange: (value: RangeDays) => void;
  /**
   * Tri-state payload from
   * `useTenantQuery(api.lib.stats.rangeAggregates.rangeAggregates, { rangeDays })` :
   *   - `undefined` → loading (Convex sentinel) ;
   *   - `null`      → error (the page maps a thrown error to null) ;
   *   - sinon       → the 2 chiffres bruts.
   */
  rangeAggregates: RangeAggregates | undefined | null;
  /** Wired by the page to refetch the query when the error CTA is clicked. */
  onRetry?: () => void;
};

/** The 5 placeholder cards (PRD 70 §4.10) — real blocks land in stories 4-8. */
const PLACEHOLDER_CARDS: { key: string; title: string; hint: string }[] = [
  { key: "revenus", title: "Revenus", hint: "Graph CA / jour (story 4)" },
  { key: "top-items", title: "Top items", hint: "Bar chart (story 5)" },
  {
    key: "heures-pointe",
    title: "Heures de pointe",
    hint: "Heatmap (story 6)",
  },
  { key: "conversion", title: "Conversion", hint: "Funnel (story 7)" },
  {
    key: "direct-vs-marketplace",
    title: "Direct vs Marketplace",
    hint: "Comparatif (story 8)",
  },
];

function formatEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

function formatCount(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

export function StatsView({
  tenantId: _tenantId,
  range,
  onRangeChange,
  rangeAggregates,
  onRetry,
}: StatsViewProps) {
  const isLoading = rangeAggregates === undefined;
  const isError = rangeAggregates === null;

  const panierMoyenLabel =
    isLoading || isError ? undefined : formatEuros(rangeAggregates.panierMoyen);
  const totalCommandesLabel =
    isLoading || isError
      ? undefined
      : formatCount(rangeAggregates.totalCommandes);

  return (
    <div
      data-slot="stats-view"
      className="flex flex-col gap-4 py-4 md:gap-6 md:py-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 lg:px-6">
        <div>
          <h1 className="text-2xl font-bold">Statistiques</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Activité du restaurant sur la fenêtre choisie.
          </p>
        </div>
        <RangePicker value={range} onChange={onRangeChange} />
      </div>

      {isError ? (
        <div className="px-4 lg:px-6">
          <Alert data-slot="stats-error" variant="destructive">
            <AlertTitle>Impossible de charger les chiffres</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>Une erreur est survenue. Vérifie ta connexion.</span>
              {onRetry !== undefined ? (
                <Button
                  data-slot="stats-retry"
                  variant="outline"
                  size="sm"
                  onClick={onRetry}
                  className="w-fit"
                >
                  Réessayer
                </Button>
              ) : null}
            </AlertDescription>
          </Alert>
        </div>
      ) : (
        <div
          data-slot="stats-raw-figures"
          className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:px-6"
        >
          <KpiCard label="Panier moyen" value={panierMoyenLabel} />
          <KpiCard label="Total commandes" value={totalCommandesLabel} />
        </div>
      )}

      <div
        data-slot="stats-grid"
        className="grid grid-cols-1 gap-4 px-4 md:grid-cols-2 lg:grid-cols-3 lg:px-6"
      >
        {PLACEHOLDER_CARDS.map((c) => (
          <Card
            key={c.key}
            data-slot="stats-placeholder-card"
            className="h-full"
          >
            <CardHeader>
              <CardTitle className="text-sm font-medium">{c.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-24 w-full" />
              <p className="text-muted-foreground mt-2 text-xs">{c.hint}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
