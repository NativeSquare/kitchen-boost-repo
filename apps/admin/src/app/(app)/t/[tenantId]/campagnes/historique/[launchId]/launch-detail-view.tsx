/**
 * F-CAMPAGNES [6/7] (#240) — `LaunchDetailView`, the pure presentational shell
 * of the per-launch historique detail page (parent EPIC #145).
 *
 * Three branches keyed on the resolved launch payload:
 *   - `launch === undefined` → loading skeleton (Convex loading sentinel).
 *   - `launch === null`      → resolved-not-found (the launchId in the URL no
 *     longer matches this tenant's history — stale share / cleaned-up data).
 *     FR « Lancement introuvable » + back link to the list.
 *   - else                   → loaded — page title (template label) + back
 *     link + `<CampaignResultStats/>` REUSED from slice 5 (no duplication —
 *     issue body verbatim « réutilisation de `CampaignResultStats` »).
 *
 * The reused `CampaignResultStats` already pins the 6 FR labels + the MOAT-no-PII
 * shape. We feed it the 6 counters straight from the launch payload (same
 * `CampaignResult` shape — just rebuilt from the persisted aggregates).
 *
 * Scope (#240 hard constraint): only files under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/historique/`. The
 * cross-folder import of `CampaignResultStats` is the WHOLE POINT of slice 6
 * (reuse, no duplicate copy).
 */

import Link from "next/link";

import type {
  CampaignLaunchSummary,
  CampaignResult,
} from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Skeleton } from "@/components/ui/skeleton";

import { CampaignResultStats } from "../../[templateId]/_components/CampaignResultStats";

/** Re-export the backend type so consumers import it from this file. */
export type CampaignLaunchDetail = CampaignLaunchSummary;

export type LaunchDetailViewProps = {
  /** Current tenant — used by the back link target. */
  tenantId: Id<"tenants">;
  /** LaunchId from the URL segment — surfaced on the not-found branch so the
   *  gérant sees WHICH id is missing (useful when sharing a stale URL). */
  launchId: Id<"campaignLaunches">;
  /**
   * Resolved launch payload:
   *   - `undefined` → still loading.
   *   - `null`      → resolved, launchId not found in this tenant's history.
   *   - `CampaignLaunchDetail` → loaded.
   */
  launch: CampaignLaunchDetail | null | undefined;
};

export function LaunchDetailView({
  tenantId,
  launchId,
  launch,
}: LaunchDetailViewProps) {
  if (launch === undefined) {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <Skeleton className="h-8 w-1/2" />
        </div>
        <div className="px-4 lg:px-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (launch === null) {
    return (
      <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
        <div className="px-4 lg:px-6">
          <h1 className="text-2xl font-bold">Lancement introuvable</h1>
        </div>
        <div className="px-4 lg:px-6">
          <p className="text-muted-foreground text-sm">
            Le lancement <code className="font-mono text-xs">{launchId}</code>{" "}
            n&apos;est plus disponible pour ce restaurant. Reviens à
            l&apos;historique des campagnes.
          </p>
          <div className="mt-4">
            <Link
              href={`/t/${tenantId}/campagnes/historique`}
              className="text-sm font-medium text-[#1B7A3D] underline-offset-4 hover:underline"
            >
              Retour à l&apos;historique
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const result: CampaignResult = {
    targeted: launch.targeted,
    sent: launch.sent,
    queued: launch.queued,
    skippedIneligible: launch.skippedIneligible,
    skippedRateLimited: launch.skippedRateLimited,
    skippedUnreachable: launch.skippedUnreachable,
  };

  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <Link
          href={`/t/${tenantId}/campagnes/historique`}
          className="text-muted-foreground text-xs hover:underline"
        >
          ← Historique
        </Link>
        <h1 className="mt-1 text-2xl font-bold">
          {launch.templateLabel ?? "Campagne (template inconnu)"}
        </h1>
        <p className="text-muted-foreground text-sm">
          Lancée le {formatLaunchDate(launch.launchedAt)}
        </p>
      </div>
      <div className="px-4 lg:px-6">
        <CampaignResultStats result={result} />
      </div>
    </div>
  );
}

function formatLaunchDate(ts: number): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date(ts));
}
