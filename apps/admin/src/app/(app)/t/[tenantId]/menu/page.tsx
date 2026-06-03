"use client";

/**
 * F-MENU-01 (#187) + F-MENU-02 (#200) + F-MENU-03 (#206) + F-MENU-04 (#211)
 * + F-MENU-05 (#219) + F-MENU-06 (#226) + F-MENU-07 (#237) + F-MENU-08 (#242)
 * + F-MENU-09 (#246) + F-MENU-10 (#254) — Route `/t/[tenantId]/menu/`.
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
 * derives from the ConvexError data). Slice 10 (#254) wires the header
 * publication trio: « Publier » fires
 * `useTenantMutation(api.lib.menu.publication.publishMenu)` (atomic snapshot
 * rebuild, ADR 0015), the « modifications non publiées » badge reads
 * `useTenantQuery(api.lib.menu.publication.hasUnpublishedChanges).hasChanges`
 * (visible iff the live draft diverges from the snapshot), and « Aperçu »
 * navigates to the admin-side draft renderer `/t/[tenantId]/menu/preview`
 * (target=_blank) — the issue body's observable « éditer prix sans publier ⇒
 * Aperçu voit NOUVEAU, getPublicMenu voit ANCIEN ». The publish handler
 * tracks an in-flight flag (re-disables the button) and surfaces
 * `toast.success` on resolve + `toast.error` + `getConvexErrorMessage` on
 * reject (same shape as the rest of the CRUD handlers).
 *
 * Modal state lives at the page level (not inside `MenuView`) so the modal
 * survives reactive re-renders of the categories/items lists (a successful
 * autosave round-trip refires `items.list`, which would otherwise unmount
 * the modal if it lived inside the row).
 *
 * Slice 6 (#226) layers item photo CRUD on top of #219's modal: three
 * additional tenantMutations (`photos.generateUploadUrl`, `attachPhoto`,
 * `removePhoto`) and a `handleUploadPhoto` orchestrator that drives the
 * two-step Convex upload (mint URL → POST file → record storage id). The
 * page passes `onUploadPhoto` / `onRemovePhoto` down to `ItemModal`; the
 * card thumbnail (item-list.tsx) auto-updates via Convex reactivity once
 * `items.list` refires with the new `photoStorageId`.
 *
 * Scope discipline (#219 hard constraint): this file (and its siblings under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/`) is the ONLY surface touched
 * by this story. Zero touch to `apps/web`, `apps/native`, or
 * `packages/backend/convex/`.
 */

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { useCurrentTenantId } from "@/components/app/tenant-context";
import { useTenantMutation, useTenantQuery } from "@/hooks";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import { bucketItemsByCategory } from "./item-list";
import {
  ItemModal,
  type ItemCreatePayload,
  type ItemUpdatePatch,
} from "./item-modal";
import { MenuView, parseMenuTabParam, type MenuTab } from "./menu-view";
import {
  ModifierGroupModal,
  type ModifierGroupCreatePayload,
  type ModifierGroupUpdatePayload,
} from "./modifier-group-modal";
import { ModifierGroupsSection } from "./modifier-groups-section";

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

/**
 * F-MENU-08 (#242) + F-MENU-09 (#246) — Modifier-group modal state. Four
 * branches:
 *   - `null`                            → closed.
 *   - `{ kind: "create" }`              → create modal opened from the
 *     « + Personnalisation » CTA in the standalone section.
 *   - `{ kind: "edit", groupId }`       → edit modal opened from a row's
 *     « Éditer » button.
 *   - `{ kind: "inline-from-item", itemId }` (F-MENU-09 / #246) → create
 *     modal opened from INSIDE the item modal's Personnalisations section.
 *     On a successful create, the page chains
 *     `attachGroupToItem({ itemId, modifierGroupId: newId })` BEFORE closing
 *     the modifier-group modal — the item modal stays open behind it. This
 *     is the « par-dessus la modale item / à la confirmation attache
 *     automatiquement le nouveau groupe à l item courant » contract of the
 *     issue body (c).
 */
type ModifierGroupModalState =
  | null
  | { kind: "create" }
  | { kind: "edit"; groupId: Id<"modifierGroups"> }
  /**
   * `itemId === null` (Alex E2E manuel) — the item modal is in CREATE mode
   * and has no id yet. On a successful `createGroup`, the page appends the
   * new group id to `pendingAttachedGroupIds` (page-level) so it surfaces as
   * a chip on the item modal ; the actual attach-to-item happens later, when
   * the gérant clicks « Créer » on the item modal (handled by
   * `handleCreateItemSubmit`).
   */
  | { kind: "inline-from-item"; itemId: Id<"menuItems"> | null };

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
  // F-MENU-07 (#237) — items drag&drop reorder WITHIN one category. Strict
  // mirror of `categories.reorder` (slice 3, #206): the backend rejects any
  // payload that isn't the full ordered set for THAT category — the front
  // always sends the complete list (no diff). The mutation is tenant-scoped
  // via the wrapper (ADR 0014 §4 / #183, ADR 0010); a cross-tenant
  // categoryId or item id surfaces as NOT_FOUND, an inconsistent ordered
  // list surfaces as INVALID_REORDER — both flow through the same toast.error
  // discipline as the other CRUD handlers.
  const reorderItems = useTenantMutation(api.lib.menu.items.reorder);
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

  // F-MENU-08 (#242) — REUSABLE modifier groups CRUD. Three tenantMutations
  // (ADR 0014 §4 / #183, ADR 0010): createGroup (« + Personnalisation »),
  // updateGroup (« Sauvegarder » from the edit modal), removeGroup (delete
  // with confirmation; the cascade — drop the N-N edges WITHOUT deleting the
  // items — happens backend-side, see `packages/backend/convex/lib/menu/modifiers.ts`).
  // The wrapper gate keeps cross-tenant ids out (NOT_FOUND surfaces as a toast).
  const modifierGroups = useTenantQuery(api.lib.menu.modifiers.listGroups);
  const createModifierGroup = useTenantMutation(
    api.lib.menu.modifiers.createGroup,
  );
  const updateModifierGroup = useTenantMutation(
    api.lib.menu.modifiers.updateGroup,
  );
  const removeModifierGroup = useTenantMutation(
    api.lib.menu.modifiers.removeGroup,
  );

  // F-MENU-09 (#246) — N-N attach/detach for the Personnalisations section
  // inside the item modal. The backend `attachGroupToItem` is idempotent
  // (re-attach = no-op, ADR 0010 cross-tenant safety surfaces as NOT_FOUND);
  // `detachGroupFromItem` removes ONE edge (siblings + group intact). Both
  // are tenant-scoped via `useTenantMutation` (ADR 0014 §4 / #183).
  const attachGroupToItem = useTenantMutation(
    api.lib.menu.modifiers.attachGroupToItem,
  );
  const detachGroupFromItem = useTenantMutation(
    api.lib.menu.modifiers.detachGroupFromItem,
  );
  // Alex E2E manuel — DnD reorder on the « Personnalisations » tag chips.
  // Backend `reorderItemGroups` rejects any payload that isn't the full
  // currently-attached set (INVALID_REORDER, same discipline as items.reorder).
  const reorderItemGroups = useTenantMutation(
    api.lib.menu.modifiers.reorderItemGroups,
  );

  // F-MENU-10 (#254) — Publication wiring (ADR 0015 « édition brouillon →
  // publication globale atomique »):
  //   - `publishMenu`: the global atomic mutation the « Publier » button
  //     fires. Rebuilds the snapshot from the live draft; the backend
  //     wrapper enforces the kb_manager/kb_admin gate + tenantId injection.
  //   - `hasUnpublishedChanges`: the badge indicator. Returns
  //     `{ hasChanges, lastPublishedAt, changedSince }`; we forward
  //     `.hasChanges` to the view. The query is reactive (Convex re-fires it
  //     after any draft mutation OR after a successful `publishMenu`), so
  //     the badge appears / disappears without manual refetch.
  // The « Aperçu » button is a plain link (no mutation, no query) pointing
  // at the admin-side draft renderer `/t/[tenantId]/menu/preview` (see
  // `preview/page.tsx`). Target=_blank in the view so the editor and the
  // preview can sit side-by-side.
  const publishMenu = useTenantMutation(api.lib.menu.publication.publishMenu);
  const publicationStatus = useTenantQuery(
    api.lib.menu.publication.hasUnpublishedChanges,
  );
  const tenantId = useCurrentTenantId();
  const previewHref = `/t/${tenantId}/menu/preview`;

  // Refonte tabs Menu (Alex, 2026-06-03) — the active tab lives in the URL
  // (`?tab=categories|items|modifiers`) so the KB Manager can bookmark a tab
  // and a hard reload restores it. Default = « Plats » (the daily-use surface
  // — rupture toggles + item edits). We read the param via `useSearchParams`,
  // normalise unknown values to the default (see `parseMenuTabParam`), and
  // push the new value via `router.replace` (no scroll, no history entry so
  // tab switches don't pollute the back button — back button must still
  // navigate AWAY from the page, never just toggle tabs).
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab: MenuTab = parseMenuTabParam(searchParams?.get("tab"));
  const handleTabChange = useCallback(
    (next: MenuTab) => {
      // Build the next query string off the current params so any unrelated
      // filter we may add later (e.g. ?category=...) is preserved across tab
      // switches.
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tab", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const [modalState, setModalState] = useState<ItemModalState>(null);
  const [publishLoading, setPublishLoading] = useState(false);
  const [modifierGroupModalState, setModifierGroupModalState] =
    useState<ModifierGroupModalState>(null);
  // Alex E2E manuel — CREATE mode pending attaches for the item modal. Lifted
  // to the page so the inline-create-modifier-group flow can push the new
  // group id here (the flow opens the group modal on top of the item modal ;
  // on save we Append the new id to this list rather than to a never-rendered
  // edge in the backend). Reset to `[]` whenever the modal opens fresh.
  const [pendingAttachedGroupIds, setPendingAttachedGroupIds] = useState<
    Id<"modifierGroups">[]
  >([]);

  // F-MENU-08 (#242) — Impact items query: resolved ON DEMAND when the modal
  // is open in edit mode, skipped otherwise (no round-trip when the modal is
  // closed). `useTenantQuery` accepts `"skip"` as a sentinel like Convex's
  // own `useQuery` — preserves the « réutilisé par N items » discipline of
  // the modal head comment without paying for the list while the modal is
  // closed (issue body « afficher d'abord listGroupItems (impact) »).
  const impactItems = useTenantQuery(
    api.lib.menu.modifiers.listGroupItems,
    modifierGroupModalState !== null && modifierGroupModalState.kind === "edit"
      ? { modifierGroupId: modifierGroupModalState.groupId }
      : "skip",
  );

  // F-MENU-09 (#246) — Attached groups query: resolved ON DEMAND when the item
  // modal is open in edit mode (the only mode where attach/detach makes sense
  // — pre-create we have no itemId). Skipped otherwise so we don't pay the
  // round-trip while the modal is closed. Convex reactivity keeps the section
  // fresh on attach/detach: the mutation invalidates the query and the list
  // re-renders without explicit refetch — same pattern as `impactItems`.
  const attachedGroups = useTenantQuery(
    api.lib.menu.modifiers.listItemGroups,
    modalState !== null && modalState.kind === "edit"
      ? { itemId: modalState.itemId }
      : "skip",
  );

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

  // F-MENU-07 (#237) — Items drag&drop reorder within ONE category. The
  // optimistic UI in `ItemList` paints the new order before the round-trip
  // resolves; on success Convex's reactivity re-fires `items.list` and the
  // server order matches the optimistic guess (silent). On reject the
  // toast surfaces the wire message and the local state snaps back when
  // `items.list` re-emits the OLD order.
  const handleReorderItems = async (
    categoryId: Id<"menuCategories">,
    orderedIds: Id<"menuItems">[],
  ) => {
    try {
      await reorderItems({ categoryId, orderedIds });
    } catch (error) {
      toast.error("Impossible de réordonner les items", {
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
    setPendingAttachedGroupIds([]); // reset stale pending attaches between opens
    setModalState({ kind: "create", categoryId });
  };
  const handleItemClick = (itemId: Id<"menuItems">) => {
    setPendingAttachedGroupIds([]); // EDIT doesn't use it but keep state clean
    setModalState({ kind: "edit", itemId });
  };

  // Modal callbacks — wrap each mutation in try/catch + toast.error (same
  // discipline as the category CRUD handlers above).
  //
  // Alex E2E manuel — fix bug « Personnalisations invisibles en mode CREATE ».
  // The modal hands us `pendingAttachedGroupIds` (modifier groups the gérant
  // picked in the tag selector BEFORE the item existed). We split the payload:
  // (1) create the item, (2) chain `attachGroupToItem({ itemId: newItemId, ... })`
  // for each pending id, IN ORDER so the edge `order` reflects the chip
  // order the gérant chose. Per-id failures are surfaced as a toast but DO
  // NOT roll back the item creation — the item is still created, the gérant
  // can re-attach manually from the edit modal afterward.
  const handleCreateItemSubmit = async (payload: ItemCreatePayload) => {
    const { pendingAttachedGroupIds, ...createArgs } = payload;
    try {
      const newItemId = await createItem(createArgs);
      // Per-id attach — sequential so the backend's append-at-end ordering
      // matches the chip order. Each failure surfaces as a non-fatal toast.
      for (const groupId of pendingAttachedGroupIds) {
        try {
          await attachGroupToItem({
            itemId: newItemId,
            modifierGroupId: groupId,
          });
        } catch (error) {
          toast.error("Impossible d'attacher un groupe à l'item créé", {
            description: getConvexErrorMessage(error),
          });
        }
      }
      setModalState(null);
      setPendingAttachedGroupIds([]);
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

  // F-MENU-08 (#242) — Modifier-group CRUD handlers. The modal owns the form
  // (name/min/max/options) and surfaces local validation (mirror of the
  // backend `assertGroupBounds`); these handlers only own the network call +
  // toast.error discipline (same shape as the item / category CRUD).
  const handleOpenCreateModifierGroup = () => {
    setModifierGroupModalState({ kind: "create" });
  };
  const handleEditModifierGroup = (groupId: Id<"modifierGroups">) => {
    setModifierGroupModalState({ kind: "edit", groupId });
  };
  const handleCreateModifierGroup = async (
    payload: ModifierGroupCreatePayload,
  ) => {
    try {
      const newGroupId = await createModifierGroup(payload);
      // F-MENU-09 (#246) — inline-from-item branch: when the modifier-group
      // modal was opened from inside the item modal (via
      // `onCreateInlineGroup`), chain `attachGroupToItem` AFTER the create
      // resolves so the new group is auto-attached to the originating item
      // (issue body « à la confirmation, attache automatiquement le nouveau
      // groupe à l item courant »). The standalone « + Personnalisation »
      // create path skips this branch (no originating item).
      //
      // Alex E2E manuel — CREATE-mode item modal (`itemId === null`) : the
      // item doesn't exist yet, so we can't attach. Instead, push the new
      // group id onto `pendingAttachedGroupIds` so the chip surfaces in the
      // item modal's tag selector ; the actual attach-to-item runs once the
      // gérant clicks « Créer » (see `handleCreateItemSubmit`).
      if (
        modifierGroupModalState !== null &&
        modifierGroupModalState.kind === "inline-from-item" &&
        newGroupId !== undefined
      ) {
        if (modifierGroupModalState.itemId !== null) {
          await attachGroupToItem({
            itemId: modifierGroupModalState.itemId,
            modifierGroupId: newGroupId,
          });
        } else {
          setPendingAttachedGroupIds((prev) =>
            prev.includes(newGroupId) ? prev : [...prev, newGroupId],
          );
        }
      }
      setModifierGroupModalState(null);
    } catch (error) {
      toast.error("Impossible de créer la personnalisation", {
        description: getConvexErrorMessage(error),
      });
    }
  };
  const handleUpdateModifierGroup = async (
    groupId: Id<"modifierGroups">,
    payload: ModifierGroupUpdatePayload,
  ) => {
    try {
      await updateModifierGroup({ modifierGroupId: groupId, ...payload });
      setModifierGroupModalState(null);
    } catch (error) {
      toast.error("Impossible de mettre à jour la personnalisation", {
        description: getConvexErrorMessage(error),
      });
    }
  };
  const handleRemoveModifierGroup = async (groupId: Id<"modifierGroups">) => {
    try {
      await removeModifierGroup({ modifierGroupId: groupId });
      setModifierGroupModalState(null);
    } catch (error) {
      toast.error("Impossible de supprimer la personnalisation", {
        description: getConvexErrorMessage(error),
      });
    }
  };

  // F-MENU-09 (#246) — Attach / detach handlers for the Personnalisations
  // section inside the item modal. Same toast.error discipline as the rest
  // of the CRUD (NOT_FOUND for cross-tenant probes etc. surface as a visible
  // toast — never silently swallowed).
  const handleAttachGroupToItem = async (
    itemId: Id<"menuItems">,
    modifierGroupId: Id<"modifierGroups">,
  ) => {
    try {
      await attachGroupToItem({ itemId, modifierGroupId });
    } catch (error) {
      toast.error("Impossible d'attacher le groupe", {
        description: getConvexErrorMessage(error),
      });
    }
  };
  const handleDetachGroupFromItem = async (
    itemId: Id<"menuItems">,
    modifierGroupId: Id<"modifierGroups">,
  ) => {
    try {
      await detachGroupFromItem({ itemId, modifierGroupId });
    } catch (error) {
      toast.error("Impossible de détacher le groupe", {
        description: getConvexErrorMessage(error),
      });
    }
  };
  const handleReorderItemGroups = async (
    itemId: Id<"menuItems">,
    orderedGroupIds: Id<"modifierGroups">[],
  ) => {
    try {
      await reorderItemGroups({ itemId, orderedGroupIds });
    } catch (error) {
      toast.error("Impossible de réordonner les personnalisations", {
        description: getConvexErrorMessage(error),
      });
    }
  };
  // F-MENU-10 (#254) — Publish handler. Wraps `publishMenu` in try/catch +
  // toast.success / toast.error + getConvexErrorMessage (same discipline as
  // the rest of the CRUD). Tracks an `publishLoading` flag so the button
  // re-disables while in flight (a second click would fire the mutation
  // twice — double toasts + wasted round-trip; backend is idempotent at the
  // snapshot level but the cost is real).
  //
  // After resolve, `hasUnpublishedChanges` re-fires (Convex reactivity) and
  // the badge disappears automatically — no manual state needed (ADR 0015
  // « disparaît après publication réussie »). The success toast surfaces
  // the explicit confirmation the issue body requires.
  const handlePublish = async () => {
    if (publishLoading) return;
    setPublishLoading(true);
    try {
      await publishMenu();
      toast.success("Menu publié");
    } catch (error) {
      toast.error("Impossible de publier le menu", {
        description: getConvexErrorMessage(error),
      });
    } finally {
      setPublishLoading(false);
    }
  };

  // F-MENU-09 (#246) — Opens the modifier-group modal STACKED over the item
  // modal, in « inline-from-item » mode. The item modal stays mounted behind
  // it (page-level state — survives the group modal lifecycle); on a
  // successful `createGroup`, `handleCreateModifierGroup` chains
  // `attachGroupToItem({ itemId, modifierGroupId: newId })` BEFORE closing
  // the group modal — see the inline-from-item branch above.
  const handleOpenInlineModifierGroup = (itemId: Id<"menuItems"> | null) => {
    setModifierGroupModalState({ kind: "inline-from-item", itemId });
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

  // F-MENU-08 (#242) — Resolve the editing group doc from the live list query
  // (Convex reactivity: a sibling tab edit shows up immediately).
  const editingModifierGroup = useMemo<
    Doc<"modifierGroups"> | undefined
  >(() => {
    if (
      modifierGroupModalState === null ||
      modifierGroupModalState.kind !== "edit" ||
      modifierGroups === undefined
    )
      return undefined;
    return modifierGroups.find(
      (g) => g._id === modifierGroupModalState.groupId,
    );
  }, [modifierGroupModalState, modifierGroups]);

  // Refonte tabs Menu (2026-06-03) — the « Personnalisations » section is now
  // mounted INSIDE MenuView (tab 3 content) instead of as a sibling under the
  // menu page. We hand the configured section instance down so MenuView stays
  // agnostic of the modifier-group data model (the CRUD callbacks already live
  // here on the page).
  const modifiersSection = (
    <ModifierGroupsSection
      groups={modifierGroups}
      onCreateGroup={handleOpenCreateModifierGroup}
      onEditGroup={handleEditModifierGroup}
      onDeleteGroup={handleRemoveModifierGroup}
    />
  );

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
        onReorderItems={handleReorderItems}
        onPublish={handlePublish}
        publishLoading={publishLoading}
        previewHref={previewHref}
        hasUnpublishedChanges={publicationStatus?.hasChanges}
        currentTab={currentTab}
        onTabChange={handleTabChange}
        modifiersSection={modifiersSection}
      />
      {modifierGroupModalState !== null ? (
        <ModifierGroupModal
          // F-MENU-09 (#246): both « create » (standalone) and « inline-from-item »
          // render the modal in CREATE mode. The page tracks WHICH branch via
          // `modifierGroupModalState.kind` so `handleCreateModifierGroup` can
          // chain the auto-attach in the inline branch only.
          mode={modifierGroupModalState.kind === "edit" ? "edit" : "create"}
          open={
            modifierGroupModalState.kind === "create" ||
            modifierGroupModalState.kind === "inline-from-item" ||
            (modifierGroupModalState.kind === "edit" &&
              editingModifierGroup !== undefined)
          }
          onOpenChange={(open) => {
            if (!open) setModifierGroupModalState(null);
          }}
          group={
            modifierGroupModalState.kind === "edit"
              ? editingModifierGroup
              : undefined
          }
          impactItems={
            modifierGroupModalState.kind === "edit" ? impactItems : undefined
          }
          onCreate={handleCreateModifierGroup}
          onUpdate={handleUpdateModifierGroup}
          onDelete={handleRemoveModifierGroup}
        />
      ) : null}
      {modalState !== null && categories !== undefined ? (
        <ItemModal
          mode={modalState.kind}
          open={
            modalState.kind === "create" ||
            (modalState.kind === "edit" && editingItem !== undefined)
          }
          onOpenChange={(open) => {
            if (!open) {
              setModalState(null);
              setPendingAttachedGroupIds([]);
            }
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
          // F-MENU-09 (#246) — Personnalisations: list/attach/detach/create-inline
          // surface for REUSABLE modifier groups. The page resolves the attached
          // set (`listItemGroups`, scoped to the open item) + threads the full
          // tenant set down so the picker can filter out already-attached groups.
          attachedGroups={
            modalState.kind === "edit" ? attachedGroups : undefined
          }
          availableGroups={modifierGroups}
          pendingAttachedGroupIds={pendingAttachedGroupIds}
          setPendingAttachedGroupIds={setPendingAttachedGroupIds}
          onAttachGroup={handleAttachGroupToItem}
          onDetachGroup={handleDetachGroupFromItem}
          onReorderGroups={handleReorderItemGroups}
          onCreateInlineGroup={handleOpenInlineModifierGroup}
        />
      ) : null}
    </>
  );
}
