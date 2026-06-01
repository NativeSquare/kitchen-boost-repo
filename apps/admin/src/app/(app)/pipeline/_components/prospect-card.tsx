"use client";

/**
 * F-PIPELINE-CRM 05 (#255) — `ProspectCard`.
 *
 * Single card rendered inside a `KanbanColumn`. Pure presentation: takes
 * the prospect snapshot + an optional `now` (for deterministic tests) and
 * renders :
 *
 *   - name (top, prominent)
 *   - source (one of the 4 acquisition channels, cf. `acquisitionSource`)
 *   - score (optional — hidden when absent, no « undefined » garbage)
 *   - last interaction date, relative to NOW (« il y a 3 j »), or
 *     « Aucune interaction » fallback
 *   - `tenant ✓` badge IFF `prospect.tenantId` is set (the prospect has
 *     been provisioned — i.e. it's now a signed tenant, kb-admin CONTEXT
 *     `tenantId` back-link)
 *
 * The whole card is a bare `<a>` to `/pipeline/[prospectId]` (the existing
 * fiche, F-SHELL-10 #233 — see « Why plain `<a>` » section below for the
 * testing rationale). Click is the only interaction this slice exposes
 * — drag-and-drop arrives in PIPELINE-06 (#221).
 *
 * Why a local relative-time helper (not date-fns)
 * ----------------------------------------------
 * The admin app doesn't ship date-fns / dayjs (verified — none in
 * `package.json`). The Kanban surface needs ONE relative formatter, in
 * French, for « il y a Nx » ; pulling a full i18n date lib for that would
 * be over-engineered. `formatRelativeFromNow` below is ~10 lines and pinned
 * by `prospect-card.test.tsx`.
 *
 * Why plain `<a>` (not `next/link`)
 * ---------------------------------
 * Mirrors `provision-launcher-button.tsx` / `prospect-fiche-view.tsx`: a
 * bare `<a>` lets the React-tree serializer used by the vitest suite
 * (lean `node` env, no jsdom, no Next.js router) inspect the `href`
 * directly. Next.js's prefetching is the only thing forfeited, and the
 * Kanban renders ≤ a few hundred cards on a supervision page — not a hot
 * path that warrants the testing-ergonomics hit.
 *
 * Scope discipline (#255 hard constraint): file lives under
 * `apps/admin/src/app/(app)/pipeline/_components/` ONLY. Zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { ProspectCardSnapshot } from "../_lib/prospectFilter";

/**
 * Human label for each `acquisitionSource` literal — same vocabulary as
 * the rest of the admin shell (PRD 70 §3.3 « 4 canaux d'acquisition »).
 */
const SOURCE_LABEL: Record<ProspectCardSnapshot["source"], string> = {
  cold_call: "Cold call",
  whatsapp: "WhatsApp",
  referral: "Référence",
  visite_physique: "Visite physique",
};

/**
 * Lightweight French relative-time formatter. Returns « il y a Nx »
 * where x is the most appropriate coarse unit (min / h / j) for a date
 * in the past, capped at days (the operator only cares about
 * « interagi récemment » vs « ça traîne »). Future dates collapse to
 * « à l'instant » (defensive — shouldn't happen in production).
 */
function formatRelativeFromNow(at: number, now: number): string {
  const deltaMs = Math.max(0, now - at);
  const min = Math.floor(deltaMs / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}

export type ProspectCardProps = {
  prospect: ProspectCardSnapshot;
  /**
   * Reference instant for relative-time rendering. ALWAYS passed by the
   * caller — the parent owns the « current time » so the React purity rule
   * (`react-hooks/purity`) isn't tripped by calling `Date.now()` inside
   * render (impure, would update unpredictably on re-render). The page
   * computes it once via `useState(() => Date.now())` at the top of the
   * `/pipeline` surface.
   */
  now: number;
  /** Optional extra class on the outer wrapper (e.g. column-side spacing). */
  className?: string;
};

export function ProspectCard({ prospect, now, className }: ProspectCardProps) {
  // Most recent interaction = max by `date`. The schema stores them in an
  // array with no specified order — appending is the documented operation
  // (`appendInteraction` in lib/tenancy/prospectsStore), but we don't rely
  // on insertion order here.
  const latestInteraction = prospect.interactions?.reduce<
    { date: number } | undefined
  >((acc, cur) => {
    if (typeof cur.date !== "number") return acc;
    if (acc === undefined || cur.date > acc.date) return { date: cur.date };
    return acc;
  }, undefined);

  const relativeLabel =
    latestInteraction !== undefined
      ? formatRelativeFromNow(latestInteraction.date, now)
      : "Aucune interaction";

  return (
    <a
      href={`/pipeline/${prospect._id as string}`}
      data-prospect-id={prospect._id as string}
      data-phase={prospect.phase}
      className={cn(
        "block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl",
        className,
      )}
    >
      <Card className="hover:bg-accent/40 transition-colors gap-2 py-3">
        <CardContent className="px-4 flex flex-col gap-1.5">
          <div className="flex items-start justify-between gap-2">
            <span className="font-semibold text-sm leading-tight">
              {prospect.name}
            </span>
            {prospect.tenantId !== undefined ? (
              <Badge
                variant="secondary"
                className="shrink-0 bg-emerald-100 text-emerald-900"
              >
                tenant ✓
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2 text-muted-foreground text-xs">
            <span>{SOURCE_LABEL[prospect.source]}</span>
            {typeof prospect.score === "number" ? (
              <span aria-label="Score">Score {prospect.score}</span>
            ) : null}
          </div>
          <div className="text-muted-foreground text-xs">{relativeLabel}</div>
        </CardContent>
      </Card>
    </a>
  );
}
