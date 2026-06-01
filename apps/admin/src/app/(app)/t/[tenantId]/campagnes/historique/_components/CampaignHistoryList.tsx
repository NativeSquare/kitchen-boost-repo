/**
 * F-CAMPAGNES [6/7] (#240) — `CampaignHistoryList`, the pure presentational
 * surface of the « historique des lancements campagne » list page
 * `/t/[tenantId]/campagnes/historique/` (parent EPIC #145, ADR 0010 MOAT /
 * PRD 90 §3-§5).
 *
 * Three branches (mirror of the picker / template view discipline):
 *   - `launches === undefined` → grid of skeleton rows (Convex loading
 *     sentinel).
 *   - `launches === []`        → empty state « Aucune campagne lancée pour
 *     l'instant ».
 *   - else                     → list, one row per launch (the backend already
 *     sorted desc; the view preserves the order it receives). Each row
 *     surfaces the template label + the date + the two load-bearing counters
 *     of the issue body (« au minimum `targeted` + `sent` ») and links to the
 *     per-launch detail page.
 *
 * ── MOAT ─────────────────────────────────────────────────────────────────────
 * Aggregate-only: no recipient identity, no per-customer surface. The backend
 * `listTenantCampaignLaunches` returns counts only; this view never invents a
 * <ul>/<ol>/<table> shape carrying per-recipient rows.
 *
 * Scope (#240 hard constraint): only files under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/historique/`. Zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/` (beyond the public
 * query addition under `lib/notifications/campaigns`).
 */
import Link from "next/link";

import type { CampaignLaunchSummary as BackendSummary } from "@packages/backend/convex/lib/notifications";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** Re-export the backend type so consumers of this view import it from one
 *  place (the file they actually call). No parallel type definition — ADR 0009. */
export type CampaignLaunchSummary = BackendSummary;

/** Number of skeleton rows rendered while the query is in flight. Matches a
 *  typical history of ~3-5 launches per resto (the V1 anti-anomaly cadence is
 *  ≤ 3/sem, so most restos sit between 1 and 5 historical entries). */
const SKELETON_COUNT = 3;

export type CampaignHistoryListProps = {
  /** Current tenant — forwarded into each row's `<Link>` so per-row hrefs
   *  target `/t/[tenantId]/campagnes/historique/[launchId]`. */
  tenantId: Id<"tenants">;
  /**
   * Launches payload from
   * `useTenantQuery(api.lib.notifications.campaigns.listTenantCampaignLaunches)`.
   * Tri-state contract:
   *   - `undefined` → query in flight → render skeleton rows.
   *   - `[]`        → no launch yet → render the FR empty state.
   *   - non-empty   → render one row per launch (backend-sorted desc).
   */
  launches: CampaignLaunchSummary[] | undefined;
};

export function CampaignHistoryList({
  tenantId,
  launches,
}: CampaignHistoryListProps) {
  if (launches === undefined) {
    return (
      <div data-slot="campaign-history-loading" className="flex flex-col gap-3">
        {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
          <CampaignHistoryRowSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (launches.length === 0) {
    return (
      <div
        data-slot="campaign-history-empty"
        className="rounded-lg border border-dashed p-8 text-center"
      >
        <p className="text-muted-foreground text-sm">
          Aucune campagne lancée pour l’instant.
        </p>
      </div>
    );
  }

  return (
    <div data-slot="campaign-history-list" className="flex flex-col gap-3">
      {launches.map((launch) => (
        <CampaignHistoryRow
          key={launch.id}
          tenantId={tenantId}
          launch={launch}
        />
      ))}
    </div>
  );
}

function CampaignHistoryRow({
  tenantId,
  launch,
}: {
  tenantId: Id<"tenants">;
  launch: CampaignLaunchSummary;
}) {
  return (
    <Link
      href={`/t/${tenantId}/campagnes/historique/${launch.id}`}
      className="block"
    >
      <Card
        data-slot="campaign-history-row"
        className="transition-shadow hover:shadow-md"
      >
        <CardHeader>
          <CardTitle className="text-base">
            {launch.templateLabel ?? "Campagne (template inconnu)"}
          </CardTitle>
          <p className="text-muted-foreground text-xs">
            {formatLaunchDate(launch.launchedAt)}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span>
              <span className="text-muted-foreground">Clients ciblés : </span>
              <span className="font-semibold tabular-nums">
                {launch.targeted}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">
                Envoyés maintenant :{" "}
              </span>
              <span className="font-semibold tabular-nums">{launch.sent}</span>
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

function CampaignHistoryRowSkeleton() {
  return (
    <Card data-slot="campaign-history-row-skeleton">
      <CardHeader>
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="mt-2 h-3 w-1/3" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-4 w-2/3" />
      </CardContent>
    </Card>
  );
}

/**
 * FR-locale launch date — "14 mai 2026 à 15:00". Uses Intl with `fr-FR`; no
 * timezone is forced (the resto runs in its own browser TZ, which is FR for
 * V1). Pure formatting; safe under `environment: "node"` in vitest.
 */
function formatLaunchDate(ts: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(ts));
}
