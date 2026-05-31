/**
 * F-CAMPAGNES [2/7] (#188) — `TemplatePicker`, the grid+states wrapper around
 * `TemplateCard` (parent EPIC #145, PRD 80 §4 + ADR 0006).
 *
 * Issue body verbatim: « `TemplatePicker` : grid responsive des
 * `TemplateCard`, branchée sur `listTenantTemplates`. Gère **loading**
 * (skeleton cards) et **vide** (« Aucun template disponible — contacte ton
 * CSM pour en demander un »). »
 *
 * Three branches, mirror of the slice-1 `CampagnesView` discipline:
 *   - `templates === undefined` → grid of skeleton cards (Convex's loading
 *     sentinel). N=3 placeholders so the layout doesn't visually pop when
 *     real data lands (matches the most common « 3 templates dispo »
 *     fixture in dev). Each skeleton carries the shadcn `<Skeleton/>`
 *     primitive (`data-slot="skeleton"`).
 *   - `templates.length === 0` → empty state. The copy is the issue-body
 *     verbatim « Aucun template disponible — contacte ton CSM pour en
 *     demander un ». No card, no skeleton.
 *   - else → responsive grid of `TemplateCard`, one per template, sorted
 *     by `label` for deterministic order (the backend doesn't pin order;
 *     a stable client-side sort keeps a regression that reshuffles them
 *     visually loud).
 *
 * Responsive grid — Tailwind utilities: `grid-cols-1` (mobile, one per
 * row), `sm:grid-cols-2` (tablet), `lg:grid-cols-3` (desktop). Cards stay
 * the same min width thanks to `h-full` inside `TemplateCard`. The grid
 * gap is `gap-4` so the KB-palette accents stay legible without crowding.
 *
 * Scope (#188 hard constraint): under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/_components/`. Zero
 * touch to `apps/web`, `apps/native`, or `packages/backend/convex/`.
 *
 * MOAT / isolation: presentational only. The `templates` array is passed
 * in by the page (which calls `useTenantQuery` and inherits the
 * `listTenantTemplates` tenant-scoped isolation, ADR 0010). The page-level
 * wrapper test pins the « no raw `useQuery` » discipline already.
 */

import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { TemplateCard } from "./TemplateCard";

/** Number of skeleton placeholders rendered while the query is in flight.
 *  3 matches the responsive desktop grid (lg:grid-cols-3) so the loading
 *  state visually anticipates the populated state without pretending to
 *  know the real count. */
const SKELETON_COUNT = 3;

export type TemplatePickerProps = {
  /** Current tenant — forwarded into each `TemplateCard` so per-card
   *  hrefs target the correct `/t/[tenantId]/...` route. */
  tenantId: Id<"tenants">;
  /**
   * Templates payload from
   * `useTenantQuery(api.lib.notifications.campaigns.listTenantTemplates)`.
   * Tri-state contract:
   *   - `undefined` → query in flight (Convex's loading sentinel) — render
   *     skeleton cards.
   *   - `[]`        → no template available for this tenant — render the
   *     empty state with the CSM CTA copy.
   *   - non-empty   → render one `TemplateCard` per template, in a
   *     responsive grid.
   */
  templates: TenantTemplateSummary[] | undefined;
};

export function TemplatePicker({ tenantId, templates }: TemplatePickerProps) {
  if (templates === undefined) {
    return (
      <div
        data-slot="template-picker-loading"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      >
        {Array.from({ length: SKELETON_COUNT }).map((_, index) => (
          <TemplateCardSkeleton key={index} />
        ))}
      </div>
    );
  }

  if (templates.length === 0) {
    // Empty state — issue body verbatim copy. The CSM CTA is plain text
    // (the contact path itself is out of scope here — a later slice or
    // /support route owns it). The MOAT (no nominative data) is upheld
    // trivially: we render zero customer-anything.
    return (
      <div
        data-slot="template-picker-empty"
        className="rounded-lg border border-dashed p-8 text-center"
      >
        <p className="text-muted-foreground text-sm">
          Aucun template disponible — contacte ton CSM pour en demander un.
        </p>
      </div>
    );
  }

  // Deterministic client-side sort: backend doesn't pin order, so we sort
  // by label so a card reshuffle stands out in screenshots / E2E.
  const sorted = [...templates].sort((a, b) =>
    a.label.localeCompare(b.label, "fr"),
  );

  return (
    <div
      data-slot="template-picker-grid"
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {sorted.map((template) => (
        <TemplateCard
          key={template.id}
          tenantId={tenantId}
          template={template}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton shape mirroring `TemplateCard`'s outer layout so the visual
 * footprint matches when real data lands (label line, channel-badges row,
 * preview lines).
 */
function TemplateCardSkeleton() {
  return (
    <Card data-slot="template-card-skeleton">
      <CardHeader>
        <Skeleton className="h-5 w-3/4" />
        <div className="mt-2 flex gap-1.5">
          <Skeleton className="h-5 w-12" />
          <Skeleton className="h-5 w-16" />
        </div>
      </CardHeader>
      <CardContent>
        <Skeleton className="h-4 w-full" />
        <Skeleton className="mt-2 h-4 w-5/6" />
      </CardContent>
    </Card>
  );
}
