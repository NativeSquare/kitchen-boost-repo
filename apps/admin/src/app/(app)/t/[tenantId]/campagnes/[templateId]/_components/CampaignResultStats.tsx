/**
 * F-CAMPAGNES [5/7] (#228) — `CampaignResultStats`, the aggregate-only result
 * surface that paints the 6 server counters returned by `sendTenantCampaign`
 * (parent EPIC #145, ADR 0010 MOAT / PRD 80 §4 / PRD 90 §3-§5).
 *
 * The 6 counters and their EXACT FR labels (issue body verbatim) :
 *
 *   | Backend counter        | FR label                                    |
 *   | ---------------------- | ------------------------------------------- |
 *   | `targeted`             | « Clients ciblés »                          |
 *   | `sent`                 | « Envoyés maintenant »                      |
 *   | `queued`               | « Programmés pour 8h (DNT) »                |
 *   | `skippedIneligible`    | « Désinscrits / non éligibles »             |
 *   | `skippedRateLimited`   | « Quota 3/sem atteint »                     |
 *   | `skippedUnreachable`   | « Aucun canal joignable »                   |
 *
 * MOAT (ADR 0010, PRD 90 §3-§5) — a `kb_manager` NEVER sees a recipient
 * identity. The component receives ONLY the `CampaignResult` payload
 * (6 numeric aggregates); there is no per-customer row, no list, no email /
 * phone / name. The backend `sendTenantCampaign` is the wrapper that enforces
 * this server-side (KB proxy : the resto never receives a `customer` object);
 * the view enforces it visually (no <ul>/<ol>/<table>, no PII glyph).
 *
 * Pure presentational — no query, no mutation. Renders a responsive cards grid
 * (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, same shape as the rest of the
 * admin app's KPI surfaces, cf. `MesClientsView`).
 *
 * Scope (#228 hard constraint) : only this file under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/[templateId]/_components/`.
 * Zero touch to `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */

import type { CampaignResult } from "@packages/backend/convex/lib/notifications";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type CampaignResultStatsProps = {
  /** Aggregate-only counters returned by `sendTenantCampaign` (no PII). */
  result: CampaignResult;
};

/**
 * Static label table for the 6 counters. The FR copy is the LOAD-BEARING part
 * of the issue body — pinned by the test. Centralised here so a typographic
 * polish stays a one-line edit.
 */
const COUNTER_CARDS: ReadonlyArray<{
  key: keyof CampaignResult;
  label: string;
  description: string;
}> = [
  {
    key: "targeted",
    label: "Clients ciblés",
    description:
      "Clients éligibles et joignables sur au moins un canal de la cascade.",
  },
  {
    key: "sent",
    label: "Envoyés maintenant",
    description: "Envois partis immédiatement (hors créneau silence 22h-8h).",
  },
  {
    key: "queued",
    label: "Programmés pour 8h (DNT)",
    description:
      "Envois différés à 8h le lendemain (créneau silence Europe/Paris).",
  },
  {
    key: "skippedIneligible",
    label: "Désinscrits / non éligibles",
    description: "Clients ayant retiré leur consentement marketing.",
  },
  {
    key: "skippedRateLimited",
    label: "Quota 3/sem atteint",
    description:
      "Clients déjà servis 3 fois cette semaine, toutes campagnes confondues.",
  },
  {
    key: "skippedUnreachable",
    label: "Aucun canal joignable",
    description: "Clients sans push ni e-mail valide actuellement.",
  },
];

export function CampaignResultStats({ result }: CampaignResultStatsProps) {
  return (
    <div data-slot="campaign-result-stats" className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Résultats
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {COUNTER_CARDS.map((card) => (
          <Card key={card.key} data-slot="campaign-result-card">
            <CardHeader>
              <CardTitle>{card.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">
                {result[card.key]}
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                {card.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
