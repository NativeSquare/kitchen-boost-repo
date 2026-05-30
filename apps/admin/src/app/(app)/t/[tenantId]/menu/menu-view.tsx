/**
 * F-MENU-01 (#187) — `MenuView`, pure presentational shell of the menu page
 * (read-only categories list, first tracer-bullet of EPIC F-MENU #149,
 * ADR 0015 « brouillon → publication globale atomique »).
 *
 * Three branches:
 *   - `categories === undefined` → loading skeletons (no blank flash, the
 *     shell + header stay mounted across loading → ready).
 *   - `categories.length === 0`  → empty state (« Aucune catégorie… »).
 *   - else                       → flat vertical list of category rows,
 *     sorted by `order` (no V1 sub-cats, ADR 0010 / PRD 10 §5).
 *
 * Header is ALWAYS rendered with the page title « Menu » and three INACTIVE
 * placeholders — « Aperçu », « Publier », « modifications non publiées » —
 * that F-MENU-10 (#254) will wire to the publication flow. They MUST stay
 * `disabled` here so a manager can't accidentally trigger a publish before
 * the mutation is bound (ADR 0015 forbids partial publication).
 *
 * Split out of `page.tsx` (which owns `useTenantQuery`) so vitest can pin
 * every branch under `environment: "node"` — same React-tree-serializer
 * pattern as `mes-clients/mes-clients-view.tsx`. The page hands `categories`
 * in as a prop; the view is a pure function of its props.
 *
 * Scope discipline (#187 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/`) is the ONLY surface touched
 * by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */
import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type MenuViewProps = {
  /**
   * Categories from `useTenantQuery(api.lib.menu.categories.list)`.
   *   - `undefined` → query in flight (Convex's loading sentinel)
   *   - `[]`        → tenant has no categories yet (fresh provisioning)
   *   - else        → list to render (sorted by `order`)
   */
  categories: Doc<"menuCategories">[] | undefined;
};

export function MenuView({ categories }: MenuViewProps) {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <MenuHeader />
      <div className="px-4 lg:px-6">
        <MenuBody categories={categories} />
      </div>
    </div>
  );
}

function MenuHeader() {
  // The three placeholders (« Aperçu » / « Publier » / badge) are pinned
  // INACTIVE — F-MENU-10 (#254) will activate them. Keeping them visible
  // (but disabled) lets the gérant see the affordance from day one without
  // letting them trigger a half-wired flow.
  return (
    <div className="flex flex-col gap-2 px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Menu</h1>
        <span
          className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs font-medium"
          data-slot="menu-unpublished-badge"
          aria-disabled="true"
        >
          modifications non publiées
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled
          data-slot="menu-preview-button"
        >
          Aperçu
        </Button>
        <Button type="button" disabled data-slot="menu-publish-button">
          Publier
        </Button>
      </div>
    </div>
  );
}

function MenuBody({ categories }: MenuViewProps) {
  if (categories === undefined) {
    return <CategoryListSkeleton />;
  }
  if (categories.length === 0) {
    return <CategoryListEmptyState />;
  }
  return <CategoryList categories={categories} />;
}

function CategoryList({ categories }: { categories: Doc<"menuCategories">[] }) {
  // Defensive resort by `order`: the backend already returns them sorted via
  // the `by_tenant_order` index, but the view stays correct even if that
  // contract regresses (cheap insurance — categories.length is small).
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  return (
    <div className="flex flex-col gap-2" data-slot="menu-category-list">
      {sorted.map((category) => (
        <Card key={category._id} data-slot="menu-category-row">
          <CardContent className="flex items-center justify-between py-4">
            <span className="text-base font-medium">{category.name}</span>
            <span className="text-muted-foreground text-xs tabular-nums">
              #{category.order + 1}
            </span>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CategoryListEmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-muted-foreground text-sm">
        Aucune catégorie pour le moment. La gestion CRUD arrivera dans une
        prochaine itération (F-MENU-02).
      </p>
    </div>
  );
}

function CategoryListSkeleton() {
  // 3 skeleton rows — same shape as `CategoryList` rows so the layout
  // doesn't shift when the real data lands. `animate-pulse` (from the
  // shadcn Skeleton primitive) is the user-visible "loading" affordance.
  return (
    <div
      className="flex flex-col gap-2"
      data-slot="menu-category-list-skeleton"
    >
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="flex items-center justify-between py-4">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-8" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
