"use client";

/**
 * F-PIPELINE-CRM 05 (#255) — `ActiveClientsTab`.
 *
 * The « Clients actifs » panel (PRD 70 §3.3 « onglet séparé Opérationnel »):
 * lists the prospects in the `operationnel` phase as a flat stack of the
 * SAME `ProspectCard` the Kanban uses — operator vocabulary stays
 * consistent across both views.
 *
 * Out of scope for this slice : statut overlays (`active` / `at_risk` /
 * `churned`, PRD 70 §3.3) — they require winner-criteria metrics that land
 * later. The card already shows enough (name, source, score, last
 * interaction, tenant ✓) for the operator to navigate to the fiche.
 */
import type { ProspectCardSnapshot } from "../_lib/prospectFilter";

import { ProspectCard } from "./prospect-card";

export type ActiveClientsTabProps = {
  prospects: ReadonlyArray<ProspectCardSnapshot>;
  /**
   * Reference instant plumbed through to every `ProspectCard`. See
   * `ProspectCardProps.now` for the React-purity rationale. Defaults to
   * `0` (the « 1970 » fallback never matters: tests that care pass an
   * explicit value, production callers always pass the page-scoped
   * `useState(() => Date.now())`).
   */
  now?: number;
};

export function ActiveClientsTab({ prospects, now }: ActiveClientsTabProps) {
  const referenceNow = now ?? 0;
  if (prospects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">Aucun client actif</p>
      </div>
    );
  }
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {prospects.map((p) => (
        <li key={p._id as string}>
          <ProspectCard prospect={p} now={referenceNow} />
        </li>
      ))}
    </ul>
  );
}
