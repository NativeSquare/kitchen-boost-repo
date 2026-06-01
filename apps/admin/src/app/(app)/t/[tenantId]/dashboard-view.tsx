/**
 * F-STATS-DASHBOARD (#252) — `DashboardView`, the pure presentational shell of
 * the tenant home `/t/[tenantId]/page.tsx`. Renders 4 KPI cards (CA jour,
 * commandes jour, panier moyen, commandes en cours) on a responsive grid
 * (1 col mobile / 2 cols tablette / 4 cols desktop).
 *
 * Tri-state contract (mirror of the backend `dailyKpis` query):
 *   - `kpis === undefined` → loading : every card shows a `<Skeleton/>`
 *     (Convex sentinel).
 *   - `kpis === null`      → error : surface an FR error banner + retry CTA
 *     (the page wires `toast.error` + `onRetry` to refetch).
 *   - non-null              → render the four KPIs (empty state — all zeros
 *     — is the natural NORMAL render with formatted values "0,00 €" / "0").
 *
 * `kpis` is forwarded as a prop (not read via a hook) so the view stays a
 * pure function callable from a node-env vitest test (no jsdom, no provider).
 * The page (which mounts under `<TenantProvider/>`) reads the Convex query
 * via `useTenantQuery` and threads it down.
 */
import * as React from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

import { KpiCard } from "./_components/KpiCard";

export type DashboardKpis = {
  /** Chiffre d'affaires du jour, en cents (somme des `pricingSnapshot.total`). */
  caTotal: number;
  /** Nombre de commandes payées aujourd'hui. */
  nbCommandes: number;
  /** Panier moyen du jour, en cents (`caTotal / nbCommandes`, floor). */
  panierMoyen: number;
  /** Commandes actuellement en cours (live kitchen queue). */
  commandesEnCours: number;
};

export type DashboardViewProps = {
  /**
   * Tri-state payload from `useTenantQuery(api.lib.stats.dailyKpis.dailyKpis)`,
   * normalisé par la page :
   *   - `undefined` → loading (Convex sentinel) ;
   *   - `null`      → error (la page convertit le throw en null) ;
   *   - sinon       → les 4 chiffres.
   */
  kpis: DashboardKpis | undefined | null;
  /**
   * Wired by the page to refetch the query. Surfaces a « Réessayer » CTA on
   * the error branch.
   */
  onRetry?: () => void;
};

/**
 * Format cents → "1 234,56 €" (locale fr-FR). Safe under `environment:
 * "node"` in vitest (uses Intl, which is in Node ≥ 18).
 */
function formatEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

/** Format an integer count (panel-friendly, no decimal). */
function formatCount(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n);
}

export function DashboardView({ kpis, onRetry }: DashboardViewProps) {
  if (kpis === null) {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <h1 className="text-2xl font-bold">Tableau de bord</h1>
        </div>
        <div className="px-4 lg:px-6">
          <Alert data-slot="dashboard-error" variant="destructive">
            <AlertTitle>Impossible de charger les indicateurs</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <span>Une erreur est survenue. Vérifie ta connexion.</span>
              {onRetry !== undefined ? (
                <Button
                  data-slot="dashboard-retry"
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
      </div>
    );
  }

  // Loading sentinel → every card shows a skeleton. Empty state is a
  // first-class NORMAL render (formatted zeros).
  const isLoading = kpis === undefined;
  const ca = isLoading ? undefined : formatEuros(kpis.caTotal);
  const nb = isLoading ? undefined : formatCount(kpis.nbCommandes);
  const moyen = isLoading ? undefined : formatEuros(kpis.panierMoyen);
  const enCours = isLoading ? undefined : formatCount(kpis.commandesEnCours);

  // Empty-state hint for the day's CA card (helps the gérant distinguish
  // "still fetching" — skeleton — from "no order yet today" — "0,00 €").
  const hintEmpty =
    !isLoading && kpis.nbCommandes === 0
      ? "Pas encore de commandes aujourd'hui"
      : undefined;

  return (
    <div
      data-slot="dashboard-view"
      className="flex flex-col gap-4 py-4 md:gap-6 md:py-6"
    >
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Tableau de bord</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Aperçu du jour — depuis 00h00.
        </p>
      </div>
      <div
        data-slot="dashboard-grid"
        className="grid grid-cols-1 gap-4 px-4 sm:grid-cols-2 lg:grid-cols-4 lg:px-6"
      >
        <KpiCard
          label="Chiffre d'affaires du jour"
          value={ca}
          hint={hintEmpty}
        />
        <KpiCard label="Commandes du jour" value={nb} />
        <KpiCard label="Panier moyen" value={moyen} />
        <KpiCard label="Commandes en cours" value={enCours} />
      </div>
    </div>
  );
}
