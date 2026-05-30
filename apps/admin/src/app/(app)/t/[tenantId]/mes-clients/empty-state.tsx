/**
 * F-MES-CLIENTS [1/4] (#181) — `MesClientsEmptyState`, the presentational
 * empty state of the route.
 *
 * Default surface of the "Mes clients" view in V1: the KPI tiles (Slices 2-4)
 * will replace this state once the queries are branched, but for now (Slice
 * 1/4 = page skeleton + audit-on-open), the route always renders this
 * component. It surfaces the page title AND the empty-state copy promised by
 * the issue body, with ZERO nominative data — the MOAT (PRD 70 §4.4 / Q90-Q2
 * / ADR 0010).
 *
 * Kept as a separate pure presentational component so vitest can pin its
 * contract under the lean `node` env (no jsdom, no RTL) — see
 * `empty-state.test.tsx`. The page wrapper (`page.tsx`) only adds the audit-
 * on-open wiring; the visible rendering is here.
 */
export function MesClientsEmptyState() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Mes clients</h1>
      </div>
      <div className="px-4 lg:px-6">
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-muted-foreground text-sm">
            Aucun client encore — vos KPI s&apos;afficheront dès la première
            commande.
          </p>
        </div>
      </div>
    </div>
  );
}
