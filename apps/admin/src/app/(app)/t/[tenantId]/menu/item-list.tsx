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
 * Scope discipline (#211 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/` — zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { IconAlertCircle, IconPhoto } from "@tabler/icons-react";

import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import { formatPriceCentimes } from "./format-price";

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
};

export function ItemList({ items, onToggleAvailability }: ItemListProps) {
  if (items === undefined) return <ItemListSkeleton />;
  if (items.length === 0) return <ItemListEmptyState />;
  // Defensive resort — same insurance as `CategoryList` (the backend already
  // returns them sorted via the `by_category` index, but we resort cheaply
  // so a backend regression doesn't break the visible order).
  const sorted = [...items].sort((a, b) => a.order - b.order);
  return (
    <div className="flex flex-col gap-2" data-slot="menu-item-list">
      {sorted.map((item) => (
        <ItemRow
          key={item._id}
          item={item}
          onToggleAvailability={onToggleAvailability}
        />
      ))}
    </div>
  );
}

type ItemRowProps = {
  item: Doc<"menuItems">;
  onToggleAvailability: (
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) => void;
};

function ItemRow({ item, onToggleAvailability }: ItemRowProps) {
  return (
    <Card data-slot="menu-item-row">
      <CardContent className="flex items-center gap-3 py-3">
        <ItemThumbnail item={item} />
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
 * Memoised builder used by the page to bucket the flat `items.list` array
 * into a `Record<categoryId, items[]>` for the per-category lists. Exposed
 * here so the page's wiring layer stays thin and the bucketing logic is
 * pinned in one place. Pure function — no React, no Convex.
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

// Mark `useMemo` as referenced (lint defense — kept exported for future
// internal use if the bucketing moves on-component).
void useMemo;
