/**
 * F-CAMPAGNES [1/7] (#179) + [2/7] (#188) — `CampagnesView`, the
 * presentational shell of the resto campaign UI (parent EPIC #145).
 *
 * Slice 1 (#179) wired the tracer-bullet end-to-end (route → tenant query
 * → brute list). Slice 2 (#188) dresses the brute list with the shadcn
 * `TemplatePicker` + `TemplateCard` and keeps the page-level shell as a
 * thin frame: title « Campagnes » + the picker. The branch-level
 * behaviour (loading skeletons / empty-state copy / responsive grid) is
 * owned by `_components/TemplatePicker.tsx` and pinned in
 * `_components/TemplatePicker.test.tsx`.
 *
 * Owns the three branches the page can be in (via the picker):
 *   - `templates === undefined` → loading skeleton cards.
 *   - `templates === []`        → empty state with the issue-body CSM CTA.
 *   - else                      → responsive grid of `TemplateCard`s.
 *
 * Why we receive `tenantId` as a prop instead of calling
 * `useCurrentTenantId()` here: the view's unit test calls the function
 * pointer directly (`CampagnesView({ ... })`) under `environment: "node"`
 * (no React renderer, no provider). Calling the hook deep inside the view
 * would throw at test time. The page (which does mount under
 * `<TenantProvider/>`) reads the tenantId via the hook and threads it
 * down — pinned by `page.test.ts`.
 *
 * Anti-spec discipline:
 *   - The TenantTemplateSummary type is REUSED FROM the backend module;
 *     no parallel type definition (ADR 0009).
 *   - No new primitive — only the already-scaffolded shadcn pieces (Card,
 *     Skeleton, Badge) routed through `TemplatePicker`/`TemplateCard`.
 */
import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { TemplatePicker } from "./_components/TemplatePicker";

export type CampagnesViewProps = {
  /**
   * Current tenant — forwarded into `TemplatePicker` (and from there into
   * each `TemplateCard`'s `<a href>`). Threaded as a prop rather than
   * read via `useCurrentTenantId()` so the view stays a pure function
   * callable from the node-env unit test.
   */
  tenantId: Id<"tenants">;
  /**
   * Templates payload from
   * `useTenantQuery(api.lib.notifications.campaigns.listTenantTemplates)`.
   * Tri-state contract — see `TemplatePicker` for the per-branch render.
   */
  templates: TenantTemplateSummary[] | undefined;
};

export function CampagnesView({ tenantId, templates }: CampagnesViewProps) {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Campagnes</h1>
      </div>
      <div className="px-4 lg:px-6">
        <TemplatePicker tenantId={tenantId} templates={templates} />
      </div>
    </div>
  );
}
