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
import type { ReactNode } from "react";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import { IconPlus } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { CategoryListEditor } from "./category-list-editor";

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
  /**
   * Refonte tabs Menu (Alex, 2026-06-03) — currently active tab. The page
   * persists this in the URL via `?tab=<id>` (`useSearchParams` +
   * `useRouter().replace()`), so a hard reload + bookmark restore the
   * gérant's tab. Defaults to `"items"` page-side when no param is set —
   * it's the tab the gérant uses every day (rupture toggles, item edits).
   */
  currentTab?: MenuTab;
  /**
   * Refonte tabs Menu — fires when the gérant clicks a tab trigger. The page
   * wires this to a `useRouter().replace(?tab=<next>)` to persist it.
   */
  onTabChange?: (next: MenuTab) => void;
  /**
   * Refonte tabs Menu — content of the « Personnalisations » tab. The page
   * passes the `<ModifierGroupsSection ... />` instance (with all its CRUD
   * callbacks) here so the view doesn't have to know about the modifier-group
   * data model. When omitted, the tab renders an empty branch (placeholder).
   */
  modifiersSection?: ReactNode;
};

/** Refonte tabs Menu (Alex, 2026-06-03) — the three tabs of the menu page. */
export type MenuTab = "categories" | "items" | "modifiers";

export const MENU_TABS = ["categories", "items", "modifiers"] as const;

/** Default tab when no `?tab` query param is set (the daily-use surface). */
export const DEFAULT_MENU_TAB: MenuTab = "items";

/**
 * Normalise a raw `?tab` search param value to a known `MenuTab`. Unknown or
 * missing values fall back to `DEFAULT_MENU_TAB` so a malformed URL never
 * locks the gérant out of the page. Exported so the page wiring + the
 * page-side wiring test can share the same normalisation.
 */
export function parseMenuTabParam(raw: string | null | undefined): MenuTab {
  if (raw === "categories" || raw === "items" || raw === "modifiers") {
    return raw;
  }
  return DEFAULT_MENU_TAB;
}

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
  currentTab,
  onTabChange,
  modifiersSection,
}: MenuViewProps) {
  const hasCrud =
    onCreateCategory !== undefined &&
    onRenameCategory !== undefined &&
    onDeleteCategory !== undefined;
  // Refonte tabs Menu (2026-06-03) — the page persists the active tab in the
  // URL via `?tab=...` (`useSearchParams` + `useRouter().replace()`). When the
  // page hasn't wired the tabs yet (read-only baseline / older callers), we
  // fall back to the default tab so the body never renders blank.
  const activeTab: MenuTab = currentTab ?? DEFAULT_MENU_TAB;
  const handleTabChange = (next: string) => {
    if (onTabChange === undefined) return;
    onTabChange(parseMenuTabParam(next));
  };
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <MenuHeader
        onPublish={onPublish}
        publishLoading={publishLoading}
        previewHref={previewHref}
        hasUnpublishedChanges={hasUnpublishedChanges}
      />
      <div className="px-4 lg:px-6">
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList data-slot="menu-tabs-list">
            <TabsTrigger
              value="categories"
              data-slot="menu-tab-trigger-categories"
            >
              Catégories
            </TabsTrigger>
            <TabsTrigger value="items" data-slot="menu-tab-trigger-items">
              Plats
            </TabsTrigger>
            <TabsTrigger
              value="modifiers"
              data-slot="menu-tab-trigger-modifiers"
            >
              Personnalisations
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="categories"
            data-slot="menu-tab-content-categories"
          >
            <MenuBody
              displayMode="list-only"
              categories={categories}
              hasCrud={hasCrud}
              onCreateCategory={onCreateCategory}
              onRenameCategory={onRenameCategory}
              onDeleteCategory={onDeleteCategory}
              onReorderCategories={onReorderCategories}
            />
          </TabsContent>
          <TabsContent value="items" data-slot="menu-tab-content-items">
            <MenuBody
              displayMode="items-only"
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
          </TabsContent>
          <TabsContent value="modifiers" data-slot="menu-tab-content-modifiers">
            {modifiersSection}
          </TabsContent>
        </Tabs>
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

type MenuBodyProps = Omit<MenuViewProps, "currentTab" | "onTabChange"> & {
  hasCrud: boolean;
  /**
   * Refonte tabs Menu (2026-06-03) + Alex fix M-B — body display mode, mirror
   * of `CategoryListEditor.displayMode`. Rendered once per tab content.
   *   - `"list-only"` (Tab « Catégories »): structural spine only, headers
   *     EDITABLE (Input + delete + drag handle on category).
   *   - `"items-only"` (Tab « Plats »): READ-ONLY uppercase category headers
   *     + per-category items list + « + Item » CTA. Category mutation
   *     surfaces (rename / delete / reorder) stay exclusive to the
   *     « Catégories » tab — single source of truth for the spine.
   */
  displayMode: "list-only" | "items-only";
};

function MenuBody({
  categories,
  hasCrud,
  displayMode,
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
  if (
    hasCrud &&
    onCreateCategory !== undefined &&
    onRenameCategory !== undefined &&
    onDeleteCategory !== undefined
  ) {
    return (
      <CategoryListEditor
        categories={categories}
        onCreate={onCreateCategory}
        onRename={onRenameCategory}
        onDelete={onDeleteCategory}
        onReorder={onReorderCategories}
        displayMode={displayMode}
        itemsByCategory={
          displayMode === "items-only" ? itemsByCategory : undefined
        }
        onToggleItemAvailability={
          displayMode === "items-only" ? onToggleItemAvailability : undefined
        }
        onCreateItem={displayMode === "items-only" ? onCreateItem : undefined}
        onItemClick={displayMode === "items-only" ? onItemClick : undefined}
        onReorderItems={
          displayMode === "items-only" ? onReorderItems : undefined
        }
      />
    );
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
