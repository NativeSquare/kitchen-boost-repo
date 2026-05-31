/**
 * F-CAMPAGNES [1/7] (#179) — `CampagnesView`, pure presentational shell of
 * the first tracer-bullet of the resto campaign UI (parent EPIC #145).
 *
 * Tracer-bullet contract — issue body verbatim: « afficher la liste BRUTE des
 * templates retournés (titre + JSON dump suffit à ce stade). Aucun composant
 * carte, aucune navigation, aucun style — juste la chaîne complète route
 * tenant-scopée → query Convex tenant-scopée → rendu liste ». Subsequent
 * slices (2..7) wire the picker, form, preview, send, result.
 *
 * Owns the three branches the page can be in:
 *   - `templates === undefined` → loading affordance (Convex's loading
 *     sentinel from `useTenantQuery`). « Chargement… » — FR-only.
 *   - `templates === []`        → empty state with the issue-body verbatim
 *     copy « Aucun template disponible ».
 *   - else                      → one `<li>` per template, label + JSON dump
 *     (the issue body explicitly accepts the JSON dump alongside the label
 *     to prove the full chain works end-to-end before slice 2 dresses it).
 *
 * Split out of `page.tsx` (which owns `useTenantQuery`) so vitest can pin
 * every branch under `environment: "node"` (no jsdom, no Convex test
 * harness) — same React-tree-serializer pattern as the `mes-clients-view`
 * and `parametres-view` shells.
 *
 * Anti-spec discipline:
 *   - NO Card primitives, NO navigation, NO styling polish (deliberately
 *     bare per the issue body — slice 2 will introduce the picker UI).
 *   - The TenantTemplateSummary type is REUSED FROM the backend module
 *     (`packages/backend/convex/lib/notifications/campaigns`); no parallel
 *     type definition (ADR 0009 — backend remains the source of truth for
 *     the contract shape).
 */
import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";

export type CampagnesViewProps = {
  /**
   * Templates payload from
   * `useTenantQuery(api.lib.notifications.campaigns.listTenantTemplates)`.
   * Tri-state contract:
   *   - `undefined` → query in flight (Convex's loading sentinel)
   *   - `[]`        → query resolved with no template available
   *   - non-empty   → render one item per template
   *
   * No `null` branch yet: a thrown error (Forbidden, network) propagates
   * through to the route-segment Error Boundary if/when one is added (a
   * later slice may introduce `./error.tsx` like `mes-clients/`).
   */
  templates: TenantTemplateSummary[] | undefined;
};

export function CampagnesView({ templates }: CampagnesViewProps) {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Campagnes</h1>
      </div>
      <div className="px-4 lg:px-6">
        <CampagnesBody templates={templates} />
      </div>
    </div>
  );
}

function CampagnesBody({
  templates,
}: {
  templates: TenantTemplateSummary[] | undefined;
}) {
  if (templates === undefined) {
    // Loading affordance — text-only (no Skeleton primitive yet; the
    // tracer-bullet stays minimal per the issue body). FR-only.
    return <p className="text-muted-foreground text-sm">Chargement…</p>;
  }
  if (templates.length === 0) {
    // Empty state — copy is the issue body's verbatim wording.
    return (
      <p className="text-muted-foreground text-sm">Aucun template disponible</p>
    );
  }
  // List branch — one `<li>` per template. The label is the user-visible
  // anchor; the JSON dump follows it (issue body: « titre + JSON dump
  // suffit à ce stade ») so the full chain — route → query → render — is
  // observably wired end-to-end before slice 2 dresses the card UI.
  return (
    <ul className="flex flex-col gap-2">
      {templates.map((t) => (
        <li key={t.id} className="border-b pb-2 last:border-b-0">
          <p className="font-medium">{t.label}</p>
          <pre className="text-muted-foreground mt-1 text-xs whitespace-pre-wrap break-words">
            {JSON.stringify(t, null, 2)}
          </pre>
        </li>
      ))}
    </ul>
  );
}
