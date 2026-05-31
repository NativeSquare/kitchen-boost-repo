/**
 * F-COMMANDES-PAGE-SHELL (#222) — `CommandesView`, pure presentational shell of
 * the tenant Commandes page (header + placeholder, first tracer-bullet of EPIC
 * F-COMMANDES #141).
 *
 * Slice 1 (this issue) ships ONLY the scaffold (issue body « pas de données
 * encore — juste le scaffold prouvant que la route est joignable, le tenant
 * context est résolu via le segment `[tenantId]`, et la page hérite du layout
 * chrome-less »). The live orders table (`api.lib.orders.orders.listOrders`),
 * filters (range date + multi-select statut), detail modal (`getOrder`),
 * refund total flow (Stripe), and CSV export land in subsequent slices of
 * EPIC #141; this view stays deliberately dumb and renders the
 * « La liste arrive dans le prochain slice » placeholder so the navigation
 * surface is in place from day one without misleading the gérant into
 * believing the table is wired.
 *
 * The placeholder carries a stable `data-slot="commandes-page-placeholder"`
 * marker so subsequent slices (and tests) can target it without scraping
 * copy.
 *
 * Split out of `page.tsx` so vitest can pin every branch under
 * `environment: "node"` — same React-tree-serializer pattern as
 * `parametres-view.tsx`. The page hands no props in slice 1 (no data wired
 * yet); the view is a pure nullary function.
 *
 * Scope discipline (#222 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/commandes/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function CommandesView(): React.ReactElement {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <CommandesHeader />
      <div className="flex flex-col gap-4 px-4 md:gap-6 lg:px-6">
        <PlaceholderCard />
      </div>
    </div>
  );
}

function CommandesHeader() {
  return (
    <div className="flex flex-col gap-2 px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Commandes</h1>
      </div>
    </div>
  );
}

/**
 * Slice-1 placeholder card. The copy explicitly signals « la liste arrive
 * dans le prochain slice » so the gérant (and any future agent picking up the
 * next F-COMMANDES slice) knows the table is not yet wired. The `data-slot`
 * marker is the stable handle for tests and downstream surfaces.
 */
function PlaceholderCard() {
  return (
    <Card data-slot="commandes-page-placeholder">
      <CardHeader>
        <CardTitle>Liste des commandes</CardTitle>
        <CardDescription>
          La table live, les filtres date / statut, le détail et le
          remboursement arrivent dans les prochains slices.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-muted-foreground text-sm">
            La liste arrive dans le prochain slice.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
