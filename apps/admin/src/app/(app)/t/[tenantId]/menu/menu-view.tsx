/**
 * F-MENU-01 (#187) + F-MENU-02 (#200) — `MenuView`, the presentational
 * shell of the menu page (read OR edit), first tracer-bullet of EPIC
 * F-MENU #149 (Édition menu, ADR 0015 « brouillon → publication globale
 * atomique »).
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
 * F-MENU-02 (#200) layering: the view stays a pure function of its props,
 * but accepts THREE optional callbacks (`onCreateCategory` / `onRenameCategory`
 * / `onDeleteCategory`). When ALL three are provided, the populated branch
 * renders the interactive `CategoryListEditor` (« + Catégorie », inline
 * rename w/ debounce, delete w/ confirmation); when they're not, the
 * slice-1 read-only `CategoryList` is rendered (preserves the slice-1
 * contract — `MenuView({ categories })` keeps working). The empty branch
 * surfaces a « + Catégorie » CTA too when callbacks are wired, else the
 * gérant has no path to bootstrap an empty menu.
 *
 * Split out of `page.tsx` (which owns `useTenantQuery` / `useTenantMutation`)
 * so vitest can pin every branch under `environment: "node"` — same
 * React-tree-serializer pattern as `mes-clients/mes-clients-view.tsx`.
 *
 * Scope discipline (#187 / #200 hard constraint): this file (and its
 * siblings under `apps/admin/src/app/(app)/t/[tenantId]/menu/`) is the ONLY
 * surface touched by these stories. Zero touch to `apps/web`, `apps/native`,
 * or `packages/backend/convex/`.
 */
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import { IconPlus } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { CategoryListEditor } from "./category-list-editor";
import { ItemList } from "./item-list";

export type MenuViewProps = {
  /**
   * Categories from `useTenantQuery(api.lib.menu.categories.list)`.
   *   - `undefined` → query in flight (Convex's loading sentinel)
   *   - `[]`        → tenant has no categories yet (fresh provisioning)
   *   - else        → list to render (sorted by `order`)
   */
  categories: Doc<"menuCategories">[] | undefined;
  /** F-MENU-02 (#200) — append a fresh empty category at the end. */
  onCreateCategory?: () => void;
  /** F-MENU-02 (#200) — commit an inline rename (debounced). */
  onRenameCategory?: (categoryId: Id<"menuCategories">, name: string) => void;
  /** F-MENU-02 (#200) — drop a category (the editor gates this behind a confirmation dialog). */
  onDeleteCategory?: (categoryId: Id<"menuCategories">) => void;
  /**
   * F-MENU-03 (#206) — persist a new full ordered ids list after a drag&drop
   * (the backend `categories.reorder` rejects partial payloads — invariant
   * pinned by `packages/backend/convex/lib/menu/categories.test.ts`).
   */
  onReorderCategories?: (orderedIds: Id<"menuCategories">[]) => void;
  /**
   * F-MENU-04 (#211) — items bucketed by their `categoryId`.
   *   - `undefined` (the WHOLE map) → items query still in flight at page
   *     level; each `ItemList` renders skeletons.
   *   - present but a category key MISSING → that category has zero items;
   *     the `ItemList` will render its empty branch.
   *
   * Bucketing happens in the page (see `bucketItemsByCategory`) so this
   * view stays a pure function of its props and the page owns the Convex
   * call.
   */
  itemsByCategory?: Record<string, Doc<"menuItems">[]> | undefined;
  /**
   * F-MENU-04 (#211) — fired when the gérant flips the rupture toggle on a
   * card. The page wires this to `useTenantMutation(
   * api.lib.menu.availability.setItemAvailability)`. The toggle calls back
   * with the NEW (toggled) value so the page can forward it as-is.
   */
  onToggleItemAvailability?: (
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) => void;
};

export function MenuView({
  categories,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onReorderCategories,
  itemsByCategory,
  onToggleItemAvailability,
}: MenuViewProps) {
  const hasCrud =
    onCreateCategory !== undefined &&
    onRenameCategory !== undefined &&
    onDeleteCategory !== undefined;
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <MenuHeader />
      <div className="px-4 lg:px-6">
        <MenuBody
          categories={categories}
          hasCrud={hasCrud}
          onCreateCategory={onCreateCategory}
          onRenameCategory={onRenameCategory}
          onDeleteCategory={onDeleteCategory}
          onReorderCategories={onReorderCategories}
          itemsByCategory={itemsByCategory}
          onToggleItemAvailability={onToggleItemAvailability}
        />
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

type MenuBodyProps = MenuViewProps & { hasCrud: boolean };

function MenuBody({
  categories,
  hasCrud,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onReorderCategories,
  itemsByCategory,
  onToggleItemAvailability,
}: MenuBodyProps) {
  if (categories === undefined) {
    return <CategoryListSkeleton />;
  }
  if (categories.length === 0) {
    return (
      <CategoryListEmptyState
        onCreateCategory={hasCrud ? onCreateCategory : undefined}
      />
    );
  }
  // F-MENU-04 (#211) — only render the per-category items sections when the
  // page wires BOTH `itemsByCategory` (the bucketed map) AND
  // `onToggleItemAvailability` (the live mutation handler). Without the
  // handler we would render a toggle the gérant could click that wouldn't
  // do anything — bad UX, worse safety (ADR 0015: the toggle MUST fire the
  // live mutation, never silently no-op).
  const showItemsSections =
    onToggleItemAvailability !== undefined && itemsByCategory !== undefined;
  const categoriesNode =
    hasCrud &&
    onCreateCategory !== undefined &&
    onRenameCategory !== undefined &&
    onDeleteCategory !== undefined ? (
      <CategoryListEditor
        categories={categories}
        onCreate={onCreateCategory}
        onRename={onRenameCategory}
        onDelete={onDeleteCategory}
        onReorder={onReorderCategories}
      />
    ) : (
      <CategoryList categories={categories} />
    );
  if (!showItemsSections) return categoriesNode;
  // Defensive resort by `order` — same insurance as `CategoryList` (the
  // backend returns them sorted via `by_tenant_order`; cheap to repeat).
  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
  return (
    <div className="flex flex-col gap-6">
      {categoriesNode}
      <div
        className="flex flex-col gap-6"
        data-slot="menu-categories-items-sections"
      >
        {sortedCategories.map((category) => (
          <CategoryItemsSection
            key={category._id}
            category={category}
            items={itemsByCategory[category._id as unknown as string]}
            onToggleItemAvailability={onToggleItemAvailability}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * F-MENU-04 (#211) — One « section » per category: the category name as the
 * section heading, followed by the per-category `ItemList`. The categories
 * editor above still owns CRUD + drag&drop; THIS block surfaces the items
 * each category contains (with the inline rupture toggle, the load-bearing
 * staff affordance — story body).
 */
function CategoryItemsSection({
  category,
  items,
  onToggleItemAvailability,
}: {
  category: Doc<"menuCategories">;
  items: Doc<"menuItems">[] | undefined;
  onToggleItemAvailability: (
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) => void;
}) {
  return (
    <section
      data-slot="menu-category-items-section"
      data-category-id={category._id as unknown as string}
      className="flex flex-col gap-2"
    >
      <h2 className="text-sm font-semibold tracking-wide uppercase">
        {category.name}
      </h2>
      <ItemList items={items} onToggleAvailability={onToggleItemAvailability} />
    </section>
  );
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

function CategoryListEmptyState({
  onCreateCategory,
}: {
  onCreateCategory?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed p-8 text-center">
      <p className="text-muted-foreground text-sm">
        Aucune catégorie pour le moment.
      </p>
      {onCreateCategory !== undefined ? (
        <Button
          type="button"
          variant="outline"
          onClick={onCreateCategory}
          data-slot="menu-category-add"
        >
          <IconPlus className="mr-2 size-4" aria-hidden="true" />
          Ajouter une catégorie
        </Button>
      ) : null}
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
