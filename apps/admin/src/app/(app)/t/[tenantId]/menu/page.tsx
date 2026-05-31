"use client";

/**
 * F-MENU-01 (#187) + F-MENU-02 (#200) + F-MENU-03 (#206) + F-MENU-04 (#211)
 * + F-MENU-05 (#219) — Route `/t/[tenantId]/menu/`.
 *
 * Slice 1 (#187) wired the read-only categories list via `useTenantQuery`.
 * Slice 2 (#200) layered category CRUD on top via `useTenantMutation`. Slice 3
 * (#206) wired drag&drop reorder on categories. Slice 4 (#211) wired the
 * per-category items list + the LIVE rupture toggle (`availability.setItemAvailability`,
 * direct mutation that bypasses publication — ADR 0015 § Conséquences). Slice 5
 * (#219) layers item CRUD on top: the `ItemModal` opens in CREATE mode via
 * « + Item » per category, or in EDIT mode via click-on-card; both surface
 * the four V1 schema fields (name, description, basePrice, allergens) plus a
 * recategorisation picker (`categoryId` on `items.update`). The page binds
 * `items.create` / `items.update` / `items.remove` via `useTenantMutation`
 * (ADR 0014 §4 / #183), wraps each call in a try/catch that surfaces backend
 * `ConvexError`s as `toast.error(...)` with the server-provided message
 * (« validation locale + INVALID_PRICE côté backend » — the « message clair »
 * derives from the ConvexError data). Slice 10 (#254) will activate the
 * « Aperçu » / « Publier » header buttons.
 *
 * Modal state lives at the page level (not inside `MenuView`) so the modal
 * survives reactive re-renders of the categories/items lists (a successful
 * autosave round-trip refires `items.list`, which would otherwise unmount
 * the modal if it lived inside the row).
 *
 * Scope discipline (#219 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/`) is the ONLY surface touched
 * by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import { useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { useTenantMutation, useTenantQuery } from "@/hooks";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import { bucketItemsByCategory } from "./item-list";
import {
  ItemModal,
  type ItemCreatePayload,
  type ItemUpdatePatch,
} from "./item-modal";
import { MenuView } from "./menu-view";

/** Placeholder name for a freshly-created category — the gérant renames it inline. */
const DEFAULT_NEW_CATEGORY_NAME = "Nouvelle catégorie";

/**
 * Page-level modal state. Three branches:
 *  - `null`                              → modal closed.
 *  - `{ kind: "create", categoryId }`    → create modal opened from the
 *    « + Item » CTA of that category.
 *  - `{ kind: "edit", itemId }`          → edit modal opened by a click on
 *    that item's card.
 */
type ItemModalState =
  | null
  | { kind: "create"; categoryId: Id<"menuCategories"> }
  | { kind: "edit"; itemId: Id<"menuItems"> };

export default function MenuPage() {
  // `useTenantQuery` / `useTenantMutation` read `tenantId` from
  // `<TenantProvider/>` (mounted by the chrome-less `/t/[tenantId]` layout)
  // and inject it into args (ADR 0014 §4 / #183). `undefined` is the
  // loading sentinel; an empty array means the tenant has no categories
  // yet; otherwise we render the list.
  const categories = useTenantQuery(api.lib.menu.categories.list);
  const items = useTenantQuery(api.lib.menu.items.list);
  const createCategory = useTenantMutation(api.lib.menu.categories.create);
  const renameCategory = useTenantMutation(api.lib.menu.categories.rename);
  const removeCategory = useTenantMutation(api.lib.menu.categories.remove);
  const reorderCategories = useTenantMutation(api.lib.menu.categories.reorder);
  const setItemAvailability = useTenantMutation(
    api.lib.menu.availability.setItemAvailability,
  );
  const createItem = useTenantMutation(api.lib.menu.items.create);
  const updateItem = useTenantMutation(api.lib.menu.items.update);
  const removeItem = useTenantMutation(api.lib.menu.items.remove);
  // F-MENU-06 (#226) — photo upload / replace / remove. Three mutations:
  //   - generateUploadUrl: mints a short-lived URL the browser POSTs the
  //     file to (the blob never transits the backend).
  //   - attachPhoto: records the `_storage` id on the item; the backend
  //     `setTenantItemPhoto` frees the previous blob on replacement (no
  //     orphan — issue body « le backend libère l ancien blob »).
  //   - removePhoto: deletes the blob + clears the field. Idempotent.
  // All three are tenant-scoped (ADR 0014 §4 / #183, ADR 0010); the
  // wrapper gate keeps cross-tenant ids out (NOT_FOUND).
  const generatePhotoUploadUrl = useTenantMutation(
    api.lib.menu.photos.generateUploadUrl,
  );
  const attachPhoto = useTenantMutation(api.lib.menu.photos.attachPhoto);
  const removePhoto = useTenantMutation(api.lib.menu.photos.removePhoto);

  const [modalState, setModalState] = useState<ItemModalState>(null);

  const handleCreate = async () => {
    try {
      await createCategory({ name: DEFAULT_NEW_CATEGORY_NAME });
    } catch (error) {
      toast.error("Impossible de créer la catégorie", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const handleRename = async (
    categoryId: Id<"menuCategories">,
    name: string,
  ) => {
    try {
      await renameCategory({ categoryId, name });
    } catch (error) {
      toast.error("Impossible de renommer la catégorie", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const handleDelete = async (categoryId: Id<"menuCategories">) => {
    try {
      await removeCategory({ categoryId });
    } catch (error) {
      toast.error("Impossible de supprimer la catégorie", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const handleReorder = async (orderedIds: Id<"menuCategories">[]) => {
    try {
      await reorderCategories({ orderedIds });
    } catch (error) {
      toast.error("Impossible de réordonner les catégories", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  // F-MENU-04 (#211) — Rupture toggle: LIVE mutation, bypasses publication
  // (ADR 0015 § Conséquences — « le toggle live indépendant de la
  // publication »). Optimistic UI is provided by Convex's natural reactivity:
  // the toggle's `checked` mirrors `item.available`, so a successful
  // round-trip is silent and a server reject snaps it back automatically.
  // The try/catch surfaces backend `NOT_FOUND` (cross-tenant race) or any
  // other `ConvexError` as a user-visible toast, never silently swallowed.
  const handleToggleItemAvailability = async (
    itemId: Id<"menuItems">,
    nextAvailable: boolean,
  ) => {
    try {
      await setItemAvailability({ itemId, available: nextAvailable });
    } catch (error) {
      toast.error("Impossible de mettre à jour la disponibilité", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  // F-MENU-05 (#219) — Item CRUD.
  // `handleCreateItem` is fired by the « + Item » CTA per category (opens the
  // modal in CREATE mode); the actual mutation runs when the user clicks
  // « Créer » in the modal (handled by `handleCreateItemSubmit`).
  const handleCreateItem = (categoryId: Id<"menuCategories">) => {
    setModalState({ kind: "create", categoryId });
  };
  const handleItemClick = (itemId: Id<"menuItems">) => {
    setModalState({ kind: "edit", itemId });
  };

  // Modal callbacks — wrap each mutation in try/catch + toast.error (same
  // discipline as the category CRUD handlers above).
  const handleCreateItemSubmit = async (payload: ItemCreatePayload) => {
    try {
      await createItem(payload);
      setModalState(null);
    } catch (error) {
      toast.error("Impossible de créer l'item", {
        description: getConvexErrorMessage(error),
      });
    }
  };
  const handleUpdateItem = async (
    itemId: Id<"menuItems">,
    patch: ItemUpdatePatch,
  ) => {
    try {
      await updateItem({ itemId, ...patch });
    } catch (error) {
      toast.error("Impossible de mettre à jour l'item", {
        description: getConvexErrorMessage(error),
      });
    }
  };
  const handleRemoveItem = async (itemId: Id<"menuItems">) => {
    try {
      await removeItem({ itemId });
    } catch (error) {
      toast.error("Impossible de supprimer l'item", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  // F-MENU-06 (#226) — Photo handlers.
  // `handleUploadPhoto` orchestrates the two-step Convex upload:
  //   1. mint a short-lived upload URL (`generateUploadUrl`),
  //   2. POST the file bytes directly to that URL (the blob never transits
  //      our Convex functions), parse the returned `{ storageId }`,
  //   3. record the storage id on the item (`attachPhoto`). The backend
  //      frees the previous blob in the SAME mutation on replacement —
  //      no orphan (issue body « le backend libère l ancien blob »).
  // Any failure in any step surfaces as a `toast.error` with the wire
  // message — same discipline as the other CRUD handlers.
  const handleUploadPhoto = async (itemId: Id<"menuItems">, file: File) => {
    try {
      const uploadUrl = await generatePhotoUploadUrl();
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error(`Upload failed (HTTP ${response.status})`);
      }
      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      await attachPhoto({ itemId, storageId });
    } catch (error) {
      toast.error("Impossible d'uploader la photo", {
        description: getConvexErrorMessage(error),
      });
    }
  };
  const handleRemovePhoto = async (itemId: Id<"menuItems">) => {
    try {
      await removePhoto({ itemId });
    } catch (error) {
      toast.error("Impossible de supprimer la photo", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  const itemsByCategory = bucketItemsByCategory(items);

  // Resolve the modal's item doc (edit mode only) from the live items query
  // so the modal re-renders if the doc changes server-side (e.g. another
  // tab edited the same item).
  const editingItem = useMemo<Doc<"menuItems"> | undefined>(() => {
    if (
      modalState === null ||
      modalState.kind !== "edit" ||
      items === undefined
    )
      return undefined;
    return items.find((i) => i._id === modalState.itemId);
  }, [modalState, items]);

  return (
    <>
      <MenuView
        categories={categories}
        onCreateCategory={handleCreate}
        onRenameCategory={handleRename}
        onDeleteCategory={handleDelete}
        onReorderCategories={handleReorder}
        itemsByCategory={itemsByCategory}
        onToggleItemAvailability={handleToggleItemAvailability}
        onCreateItem={handleCreateItem}
        onItemClick={handleItemClick}
      />
      {modalState !== null && categories !== undefined ? (
        <ItemModal
          mode={modalState.kind}
          open={
            modalState.kind === "create" ||
            (modalState.kind === "edit" && editingItem !== undefined)
          }
          onOpenChange={(open) => {
            if (!open) setModalState(null);
          }}
          categories={categories}
          categoryId={
            modalState.kind === "create"
              ? modalState.categoryId
              : (editingItem?.categoryId ??
                (modalState.itemId as unknown as Id<"menuCategories">))
          }
          item={modalState.kind === "edit" ? editingItem : undefined}
          onCreate={handleCreateItemSubmit}
          onUpdate={handleUpdateItem}
          onDelete={handleRemoveItem}
          onUploadPhoto={handleUploadPhoto}
          onRemovePhoto={handleRemovePhoto}
        />
      ) : null}
    </>
  );
}
