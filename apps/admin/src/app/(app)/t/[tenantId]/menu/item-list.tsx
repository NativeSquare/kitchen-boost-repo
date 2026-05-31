"use client";

/**
 * F-MENU-04 (#211) — `ItemList`, the pure presentational list of items UNDER
 * a single category (one « card » per item with name, price TTC, thumbnail
 * SLOT, and the load-bearing INLINE rupture toggle).
 *
 * Three branches mirror slice 1's `CategoryList` discipline:
 *   - `items === undefined` → loading skeletons (the category exists but its
 *     items haven't landed yet — Convex's loading sentinel for a `useQuery`).
 *   - `items.length === 0`  → empty state (« Aucun item dans cette
 *     catégorie ») — the gérant sees the slot is empty without losing the
 *     category context.
 *   - else                  → flat vertical list of cards, sorted by `order`.
 *
 * The rupture toggle is the load-bearing « 1-tap out of stock » staff
 * affordance (story body + CONTEXT « Item out of stock »): it MUST live on
 * the card itself (not behind an « edit item » modal), it MUST fire the
 * mutation directly (not through publishMenu — ADR 0015 § Conséquences:
 * « toggle live indépendant de la publication »), and the optimistic UI is
 * provided by Convex's natural reactivity: the toggle's `checked` mirrors
 * `item.available`, so a successful round-trip is silent and a server reject
 * snaps it back automatically (no manual state).
 *
 * Photo thumbnail: the card carries a `data-slot="menu-item-thumbnail"`
 * SLOT that is ALWAYS rendered (placeholder when no `photoStorageId`) so the
 * row layout stays stable across items with/without photos — a list the
 * gérant scans must not jiggle on every upload. When a `photoStorageId` is
 * present, we resolve it to a URL via the existing template
 * `api.storage.getImageUrl` query (an ungated query — storage ids are
 * unguessable UUIDs; the gating happens at upload time through the
 * `kb_manager` `generateUploadUrl` wrapper). If the URL hasn't landed yet
 * (Convex loading) or the storage id is dangling, we fall back to the
 * placeholder — the slot still occupies the same box.
 *
 * F-MENU-07 (#237) — Drag & drop reorder of items WITHIN one category.
 * When the page wires `onReorder(categoryId, orderedIds)` (bound to
 * `useTenantMutation(api.lib.menu.items.reorder)`), each row carries a
 * `data-slot="menu-item-drag-handle"` button on its left edge, the list is
 * wrapped in a `DndContext` + `SortableContext` so items can be sorted by
 * mouse, touch and keyboard (`KeyboardSensor` listens on the handle). The
 * drag NEVER crosses categories: each `ItemList` owns its OWN
 * `SortableContext`, dnd-kit cannot drop a draggable into a foreign
 * context. Recategoriser passes through the F-MENU-05 item modal's
 * `categoryId` picker (issue body « Le drag NE traverse PAS les catégories »).
 *
 * Optimistic UI: same shape as `CategoryListEditor` (#206) — the displayed
 * id order lives in local state, drag-end re-paints it BEFORE the mutation
 * resolves. The « React canonical reset state on prop change » pattern
 * resyncs from the server `items` prop:
 *   - Success: Convex re-fires `items.list`, server order === optimistic
 *     guess → no visible change.
 *   - Rollback: the mutation rejected, server order is the OLD one → snap
 *     back; the page-level handler surfaces `toast.error`.
 *
 * The reorder callback receives the COMPLETE ordered ids list of THIS
 * category — the backend `items.reorder` rejects any payload that isn't the
 * full set (invariant pinned by
 * `packages/backend/convex/lib/menu/items.test.ts`, mirror of `categories.reorder`).
 *
 * Scope discipline (#211 / #237 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/` — zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  IconAlertCircle,
  IconGripVertical,
  IconPhoto,
} from "@tabler/icons-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import { formatPriceCentimes } from "./format-price";
import { reorderById } from "./reorder-utils";

export type ItemListProps = {
  /**
   * Items from `useTenantQuery(api.lib.menu.items.list)` filtered to one
   * category by the page.
   *   - `undefined` → query in flight
   *   - `[]`        → category has no items yet
   *   - else        → list to render (sorted defensively by `order`)
   */
  items: Doc<"menuItems">[] | undefined;
  /**
   * Fired when the gérant flips the rupture toggle on a card. The page
   * wires this to `useTenantMutation(api.lib.menu.availability.setItemAvailability)`
   * — see `page.tsx`. Called with the NEW (toggled) value so the page can
   * forward it as-is to the mutation.
   */
  onToggleAvailability: (
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) => void;
  /**
   * F-MENU-05 (#219) — fired when the gérant clicks the card body (anywhere
   * outside the rupture toggle). The page wires this to open the
   * `ItemModal` in EDIT mode pre-filled on this item. When omitted, the
   * card stays read-only — preserves the F-MENU-04 slice contract.
   */
  onItemClick?: (itemId: Id<"menuItems">) => void;
  /**
   * F-MENU-07 (#237) — the `categoryId` of THIS list. Used as a closure for
   * the reorder callback so the page receives `{ categoryId, orderedIds }`
   * straight, without having to recompute the category from the items
   * (defensive — the items might be empty when this prop is unused, and the
   * id is the natural identity of this section). Only consumed when
   * `onReorder` is wired.
   */
  categoryId?: Id<"menuCategories">;
  /**
   * F-MENU-07 (#237) — persist a new full ordered ids list (for THIS
   * category) after a drag&drop. The COMPLETE list is sent (backend
   * `items.reorder` rejects partial payloads — invariant pinned by
   * `packages/backend/convex/lib/menu/items.test.ts`). When omitted, the
   * editor renders without drag handles (read-only ordering — preserves
   * the F-MENU-04 slice contract).
   */
  onReorder?: (
    categoryId: Id<"menuCategories">,
    orderedIds: Id<"menuItems">[],
  ) => void;
};

export function ItemList({
  items,
  onToggleAvailability,
  onItemClick,
  categoryId,
  onReorder,
}: ItemListProps) {
  if (items === undefined) return <ItemListSkeleton />;
  if (items.length === 0) return <ItemListEmptyState />;
  // Defensive resort — same insurance as `CategoryList` (the backend already
  // returns them sorted via the `by_category` index, but we resort cheaply
  // so a backend regression doesn't break the visible order).
  const sorted = [...items].sort((a, b) => a.order - b.order);
  // F-MENU-07 (#237) — drag&drop is only active when BOTH the categoryId
  // (closure for the callback) AND the onReorder handler are wired. Either
  // missing → fall back to the read-only render path (preserves slice-4
  // contract: a page that only wires `onToggleAvailability` keeps working).
  const sortable = onReorder !== undefined && categoryId !== undefined;
  if (!sortable) {
    return (
      <div className="flex flex-col gap-2" data-slot="menu-item-list">
        {sorted.map((item) => (
          <ItemRow
            key={item._id}
            item={item}
            onToggleAvailability={onToggleAvailability}
            onItemClick={onItemClick}
          />
        ))}
      </div>
    );
  }
  return (
    <SortableItemList
      sorted={sorted}
      categoryId={categoryId}
      onReorder={onReorder}
      onToggleAvailability={onToggleAvailability}
      onItemClick={onItemClick}
    />
  );
}

/**
 * F-MENU-07 (#237) — Wraps the sortable branch so the hooks (`useState`,
 * `useMemo`, `useSensors`) live INSIDE the conditional render, not at the
 * `ItemList` top level (the read-only branch must stay hook-free for the
 * node-env tests that don't shim React). Same shape as
 * `CategoryListEditor`'s sortable branch.
 */
function SortableItemList({
  sorted,
  categoryId,
  onReorder,
  onToggleAvailability,
  onItemClick,
}: {
  sorted: Doc<"menuItems">[];
  categoryId: Id<"menuCategories">;
  onReorder: (
    categoryId: Id<"menuCategories">,
    orderedIds: Id<"menuItems">[],
  ) => void;
  onToggleAvailability: (
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) => void;
  onItemClick?: (itemId: Id<"menuItems">) => void;
}) {
  // Optimistic UI — same canonical « reset-state-on-prop-change » pattern as
  // `CategoryListEditor`: the displayed order is local state we override on
  // drag-end BEFORE the mutation resolves; we resync to the server order
  // when the `sorted` reference changes (success: identical; rollback: snap
  // back).
  const [displayedIds, setDisplayedIds] = useState<Id<"menuItems">[]>(() =>
    sorted.map((i) => i._id),
  );
  const [prevSorted, setPrevSorted] = useState(sorted);
  if (sorted !== prevSorted) {
    setPrevSorted(sorted);
    setDisplayedIds(sorted.map((i) => i._id));
  }

  const byId = useMemo(() => {
    const map = new Map<Id<"menuItems">, Doc<"menuItems">>();
    for (const i of sorted) map.set(i._id, i);
    return map;
  }, [sorted]);

  const displayed = useMemo<Doc<"menuItems">[]>(() => {
    const ordered: Doc<"menuItems">[] = [];
    for (const id of displayedIds) {
      const i = byId.get(id);
      if (i !== undefined) ordered.push(i);
    }
    if (ordered.length !== sorted.length) {
      const seen = new Set(ordered.map((i) => i._id));
      for (const i of sorted) {
        if (!seen.has(i._id)) ordered.push(i);
      }
    }
    return ordered;
  }, [displayedIds, byId, sorted]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      // A small distance threshold avoids accidental drags when the user
      // just wants to click the rupture toggle or the card body (the
      // F-MENU-05 « click-on-card opens modal » surface).
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const activeId = active.id as Id<"menuItems">;
    const overId = over.id as Id<"menuItems">;
    const nextIds = reorderById(displayedIds, activeId, overId);
    // Optimistic: paint the new order before the round-trip resolves.
    setDisplayedIds(nextIds);
    onReorder(categoryId, nextIds);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={displayedIds}
        strategy={verticalListSortingStrategy}
      >
        <div className="flex flex-col gap-2" data-slot="menu-item-list">
          {displayed.map((item) => (
            <SortableItemRow
              key={item._id}
              item={item}
              onToggleAvailability={onToggleAvailability}
              onItemClick={onItemClick}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

type ItemRowProps = {
  item: Doc<"menuItems">;
  onToggleAvailability: (
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) => void;
  onItemClick?: (itemId: Id<"menuItems">) => void;
  /** F-MENU-07 (#237) — optional drag-handle slot rendered as the first row cell. */
  dragHandle?: React.ReactNode;
  /** F-MENU-07 (#237) — outer style applied by dnd-kit's transform (translate / transition). */
  style?: React.CSSProperties;
  /** F-MENU-07 (#237) — set-node-ref from `useSortable`, attached to the outer Card. */
  setNodeRef?: (node: HTMLElement | null) => void;
};

function ItemRow({
  item,
  onToggleAvailability,
  onItemClick,
  dragHandle,
  style,
  setNodeRef,
}: ItemRowProps) {
  // F-MENU-05 (#219) — when the page wires `onItemClick`, the card body
  // (thumbnail + name + price) becomes a clickable « open edit modal »
  // surface. The Switch toggle keeps its OWN click handler and we stop the
  // event from propagating to the card click — a 1-tap rupture must NEVER
  // also open the edit modal (bad UX, possibly conflicting writes).
  return (
    <Card data-slot="menu-item-row" ref={setNodeRef} style={style}>
      <CardContent className="flex items-center gap-3 py-3">
        {dragHandle}
        {onItemClick !== undefined ? (
          <button
            type="button"
            data-slot="menu-item-card-clickable"
            onClick={() => onItemClick(item._id)}
            aria-label={`Modifier ${item.name}`}
            className="-m-1 flex flex-1 cursor-pointer items-center gap-3 rounded-md p-1 text-left outline-none focus-visible:ring-2"
          >
            <ItemThumbnail item={item} />
            <ItemRowBody item={item} />
          </button>
        ) : (
          <>
            <ItemThumbnail item={item} />
            <ItemRowBody item={item} />
          </>
        )}
        <Switch
          data-slot="menu-item-availability-toggle"
          checked={item.available}
          onCheckedChange={(next) => onToggleAvailability(item._id, next)}
          aria-label={`Disponibilité de ${item.name}`}
        />
      </CardContent>
    </Card>
  );
}

/**
 * F-MENU-07 (#237) — Sortable wrapper around `ItemRow`. Mirror of
 * `SortableCategoryRow` in `category-list-editor.tsx`. Builds the drag
 * handle (a small grip icon button with an `aria-label` so screen readers
 * announce « Réordonner l'item X »), wires `useSortable` to get the
 * transform + listeners, and forwards both into the row.
 *
 * The handle (not the whole row) is the drag activator — keeps the
 * rupture toggle and the click-to-edit surface usable without triggering a
 * drag. The handle also serves as the keyboard sortable affordance
 * (`KeyboardSensor` listens on it) — pressing space-bar focused on the
 * handle starts sorting, arrow keys move the row, space-bar drops it. That
 * covers the « clavier obligatoire » AC (apps/admin is a pro tool, used
 * all day).
 */
type SortableItemRowProps = Pick<
  ItemRowProps,
  "item" | "onToggleAvailability" | "onItemClick"
>;

function SortableItemRow({
  item,
  onToggleAvailability,
  onItemClick,
}: SortableItemRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item._id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const handle = (
    <button
      type="button"
      data-slot="menu-item-drag-handle"
      aria-label={`Réordonner l'item ${item.name}`}
      className="text-muted-foreground hover:text-foreground -ml-1 cursor-grab touch-none rounded p-1 outline-none focus-visible:ring-2 active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <IconGripVertical className="size-4" aria-hidden="true" />
    </button>
  );
  return (
    <ItemRow
      item={item}
      onToggleAvailability={onToggleAvailability}
      onItemClick={onItemClick}
      dragHandle={handle}
      style={style}
      setNodeRef={setNodeRef}
    />
  );
}

function ItemRowBody({ item }: { item: Doc<"menuItems"> }) {
  return (
    <div className="flex flex-1 flex-col gap-0.5">
      <div className="flex items-center gap-2">
        <span className="text-base font-medium">{item.name}</span>
        {item.available ? null : (
          <Badge
            variant="secondary"
            data-slot="menu-item-rupture-badge"
            className="bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-100"
          >
            <IconAlertCircle className="mr-1 size-3" aria-hidden="true" />
            Rupture
          </Badge>
        )}
      </div>
      <span className="text-muted-foreground text-sm tabular-nums">
        {formatPriceCentimes(item.basePrice)}
      </span>
    </div>
  );
}

/**
 * Thumbnail SLOT — always rendered. When `item.photoStorageId` is present we
 * resolve the URL via `useQuery(api.storage.getImageUrl, ...)` (the existing
 * ungated template query — storage ids are unguessable; the kb_manager gating
 * happens at upload time via `generateUploadUrl`). While the URL is in flight
 * (Convex `undefined`) or absent (no photo / dangling id), we render a
 * placeholder so the row layout stays stable.
 */
function ItemThumbnail({ item }: { item: Doc<"menuItems"> }) {
  // `"skip"` lets Convex bypass the query entirely when there's no storage
  // id — we don't pay the round-trip for photoless items.
  const url = useQuery(
    api.storage.getImageUrl,
    item.photoStorageId === undefined
      ? "skip"
      : { storageId: item.photoStorageId },
  );
  const hasResolvedUrl = typeof url === "string" && url.length > 0;
  return (
    <div
      data-slot="menu-item-thumbnail"
      className="bg-muted text-muted-foreground flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md"
    >
      {hasResolvedUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt={`Photo de ${item.name}`}
          className="size-full object-cover"
        />
      ) : (
        <IconPhoto className="size-5" aria-hidden="true" />
      )}
    </div>
  );
}

function ItemListEmptyState() {
  return (
    <div
      className="rounded-md border border-dashed p-4 text-center"
      data-slot="menu-item-list-empty"
    >
      <p className="text-muted-foreground text-sm">
        Aucun item dans cette catégorie.
      </p>
    </div>
  );
}

function ItemListSkeleton() {
  // 2 skeleton rows — same shape as `ItemRow` so the layout doesn't shift
  // when the real items land. `animate-pulse` (from the shadcn Skeleton
  // primitive) is the user-visible "loading" affordance.
  return (
    <div className="flex flex-col gap-2" data-slot="menu-item-list-skeleton">
      {Array.from({ length: 2 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="flex items-center gap-3 py-3">
            <Skeleton className="size-12 shrink-0 rounded-md" />
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="h-5 w-8 rounded-full" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Pure builder used by the page to bucket the flat `items.list` array into
 * a `Record<categoryId, items[]>` for the per-category lists. Exposed here
 * so the page's wiring layer stays thin and the bucketing logic is pinned
 * in one place. Pure function — no React, no Convex.
 */
export function bucketItemsByCategory(
  items: Doc<"menuItems">[] | undefined,
): Record<string, Doc<"menuItems">[]> | undefined {
  if (items === undefined) return undefined;
  const out: Record<string, Doc<"menuItems">[]> = {};
  for (const item of items) {
    const key = item.categoryId as unknown as string;
    if (out[key] === undefined) out[key] = [];
    out[key].push(item);
  }
  return out;
}
