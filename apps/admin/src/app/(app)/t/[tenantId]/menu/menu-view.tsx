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
 * Header is ALWAYS rendered with the page title « Menu » and three
 * publication affordances — « Aperçu », « Publier », « modifications non
 * publiées ». F-MENU-10 (#254) activated them via four optional props
 * (`onPublish` / `publishLoading` / `previewHref` / `hasUnpublishedChanges`).
 * Each surface stays a disabled placeholder when its backing prop isn't
 * wired (keeps the slice-1 read-only callers and the disabled-baseline test
 * safe; preserves ADR 0015 « no partial publication before the mutation is
 * bound »):
 *   - Badge rendered iff `hasUnpublishedChanges === true` (ADR 0015 « disparaît
 *     après publication réussie » — Convex reactivity flips it automatically).
 *   - « Aperçu » renders as an anchor (target=_blank) iff `previewHref` is
 *     set, else stays a disabled `<Button>`. The link opens the DRAFT
 *     renderer (see `preview/page.tsx`) — the issue body's load-bearing
 *     observable « Aperçu montre le NOUVEAU prix avant publish ».
 *   - « Publier » enabled iff `onPublish` is wired AND `publishLoading` is
 *     falsy — a second click while in flight would fire the mutation twice.
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
import { cn } from "@/lib/utils";

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
  /**
   * F-MENU-05 (#219) — fired when the gérant clicks the « + Item » CTA in a
   * category section. The page opens the `ItemModal` in CREATE mode with the
   * originating category pre-selected.
   */
  onCreateItem?: (categoryId: Id<"menuCategories">) => void;
  /**
   * F-MENU-05 (#219) — fired when the gérant clicks an item card. The page
   * opens the `ItemModal` in EDIT mode pre-filled on the clicked item.
   */
  onItemClick?: (itemId: Id<"menuItems">) => void;
  /**
   * F-MENU-07 (#237) — persist a new full ordered ids list for ONE category
   * after a drag&drop. The backend `items.reorder` rejects partial payloads
   * (invariant pinned by `packages/backend/convex/lib/menu/items.test.ts`).
   * The drag NEVER crosses categories — each `ItemList` has its own
   * `SortableContext`. When omitted, the items stay read-only-ordering
   * (slice-4 contract preserved).
   */
  onReorderItems?: (
    categoryId: Id<"menuCategories">,
    orderedIds: Id<"menuItems">[],
  ) => void;
  /**
   * F-MENU-10 (#254) — fires when the gérant clicks « Publier ». The page
   * wires this to `useTenantMutation(api.lib.menu.publication.publishMenu)`
   * (ADR 0015 « édition brouillon → publication globale atomique »). When
   * omitted, the « Publier » button stays disabled (placeholder for slice 10).
   */
  onPublish?: () => void;
  /**
   * F-MENU-10 (#254) — true while a `publishMenu` round-trip is in flight.
   * Re-disables the « Publier » button so a second click can't fire the
   * mutation twice (double toasts + wasted round-trip; the backend is
   * idempotent at the snapshot level but the cost is real).
   */
  publishLoading?: boolean;
  /**
   * F-MENU-10 (#254) — destination URL of the « Aperçu » button. Opens the
   * DRAFT renderer (NOT the published snapshot — the issue body's load-bearing
   * observable). When omitted, the « Aperçu » button stays disabled
   * (placeholder for slice 10). Rendered as an anchor with
   * `target="_blank"` so the eater PWA view can sit side-by-side with the
   * editor.
   */
  previewHref?: string;
  /**
   * F-MENU-10 (#254) — drives the « modifications non publiées » badge
   * visibility. The page wires this to
   * `useTenantQuery(api.lib.menu.publication.hasUnpublishedChanges).hasChanges`
   * (ADR 0015 « indicateur "modifications non publiées" »). `true` → badge
   * visible; `false` or `undefined` → badge hidden. Disparaît après une
   * publication réussie via la réactivité Convex (la query ré-émet `false`).
   */
  hasUnpublishedChanges?: boolean;
};

export function MenuView({
  categories,
  onCreateCategory,
  onRenameCategory,
  onDeleteCategory,
  onReorderCategories,
  itemsByCategory,
  onToggleItemAvailability,
  onCreateItem,
  onItemClick,
  onReorderItems,
  onPublish,
  publishLoading,
  previewHref,
  hasUnpublishedChanges,
}: MenuViewProps) {
  const hasCrud =
    onCreateCategory !== undefined &&
    onRenameCategory !== undefined &&
    onDeleteCategory !== undefined;
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <MenuHeader
        onPublish={onPublish}
        publishLoading={publishLoading}
        previewHref={previewHref}
        hasUnpublishedChanges={hasUnpublishedChanges}
      />
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
          onCreateItem={onCreateItem}
          onItemClick={onItemClick}
          onReorderItems={onReorderItems}
        />
      </div>
    </div>
  );
}

function MenuHeader({
  onPublish,
  publishLoading,
  previewHref,
  hasUnpublishedChanges,
}: {
  onPublish?: () => void;
  publishLoading?: boolean;
  previewHref?: string;
  hasUnpublishedChanges?: boolean;
}) {
  // F-MENU-10 (#254) activated the three placeholders (« Aperçu » / « Publier »
  // / badge). Each surface stays a placeholder (disabled / hidden) when its
  // backing prop isn't wired — keeps the slice-1 read-only callers (and the
  // disabled-baseline test) safe.
  //
  //  - Badge: rendered ONLY when `hasUnpublishedChanges === true` (ADR 0015
  //    « disparaît après publication réussie » — Convex reactivity flips the
  //    flag automatically once `publishMenu` resolves).
  //  - « Aperçu »: rendered as an anchor (target=_blank) when `previewHref`
  //    is set, else as a disabled `<Button>` placeholder. The link opens the
  //    DRAFT renderer (see preview/page.tsx) — the issue body's load-bearing
  //    observable « Aperçu montre le NOUVEAU prix avant publish ».
  //  - « Publier »: enabled when `onPublish` is wired AND `publishLoading`
  //    is falsy — a second click while in flight would fire the mutation
  //    twice (double toasts + wasted round-trip).
  const previewEnabled = previewHref !== undefined;
  const publishEnabled = onPublish !== undefined && publishLoading !== true;
  return (
    <div className="flex flex-col gap-2 px-4 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Menu</h1>
        {hasUnpublishedChanges === true ? (
          <span
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900"
            data-slot="menu-unpublished-badge"
          >
            modifications non publiées
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        {previewEnabled ? (
          <Button
            asChild
            type="button"
            variant="outline"
            data-slot="menu-preview-button"
          >
            <a href={previewHref} target="_blank" rel="noopener noreferrer">
              Aperçu
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled
            data-slot="menu-preview-button"
          >
            Aperçu
          </Button>
        )}
        <Button
          type="button"
          disabled={!publishEnabled}
          onClick={publishEnabled ? onPublish : undefined}
          data-slot="menu-publish-button"
          className={cn(publishLoading === true ? "opacity-70" : undefined)}
        >
          {publishLoading === true ? "Publication…" : "Publier"}
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
  onCreateItem,
  onItemClick,
  onReorderItems,
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
            onCreateItem={onCreateItem}
            onItemClick={onItemClick}
            onReorderItems={onReorderItems}
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
 *
 * F-MENU-05 (#219) extension — when `onCreateItem` is wired, the section
 * footer carries a « + Item » CTA whose `onClick` forwards the originating
 * `categoryId`; when `onItemClick` is wired, each row's body becomes a
 * clickable « open edit modal » surface (the toggle stays its own click
 * target — see `item-list.tsx`).
 */
function CategoryItemsSection({
  category,
  items,
  onToggleItemAvailability,
  onCreateItem,
  onItemClick,
  onReorderItems,
}: {
  category: Doc<"menuCategories">;
  items: Doc<"menuItems">[] | undefined;
  onToggleItemAvailability: (
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) => void;
  onCreateItem?: (categoryId: Id<"menuCategories">) => void;
  onItemClick?: (itemId: Id<"menuItems">) => void;
  onReorderItems?: (
    categoryId: Id<"menuCategories">,
    orderedIds: Id<"menuItems">[],
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
      <ItemList
        items={items}
        onToggleAvailability={onToggleItemAvailability}
        onItemClick={onItemClick}
        categoryId={category._id}
        onReorder={onReorderItems}
      />
      {onCreateItem !== undefined ? (
        <div className="flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-slot="menu-item-add"
            data-category-id={category._id as unknown as string}
            onClick={() => onCreateItem(category._id)}
          >
            <IconPlus className="mr-2 size-4" aria-hidden="true" />
            Ajouter un item
          </Button>
        </div>
      ) : null}
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
