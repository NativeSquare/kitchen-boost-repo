"use client";

/**
 * F-MENU-08 (#242) — `ModifierGroupsSection`, the « Gérer les
 * personnalisations » zone of the menu page (issue body « accessible depuis
 * (a) un lien/bouton dans une zone dédiée de la page menu listant tous les
 * groupes du tenant »).
 *
 * Three async sentinel branches (the same shape as the categories/items
 * sections — see `menu-view.tsx`):
 *   - `groups === undefined` → skeleton rows (no blank flash),
 *   - `groups === []`        → distinct empty state with a primary CTA,
 *   - else                   → one row per group (name, bounds summary,
 *     option count) + an edit affordance per row.
 *
 * Each row exposes a row-level edit button that fires `onEditGroup(group._id)`
 * — the page lifts that into the modal open state. There is NO delete here:
 * delete lives inside the modal (issue body « plus tard depuis la modale
 * item (F-MENU-09) »), so the gérant must open the group to drop it. That
 * keeps the row safe against fat-finger clicks AND surfaces the impact list
 * BEFORE the destructive action (the modal's confirmation panel).
 *
 * Reused from inside the menu page (`page.tsx`) — the « zone dédiée » sits
 * above or beside the categories list; we let `MenuView` decide layout in a
 * subsequent slice (today the page mounts both at top-level under the same
 * `<TenantProvider>`).
 *
 * Scope discipline (#242): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/` — zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import { IconChevronRight, IconPlus } from "@tabler/icons-react";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type ModifierGroupsSectionProps = {
  /**
   * REUSABLE modifier groups of the calling tenant.
   *   - `undefined` → query in flight (Convex's loading sentinel),
   *   - `[]`        → tenant has no group yet,
   *   - else        → list to render (the backend sorts by `_creationTime`
   *                   via the `by_tenant` index by default; the section is
   *                   defensively-tolerant of any order).
   */
  groups: Doc<"modifierGroups">[] | undefined;
  /** Open the create modal (no args — the new group is empty by default). */
  onCreateGroup: () => void;
  /** Open the edit modal pre-filled on the clicked group. */
  onEditGroup: (groupId: Id<"modifierGroups">) => void;
  /**
   * Delete is reachable from inside the edit modal (with impact list) — the
   * section does NOT expose a per-row delete button. The prop is kept here
   * so the page can pass through the page-level delete handler used by the
   * modal; the section itself does NOT call it directly.
   */
  onDeleteGroup: (groupId: Id<"modifierGroups">) => void;
};

export function ModifierGroupsSection({
  groups,
  onCreateGroup,
  onEditGroup,
  // Kept on the props interface for symmetry with the page-level wiring; the
  // section does NOT render a row-level delete (see head comment).
  onDeleteGroup: _onDeleteGroup,
}: ModifierGroupsSectionProps) {
  return (
    <section
      data-slot="menu-modifier-groups-section"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-base font-semibold">Personnalisations</h2>
          <p className="text-muted-foreground text-xs">
            Groupes d&apos;options réutilisables (sauces, suppléments, cuisson…)
            attachables à plusieurs items.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-slot="menu-modifier-group-add"
          onClick={onCreateGroup}
        >
          <IconPlus className="mr-2 size-4" aria-hidden="true" />
          Personnalisation
        </Button>
      </div>
      <ModifierGroupsBody groups={groups} onEditGroup={onEditGroup} />
    </section>
  );
}

function ModifierGroupsBody({
  groups,
  onEditGroup,
}: {
  groups: Doc<"modifierGroups">[] | undefined;
  onEditGroup: (groupId: Id<"modifierGroups">) => void;
}) {
  if (groups === undefined) {
    return <ModifierGroupsSkeleton />;
  }
  if (groups.length === 0) {
    return <ModifierGroupsEmptyState />;
  }
  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <ModifierGroupRow key={group._id} group={group} onEdit={onEditGroup} />
      ))}
    </div>
  );
}

function ModifierGroupRow({
  group,
  onEdit,
}: {
  group: Doc<"modifierGroups">;
  onEdit: (groupId: Id<"modifierGroups">) => void;
}) {
  const optionCount = group.options.length;
  return (
    <Card data-slot="menu-modifier-group-row">
      <CardContent className="flex items-center justify-between gap-3 py-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-base font-medium">{group.name}</span>
          <span className="text-muted-foreground text-xs">
            {summariseBounds(group.minSelect, group.maxSelect)} · {optionCount}{" "}
            option{optionCount > 1 ? "s" : ""}
          </span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-slot="menu-modifier-group-edit"
          data-group-id={group._id as unknown as string}
          onClick={() => onEdit(group._id)}
          aria-label={`Éditer le groupe ${group.name}`}
        >
          Éditer
          <IconChevronRight className="ml-1 size-4" aria-hidden="true" />
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * One-line human-readable summary of the bounds — the gérant sees at a glance
 * « obligatoire / optionnel », « choix unique / multi ». Derived from
 * `minSelect`/`maxSelect`, no extra config:
 *   - min=0, max=1   → « choix unique optionnel »
 *   - min=0, max=N>1 → « jusqu'à N (optionnel) »
 *   - min=1, max=1   → « choix unique obligatoire »
 *   - min=M, max=M   → « exactement M »
 *   - min=M, max=N>M → « entre M et N »
 */
function summariseBounds(minSelect: number, maxSelect: number): string {
  if (minSelect === 0 && maxSelect === 1) return "choix unique optionnel";
  if (minSelect === 0) return `jusqu'à ${maxSelect} (optionnel)`;
  if (minSelect === maxSelect && minSelect === 1)
    return "choix unique obligatoire";
  if (minSelect === maxSelect) return `exactement ${minSelect}`;
  return `entre ${minSelect} et ${maxSelect}`;
}

function ModifierGroupsEmptyState() {
  return (
    <div
      data-slot="menu-modifier-groups-empty"
      className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center"
    >
      <p className="text-muted-foreground text-sm">
        Aucune personnalisation pour le moment.
      </p>
      <p className="text-muted-foreground text-xs">
        Créez un groupe pour proposer sauces, suppléments ou cuisson à vos
        items.
      </p>
    </div>
  );
}

function ModifierGroupsSkeleton() {
  // 2 skeleton rows — same shape as a real row so the layout doesn't shift
  // when the real data lands. Matches the categories skeleton discipline.
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 2 }).map((_, index) => (
        <Card key={index} data-slot="menu-modifier-groups-skeleton">
          <CardContent className="flex items-center justify-between py-3">
            <div className="flex flex-col gap-1">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-3 w-44" />
            </div>
            <Skeleton className="h-6 w-16" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
