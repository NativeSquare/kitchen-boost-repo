"use client";

/**
 * F-MENU-05 (#219) + F-MENU-06 (#226) + F-MENU-09 (#246) — `ItemModal`, the
 * load-bearing CRUD surface for menu items.
 *
 * Two modes, ONE component (DRY — same form, same validation, same fields):
 *   - `mode === "create"` — opened by the « + Item » CTA per category. One
 *     explicit « Créer » button calls `onCreate` with the full payload; no
 *     autosave per keystroke (a half-typed name would race the server, and
 *     `name: ""` is the schema default rejected by the backend). NO delete
 *     button (nothing exists yet). The category picker is pre-selected on the
 *     `categoryId` prop — the category from which the CTA was clicked.
 *   - `mode === "edit"` — opened by a click on an item card. Pre-fills every
 *     field from the `item` doc; autosaves text fields (name, description,
 *     price) on a 600 ms debounce (ADR 0015 « debounce on texts »); fires
 *     IMMEDIATELY on discrete actions (allergen tick, category change —
 *     « immédiat sur les actions discrètes »). Surfaces a delete button gated
 *     by a confirmation `AlertDialog` (the cascade — orderItems frozen
 *     snapshots stay intact, photo blob freed, N-N modifier links dropped —
 *     happens backend-side, see `packages/backend/convex/lib/menu/items.ts`).
 *
 * Allergens — STRICT contract: the 14 literals are imported from the BACKEND
 * validator (`ALLERGENS_UE_1169` exported by
 * `packages/backend/convex/table/menuItems.ts`). The story body (#219) and
 * EPIC F-MENU (#149) « Implementation Decisions » explicitly forbid hardcoding
 * them on the front — a future EU regulation change must edit the schema and
 * have the modal reflect it without a separate front change.
 *
 * Price validation — local guard: the « Prix » input is a plain text input
 * (no HTML `type="number"` — the touch UX is poor and the locale of the
 * decimal separator can't be locked). `parsePriceEuros` parses the input and
 * returns either `{ ok: true, centimes }` or an error case. The « Créer »
 * button stays DISABLED when the parsed price isn't ok (create mode); in
 * edit mode the autosave is SKIPPED and an inline message
 * (`data-slot="menu-item-modal-price-error"`) surfaces. The « message clair
 * dérivé de INVALID_PRICE » (issue body) is wired at the PAGE level via
 * `toast.error(getConvexErrorMessage(error))` should the backend still reject.
 *
 * Photo CRUD — F-MENU-06 (#226): the edit-mode form layers an opt-in
 * `ItemPhotoSection` (rendered only when the page passes BOTH
 * `onUploadPhoto` and `onRemovePhoto`) carrying a thumbnail SLOT, a file
 * picker, and a « Supprimer la photo » button gated on
 * `item.photoStorageId !== undefined`. Replacement uses the SAME path as
 * upload — the backend `setTenantItemPhoto` invariant frees the previous
 * blob in the same mutation (no orphan, issue body « le backend libère l
 * ancien blob »); the front never explicitly calls `removePhoto` before
 * an attach.
 *
 * Personnalisations — F-MENU-09 (#246): the edit-mode form layers an opt-in
 * `ModifiersSection` (rendered only when the page passes the three handlers
 * `onAttachGroup` / `onDetachGroup` / `onCreateInlineGroup`) carrying:
 *   (a) the list of REUSABLE modifier groups attached to the item (name +
 *       min/max badge + options summary + « Détacher »),
 *   (b) a picker over the tenant's full `availableGroups` MINUS the already-
 *       attached set (idempotent backend = safety net, filter = UX clarity),
 *   (c) a « Créer un nouveau groupe » button that fires
 *       `onCreateInlineGroup(itemId)` — the page stacks the
 *       `ModifierGroupModal` over the item modal and chains
 *       `attachGroupToItem({ itemId, modifierGroupId: newId })` on save.
 *
 * Scope discipline (#219 / #226 / #246 hard constraint): this file lives
 * under `apps/admin/src/app/(app)/t/[tenantId]/menu/` — zero touch to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
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
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  IconGripVertical,
  IconPhoto,
  IconPlus,
  IconTrash,
  IconUpload,
  IconX,
} from "@tabler/icons-react";

import { api } from "@packages/backend/convex/_generated/api";
import {
  ALLERGENS_UE_1169,
  type Allergen,
} from "@packages/backend/convex/table/menuItems";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

import { parsePriceEuros, type ParsedPrice } from "./parse-price";
import { reorderById } from "./reorder-utils";
import { useDebouncedCallback } from "./use-debounced-callback";

/** Default debounce for text autosave (ADR 0015, story body « 500-800 ms »). */
const TEXT_DEBOUNCE_MS = 600;

/** Patch payload sent to `api.lib.menu.items.update` from the autosave path. */
export type ItemUpdatePatch = {
  name: string;
  description: string;
  basePrice: number;
  allergens: Allergen[];
  available: boolean;
  categoryId?: Id<"menuCategories">;
};

/**
 * Payload sent to `api.lib.menu.items.create` from the « Créer » action.
 *
 * `pendingAttachedGroupIds` (Alex E2E manuel — bug « section invisible en mode
 * CREATE ») carries the modifier groups the gérant picked in the « Personnalisations »
 * tag selector BEFORE the item existed. The page-level `onCreate` handler is
 * responsible for chaining `attachGroupToItem({ itemId: newItemId, modifierGroupId })`
 * for each id AFTER the create resolves — the modal cannot do it itself because
 * the item has no `_id` until the create round-trip lands. The order of the
 * array is the order the gérant wants on the chips (mirror of the edge `order`
 * field on `menuItemModifierGroups`). Empty in edit mode (attach/detach happens
 * live via the dedicated handlers).
 */
export type ItemCreatePayload = {
  categoryId: Id<"menuCategories">;
  name: string;
  description: string;
  basePrice: number;
  allergens: Allergen[];
  pendingAttachedGroupIds: Id<"modifierGroups">[];
};

export type ItemModalProps = {
  mode: "create" | "edit";
  /** Controlled open flag — owned by the page so the modal can close after a successful create. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** All of the tenant's categories — exposed as the recategorisation picker options. */
  categories: Doc<"menuCategories">[];
  /**
   * In create mode: the category from which « + Item » was clicked (pre-fills
   * the picker). In edit mode: the item's CURRENT category (also pre-filled).
   * Always required so the picker has a defined initial value.
   */
  categoryId: Id<"menuCategories">;
  /** Edit mode only — the item being edited. Undefined in create mode. */
  item?: Doc<"menuItems">;
  /** Create-mode commit. Fires once on the « Créer » button click. */
  onCreate: (payload: ItemCreatePayload) => void;
  /** Edit-mode commit. Fires on debounced text changes + immediate discrete actions. */
  onUpdate: (itemId: Id<"menuItems">, patch: ItemUpdatePatch) => void;
  /** Edit-mode delete. Fires from the confirmation dialog's « Confirmer » action. */
  onDelete: (itemId: Id<"menuItems">) => void;
  /**
   * F-MENU-06 (#226) — fired when the gérant picks a file from the photo
   * input (edit mode only). The page owns the two-step Convex upload
   * (`photos.generateUploadUrl` → POST → `photos.attachPhoto`); the modal
   * just hands it the picked File. When omitted, the photo section is NOT
   * rendered (slice is OPT-IN — preserves the F-MENU-05 contract).
   *
   * Replacement is the SAME path as upload: the backend's
   * `setTenantItemPhoto` invariant guarantees the previous blob is freed
   * (no orphan), so the front never explicitly calls `removePhoto` before
   * an `attachPhoto` of replacement.
   */
  onUploadPhoto?: (itemId: Id<"menuItems">, file: File) => void;
  /**
   * F-MENU-06 (#226) — fired when the gérant clicks the « Supprimer la photo »
   * button (edit mode only, AND only when `item.photoStorageId !== undefined`
   * — the affordance is gated on the photo's existence to avoid a misleading
   * « remove nothing » button). The page wires this to
   * `useTenantMutation(api.lib.menu.photos.removePhoto)`.
   */
  onRemovePhoto?: (itemId: Id<"menuItems">) => void;
  /**
   * F-MENU-09 (#246) — REUSABLE modifier groups currently attached to this
   * item. Resolved page-side via
   * `useTenantQuery(api.lib.menu.modifiers.listItemGroups, { itemId })` and
   * threaded down (same pattern as `impactItems` on `ModifierGroupModal`).
   * `undefined` = loading sentinel (the modal renders a small skeleton);
   * `[]` = item has no group yet (the modal renders the empty-state copy).
   * The modal does NOT call any Convex query itself — keeps it testable
   * under the lean `node` env (the photo section is the lone exception, an
   * inherited pattern from F-MENU-06).
   */
  attachedGroups?: Doc<"modifierGroups">[];
  /**
   * F-MENU-09 (#246) — full tenant set of REUSABLE modifier groups
   * (`useTenantQuery(api.lib.menu.modifiers.listGroups)`). The picker
   * filters out groups already in `attachedGroups` to avoid offering an
   * obvious no-op affordance (the backend `attachGroupToItem` is idempotent,
   * which is the SAFETY net — the picker filter is the UX-clarity layer).
   */
  availableGroups?: Doc<"modifierGroups">[];
  /**
   * F-MENU-09 (#246) — fired when the gérant picks a group from the picker.
   * Idempotent backend (re-attach = no-op, issue body « ré-attacher = no-op,
   * pas besoin de tracker côté front »); the modal does not track an
   * « already attached » set — it just filters the picker source.
   */
  onAttachGroup?: (
    itemId: Id<"menuItems">,
    modifierGroupId: Id<"modifierGroups">,
  ) => void;
  /**
   * F-MENU-09 (#246) — fired when the gérant clicks « Détacher » on an
   * attached row. The backend `detachGroupFromItem` removes ONE edge
   * (siblings + group untouched, issue body « ne le supprime PAS et n affecte
   * PAS les autres items qui l utilisent »); the page just wires the call.
   */
  onDetachGroup?: (
    itemId: Id<"menuItems">,
    modifierGroupId: Id<"modifierGroups">,
  ) => void;
  /**
   * Alex E2E manuel — fired when the gérant rearranges the « Personnalisations »
   * tag chips via drag&drop. The full ordered set of `modifierGroups` ids the
   * item is attached to (strict mirror of `items.reorder`: no partial, the
   * backend `reorderItemGroups` rejects anything that isn't the complete
   * currently-attached set). EDIT mode only — pre-create, reorder happens
   * locally on `pendingAttachedGroupIds` (no round-trip).
   */
  onReorderGroups?: (
    itemId: Id<"menuItems">,
    orderedGroupIds: Id<"modifierGroups">[],
  ) => void;
  /**
   * Alex E2E manuel — CREATE-mode pending attaches. Pre-create the item has
   * no `_id`, so `attachGroupToItem` can't target it ; we stash the picked
   * group ids on the PAGE (so an inline-create modifier-group flow can also
   * push to this list after the new group lands) and forward them in
   * `ItemCreatePayload.pendingAttachedGroupIds` on submit — the page-level
   * `onCreate` handler chains the per-id `attachGroupToItem` calls AFTER the
   * `items.create` resolves with the new id. In edit mode this state is
   * unused (attach/detach happens live via the dedicated handlers).
   */
  pendingAttachedGroupIds?: Id<"modifierGroups">[];
  setPendingAttachedGroupIds?: (
    next:
      | Id<"modifierGroups">[]
      | ((prev: Id<"modifierGroups">[]) => Id<"modifierGroups">[]),
  ) => void;
  /**
   * F-MENU-09 (#246) — fired when the gérant clicks « Créer un nouveau
   * groupe ». The page handles stacking the `ModifierGroupModal` over the
   * item modal (issue body « ouvre la modale groupe (F-MENU-08) par-dessus
   * la modale item ») AND chaining `attachGroupToItem({ itemId, modifierGroupId })`
   * once `createGroup` resolves (« à la confirmation, attache automatiquement
   * le nouveau groupe à l item courant »). The modal here just fires the
   * open intent — keeping the cross-modal state on the page is what makes
   * the stacking robust to a successful create (the page closes the group
   * modal but keeps the item modal open).
   *
   * In CREATE mode (Alex E2E manuel — bug « section invisible »), the page
   * receives `null` instead of an item id (no item exists yet). The page
   * still stacks the group modal, but on save it stashes the new group id in
   * `pendingAttachedGroupIds` on the item modal local state (via Convex
   * reactivity: the new group lands in `availableGroups`, the page tags it
   * as « pending-attach for the open item modal », the chip surfaces). The
   * item-create-then-attach chain runs only when the gérant clicks « Créer ».
   */
  onCreateInlineGroup?: (itemId: Id<"menuItems"> | null) => void;
};

export function ItemModal(props: ItemModalProps) {
  const { mode, open, onOpenChange } = props;
  // Right-side drawer (UX: a generous form with prix/allergens/photo/
  // personnalisations reads better as a vertical scroll panel than as a
  // centred dialog that needs to compete with the menu list behind it).
  // Radix' Sheet is built on the same dialog primitive — overlay click,
  // Escape, and the embedded X button all close it; ARIA role stays
  // `dialog` so the existing test selectors keep working.
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        data-slot="menu-item-modal"
        className="w-full overflow-y-auto sm:max-w-xl"
      >
        {/* Padding interne au sheet (le SheetContent du DS n'en porte pas).
            Le `SheetHeader` shadcn embarque un `p-4` par défaut — on le
            remplace par `px-6 pt-6` (twMerge: la classe d'override gagne)
            pour aligner sur le `px-6` du corps de formulaire. Le footer est
            géré séparément (override `p-0 pt-2` car il hérite déjà du
            wrapper). Objectif: aucun élément ne touche un bord du drawer. */}
        <SheetHeader className="px-6 pt-6 pb-0">
          <SheetTitle>
            {mode === "create" ? "Nouvel item" : "Éditer l'item"}
          </SheetTitle>
          <SheetDescription>
            {mode === "create"
              ? "Ajoutez un nouvel article à votre menu."
              : "Modifiez les informations de l'article. Les changements sont enregistrés automatiquement."}
          </SheetDescription>
        </SheetHeader>
        <ItemModalForm {...props} />
      </SheetContent>
    </Sheet>
  );
}

function ItemModalForm({
  mode,
  categories,
  categoryId,
  item,
  onOpenChange,
  onCreate,
  onUpdate,
  onDelete,
  onUploadPhoto,
  onRemovePhoto,
  attachedGroups,
  availableGroups,
  pendingAttachedGroupIds,
  setPendingAttachedGroupIds,
  onAttachGroup,
  onDetachGroup,
  onReorderGroups,
  onCreateInlineGroup,
}: ItemModalProps) {
  // Defaults — the page is the canonical owner of `pendingAttachedGroupIds`
  // (so an inline-create flow on the modifier-group modal can push the new
  // group's id onto this list when the item modal is in CREATE mode). When
  // the page doesn't wire them (legacy callers / EDIT mode), fall back to a
  // stable empty array + a no-op setter — no behaviour change for EDIT.
  const resolvedPendingIds: Id<"modifierGroups">[] = useMemo(
    () => pendingAttachedGroupIds ?? [],
    [pendingAttachedGroupIds],
  );
  const resolvedSetPending = setPendingAttachedGroupIds ?? (() => {});
  // -- Local form state ------------------------------------------------------
  // Edit mode: pre-fill from the item doc. Create mode: empty defaults.
  const initialPriceEuros = useMemo(() => {
    if (mode !== "edit" || item === undefined) return "";
    // Display the centimes as euros with up to 2 decimals (no trailing zero
    // padding — « 12,9 » displays as « 12.9 », the user keeps typing).
    const euros = item.basePrice / 100;
    // Stringify with up to 2 decimals; strip trailing zero (but keep one
    // decimal if the value is whole + an existing decimal — but a whole
    // value of 1290 -> 12.9 is also fine to display).
    if (Number.isInteger(euros)) return String(euros);
    // toFixed(2) -> "12.90" — we KEEP the user-friendly « 12.9 » view to
    // avoid surprising trailing zeros; if a user wants .50 they type it.
    return String(euros);
  }, [mode, item]);

  const [name, setName] = useState<string>(item?.name ?? "");
  const [description, setDescription] = useState<string>(
    item?.description ?? "",
  );
  const [priceInput, setPriceInput] = useState<string>(initialPriceEuros);
  const [selectedCategoryId, setSelectedCategoryId] = useState<
    Id<"menuCategories">
  >(item?.categoryId ?? categoryId);
  const [selectedAllergens, setSelectedAllergens] = useState<Allergen[]>(
    item?.allergens ?? [],
  );
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // -- Parsed price ---------------------------------------------------------
  // The parsed price is derived from the input string — single source of
  // truth for both the « Créer » disabled state (create mode) and the
  // « visible error » UI (both modes when invalid + non-empty).
  const parsedPrice: ParsedPrice = useMemo(
    () => parsePriceEuros(priceInput),
    [priceInput],
  );

  // -- Edit-mode autosave handlers ------------------------------------------
  // Text fields (name, description, price) debounce; discrete actions
  // (allergen tick, category change) fire immediately. We bundle every patch
  // with the FULL current state so a half-typed price doesn't override a
  // freshly-ticked allergen with a stale value.
  const fireUpdate = useMemo(() => {
    if (mode !== "edit" || item === undefined) return null;
    return (overrides: Partial<ItemUpdatePatch> = {}) => {
      // Default patch — read latest state through closures, the override is
      // for the field that JUST changed (so the autosave reads its own new
      // value without waiting for React's next render).
      const patch: ItemUpdatePatch = {
        name: overrides.name ?? name,
        description: overrides.description ?? description,
        basePrice:
          overrides.basePrice ??
          (parsedPrice.ok ? parsedPrice.centimes : item.basePrice),
        allergens: overrides.allergens ?? selectedAllergens,
        available: item.available, // toggle is owned by the card, not the modal
        categoryId: overrides.categoryId ?? selectedCategoryId,
      };
      // Skip if the price is invalid AND the override didn't already pin
      // a valid centimes value — never autosave a bad price.
      if (overrides.basePrice === undefined && !parsedPrice.ok) {
        // Still autosave the other fields with the LAST KNOWN GOOD price
        // (the doc's current price) — that's what the patch already does.
        // Falls through.
      }
      onUpdate(item._id, patch);
    };
  }, [
    mode,
    item,
    name,
    description,
    parsedPrice,
    selectedAllergens,
    selectedCategoryId,
    onUpdate,
  ]);

  const debouncedTextAutosave = useDebouncedCallback<Partial<ItemUpdatePatch>>(
    (override) => {
      if (fireUpdate === null) return;
      fireUpdate(override);
    },
    TEXT_DEBOUNCE_MS,
  );

  // Flush any pending text autosave on unmount so we don't drop the last
  // keystroke when the user closes the modal mid-debounce.
  useEffect(() => {
    return () => {
      debouncedTextAutosave.flush();
    };
    // The debouncer is a fresh closure each render — including it in deps
    // would cancel on every render. The pattern matches `category-list-editor.tsx`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- Handlers --------------------------------------------------------------
  const handleNameChange = (next: string) => {
    setName(next);
    if (mode === "edit") debouncedTextAutosave({ name: next });
  };
  const handleDescriptionChange = (next: string) => {
    setDescription(next);
    if (mode === "edit") debouncedTextAutosave({ description: next });
  };
  const handlePriceChange = (next: string) => {
    setPriceInput(next);
    if (mode === "edit") {
      const parsed = parsePriceEuros(next);
      if (parsed.ok) {
        debouncedTextAutosave({ basePrice: parsed.centimes });
      }
      // invalid → don't autosave; the inline error surfaces below.
    }
  };
  const handleCategoryChange = (next: Id<"menuCategories">) => {
    setSelectedCategoryId(next);
    // IMMEDIATE on discrete actions (ADR 0015).
    if (mode === "edit" && fireUpdate !== null) {
      // Cancel any pending text-debounce so we don't race ourselves.
      debouncedTextAutosave.cancel();
      fireUpdate({ categoryId: next });
    }
  };
  const handleAllergenToggle = (allergen: Allergen, checked: boolean) => {
    const next = checked
      ? [...selectedAllergens, allergen]
      : selectedAllergens.filter((a) => a !== allergen);
    setSelectedAllergens(next);
    if (mode === "edit" && fireUpdate !== null) {
      debouncedTextAutosave.cancel();
      fireUpdate({ allergens: next });
    }
  };

  const handleCreate = () => {
    if (!parsedPrice.ok) return;
    if (name.trim().length === 0) return;
    onCreate({
      categoryId: selectedCategoryId,
      name: name.trim(),
      description,
      basePrice: parsedPrice.centimes,
      allergens: selectedAllergens,
      pendingAttachedGroupIds: resolvedPendingIds,
    });
  };

  const handleDeleteConfirm = () => {
    if (item === undefined) return;
    onDelete(item._id);
    setConfirmDeleteOpen(false);
    onOpenChange(false);
  };

  const canCreate =
    mode === "create" && parsedPrice.ok && name.trim().length > 0;

  // -- Price error -----------------------------------------------------------
  // We surface the price error WHEN: the input parses to an explicit error
  // OTHER than « empty » (don't pester the user before they typed anything),
  // OR the underlying item carries a negative price (a contract violation we
  // want to flag loudly). The error message is the user-facing mirror of the
  // backend's `INVALID_PRICE` — vocabulary matches the story body « positif ».
  const showPriceError =
    (!parsedPrice.ok && parsedPrice.reason !== "empty") ||
    (item !== undefined && item.basePrice < 0);
  const priceErrorMessage = (() => {
    if (item !== undefined && item.basePrice < 0) {
      return "Le prix doit être positif ou nul (centimes ≥ 0).";
    }
    if (!parsedPrice.ok) {
      switch (parsedPrice.reason) {
        case "negative":
          return "Le prix doit être positif ou nul.";
        case "fraction":
          return "Le prix accepte au maximum 2 décimales (centimes).";
        case "format":
          return "Format de prix invalide (ex. 12,50).";
        case "empty":
          return "Le prix est obligatoire.";
      }
    }
    return null;
  })();

  return (
    // Padding horizontal aligné avec SheetHeader (px-6). Pas de padding-top
    // ici — `SheetContent` est `flex-col gap-4` donc le `gap` parent crée
    // déjà l'espacement avec le header. Padding-bottom assuré par l'override
    // sur le SheetFooter (qui est enfant de ce wrapper, on annule son `p-4`
    // par défaut au profit de `px-0 pb-6 pt-2` pour ne pas doubler le `px-6`
    // hérité).
    <div className="flex flex-col gap-4 px-6 pb-6">
      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="menu-item-modal-name">Nom</Label>
        <Input
          id="menu-item-modal-name"
          data-slot="menu-item-modal-name-input"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
          onBlur={() => debouncedTextAutosave.flush()}
          placeholder="Smash Burger"
        />
      </div>

      {/* Description */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="menu-item-modal-description">Description</Label>
        <Textarea
          id="menu-item-modal-description"
          data-slot="menu-item-modal-description-input"
          value={description}
          onChange={(e) => handleDescriptionChange(e.target.value)}
          onBlur={() => debouncedTextAutosave.flush()}
          placeholder="Double steak, cheddar, sauce maison…"
        />
      </div>

      {/* Price (euros, parsed to centimes) */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="menu-item-modal-price">Prix (€)</Label>
        <Input
          id="menu-item-modal-price"
          data-slot="menu-item-modal-price-input"
          value={priceInput}
          onChange={(e) => handlePriceChange(e.target.value)}
          onBlur={() => debouncedTextAutosave.flush()}
          placeholder="12,50"
          inputMode="decimal"
          aria-invalid={showPriceError || undefined}
        />
        {showPriceError && priceErrorMessage !== null ? (
          <p
            data-slot="menu-item-modal-price-error"
            className="text-destructive text-xs"
          >
            {priceErrorMessage}
          </p>
        ) : null}
      </div>

      {/* Category picker (recategorisation A→B in edit mode) */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="menu-item-modal-category">Catégorie</Label>
        <NativeSelect
          id="menu-item-modal-category"
          data-slot="menu-item-modal-category-picker"
          value={selectedCategoryId as unknown as string}
          onChange={(e) =>
            handleCategoryChange(
              e.target.value as unknown as Id<"menuCategories">,
            )
          }
          className="w-full"
        >
          {categories.map((c) => (
            <NativeSelectOption
              key={c._id}
              value={c._id as unknown as string}
              data-slot="menu-item-modal-category-option"
            >
              {c.name}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {/* Photo — F-MENU-06 (#226). Edit mode only AND wired only when the
          page passes BOTH `onUploadPhoto` and `onRemovePhoto` (slice OPT-IN
          to preserve the F-MENU-05 contract: callers from the previous slice
          don't pass these). The thumbnail SLOT is ALWAYS rendered when the
          section is shown (placeholder when no `photoStorageId`, real <img>
          when resolved) — same layout-stable discipline as `item-list.tsx`. */}
      {mode === "edit" &&
      item !== undefined &&
      onUploadPhoto !== undefined &&
      onRemovePhoto !== undefined ? (
        <ItemPhotoSection
          item={item}
          onUploadPhoto={onUploadPhoto}
          onRemovePhoto={onRemovePhoto}
        />
      ) : null}

      {/* Personnalisations — F-MENU-09 (#246) + Alex E2E manuel (UX refonte +
          fix « section invisible en mode CREATE »). Rendered in BOTH modes
          when the page wires the three Personnalisations handlers (slice
          OPT-IN to preserve the F-MENU-05/06/08 contracts).
            CREATE mode: the chips reflect `pendingAttachedGroupIds` (local
              state). The submit `onCreate` payload carries them; the page
              chains `attachGroupToItem(newItemId, gid)` after the create
              resolves.
            EDIT mode: the chips reflect `attachedGroups` (the live Convex
              query result, threaded down from the page). Picker selection /
              chip detach / chip DnD reorder all fire the dedicated handlers
              (`onAttachGroup` / `onDetachGroup` / `onReorderGroups`).
          UX (Alex, E2E manuel): « multiselect avec tags qui s'agrègent comme
          des chips, réordonnables avec du DnD ». Each chip = group NAME ONLY
          (« pas nécessairement un supplément » — explicit no min/max badge,
          no « Supplément » mention). Tags are reorderable via dnd-kit
          (`useSortable` per chip, horizontal strategy). */}
      {onAttachGroup !== undefined &&
      onDetachGroup !== undefined &&
      onCreateInlineGroup !== undefined ? (
        <ModifiersSection
          mode={mode}
          item={item}
          attachedGroups={attachedGroups}
          availableGroups={availableGroups}
          pendingAttachedGroupIds={resolvedPendingIds}
          setPendingAttachedGroupIds={resolvedSetPending}
          onAttachGroup={onAttachGroup}
          onDetachGroup={onDetachGroup}
          onReorderGroups={onReorderGroups}
          onCreateInlineGroup={onCreateInlineGroup}
        />
      ) : null}

      {/* Allergens — closed multi-select on the 14 frozen UE 1169/2011 literals */}
      <div className="flex flex-col gap-2">
        <Label>Allergènes</Label>
        <p className="text-muted-foreground text-xs">
          Sélectionnez les allergènes présents dans cet article (Règlement UE
          1169/2011).
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ALLERGENS_UE_1169.map((allergen) => {
            const checked = selectedAllergens.includes(allergen);
            const checkboxId = `menu-item-modal-allergen-${allergen}`;
            return (
              <label
                key={allergen}
                htmlFor={checkboxId}
                className="hover:bg-muted/50 flex cursor-pointer items-center gap-2 rounded-md p-1.5 text-sm"
              >
                <Checkbox
                  id={checkboxId}
                  data-slot="menu-item-modal-allergen-checkbox"
                  data-allergen={allergen}
                  checked={checked}
                  onCheckedChange={(next) =>
                    handleAllergenToggle(allergen, next === true)
                  }
                />
                <span className="capitalize">{allergen}</span>
              </label>
            );
          })}
        </div>
      </div>

      <SheetFooter className="flex-row items-center justify-between gap-2 p-0 pt-2 sm:justify-between">
        {/* Delete (edit mode only), confirmation-gated */}
        <div>
          {mode === "edit" && item !== undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-slot="menu-item-modal-delete"
              onClick={() => setConfirmDeleteOpen(true)}
              className="text-destructive hover:text-destructive"
            >
              <IconTrash className="mr-1.5 size-4" aria-hidden="true" />
              Supprimer
            </Button>
          ) : (
            <span />
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              debouncedTextAutosave.flush();
              onOpenChange(false);
            }}
            data-slot="menu-item-modal-close"
          >
            {mode === "create" ? "Annuler" : "Fermer"}
          </Button>
          {mode === "create" ? (
            <Button
              type="button"
              data-slot="menu-item-modal-submit"
              onClick={handleCreate}
              disabled={!canCreate}
            >
              Créer
            </Button>
          ) : null}
        </div>
      </SheetFooter>

      {/* Delete confirmation dialog (mirror of category-list-editor pattern) */}
      {mode === "edit" && item !== undefined ? (
        <AlertDialog
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer « {item.name} » ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action est irréversible. La photo de l&apos;article et ses
                liens vers les groupes de personnalisations seront libérés
                automatiquement.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                data-slot="menu-item-modal-delete-confirm"
                onClick={handleDeleteConfirm}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                Confirmer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </div>
  );
}

/**
 * F-MENU-06 (#226) — Photo section: thumbnail SLOT (always rendered while
 * the section is mounted — placeholder when no photo, real <img> when the
 * URL resolves), file picker (`<input type="file" accept="image/*">`), and
 * a « Supprimer la photo » button that only surfaces when the item carries
 * a `photoStorageId` (the affordance is gated on the photo's existence so
 * the gérant never clicks « remove » on nothing).
 *
 * Replacement is the SAME path as upload: picking a new file fires
 * `onUploadPhoto`, which the page wires to `attachPhoto` — the backend's
 * `setTenantItemPhoto` invariant frees the previous blob in the same
 * mutation (no orphan, issue body « le backend libère l ancien blob »).
 *
 * URL resolution mirrors `item-list.tsx`: `useQuery(api.storage.getImageUrl)`
 * with `"skip"` when no storage id — we don't pay the round-trip for
 * photoless items. Convex's natural reactivity makes the thumbnail update
 * immediately after a successful upload (the underlying `items.list` query
 * refires with the new `photoStorageId`, the parent re-renders the modal
 * with the new item doc — see `editingItem` memo in `page.tsx`).
 */
function ItemPhotoSection({
  item,
  onUploadPhoto,
  onRemovePhoto,
}: {
  item: Doc<"menuItems">;
  onUploadPhoto: (itemId: Id<"menuItems">, file: File) => void;
  onRemovePhoto: (itemId: Id<"menuItems">) => void;
}) {
  // `"skip"` lets Convex bypass the query entirely when there's no storage
  // id (same pattern as `item-list.tsx` ItemThumbnail).
  const url = useQuery(
    api.storage.getImageUrl,
    item.photoStorageId === undefined
      ? "skip"
      : { storageId: item.photoStorageId },
  );
  const hasResolvedUrl = typeof url === "string" && url.length > 0;
  const hasPhoto = item.photoStorageId !== undefined;
  const inputId = `menu-item-modal-photo-input-${item._id}`;

  const handleChange = (e: { target: { files: FileList | null } }) => {
    const files = e.target.files;
    if (files === null || files.length === 0) return; // user cancelled the picker
    const file = files[0];
    onUploadPhoto(item._id, file);
  };

  return (
    <div
      data-slot="menu-item-modal-photo-section"
      className="flex flex-col gap-2"
    >
      <Label htmlFor={inputId}>Photo</Label>
      <div className="flex items-center gap-3">
        <div
          data-slot="menu-item-modal-photo-thumbnail"
          className="bg-muted text-muted-foreground flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md border"
        >
          {hasResolvedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={`Photo de ${item.name}`}
              className="size-full object-cover"
            />
          ) : (
            <IconPhoto className="size-8" aria-hidden="true" />
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <label
            htmlFor={inputId}
            className="border-input bg-background hover:bg-accent inline-flex cursor-pointer items-center gap-2 self-start rounded-md border px-3 py-1.5 text-sm font-medium"
          >
            <IconUpload className="size-4" aria-hidden="true" />
            {hasPhoto ? "Remplacer" : "Téléverser"}
          </label>
          {/* The native file input is visually hidden but still focusable via
              the label above (Radix-free, keyboard-accessible). */}
          <input
            id={inputId}
            data-slot="menu-item-modal-photo-input"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={handleChange}
          />
          {hasPhoto ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-slot="menu-item-modal-photo-remove"
              onClick={() => onRemovePhoto(item._id)}
              className="text-destructive hover:text-destructive self-start"
            >
              <IconTrash className="mr-1.5 size-4" aria-hidden="true" />
              Supprimer la photo
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * F-MENU-09 (#246) + Alex E2E manuel — Personnalisations section. UX refonte :
 * un SEUL composant unifié « tag multiselect » (chips inline + popover picker
 * + DnD reorder) qui remplace l'ancienne séquence « liste verticale + 2è
 * section picker ». Reporté par Alex en test E2E :
 *   « il faut utiliser un composant type multiselect avec les personalisations
 *   qui s'agrègent comme des tags, qu'on peut réordonner facilement avec du DnD »
 *
 * Deux modes :
 *  - CREATE — l'item n'a pas encore d'`_id` ; les chips reflètent
 *    `pendingAttachedGroupIds` (local state du form), résolus en `Doc<...>`
 *    via lookup dans `availableGroups`. Sur submit `onCreate`, la page chaine
 *    `attachGroupToItem(newItemId, gid)` pour chaque id.
 *  - EDIT — les chips reflètent `attachedGroups` (live Convex query). Picker
 *    selection / chip detach / chip reorder firent `onAttachGroup` /
 *    `onDetachGroup` / `onReorderGroups` côté backend immédiatement.
 *
 * Contenu d'un chip : LE NOM DU GROUPE UNIQUEMENT (« pas nécessairement un
 * supplément » — Alex E2E). PAS de badge min/max, PAS de mention « Supplément ».
 * Bouton × pour détacher (équivalent du « Détacher » d'avant). Grip handle
 * dnd-kit pour réordonner.
 *
 * Picker : popover avec input de recherche + liste filtrée des groupes
 * disponibles (= `availableGroups` MINUS chips déjà présents). Click sur une
 * option → l'ajoute aux chips + ferme le popover. Plain React (pas cmdk) pour
 * garder le tree testable sous `environment: "node"`.
 *
 * « Créer un nouveau groupe » : bouton outline persistant à côté de la zone
 * tags ; fire `onCreateInlineGroup(itemId | null)` selon le mode.
 */
function ModifiersSection({
  mode,
  item,
  attachedGroups,
  availableGroups,
  pendingAttachedGroupIds,
  setPendingAttachedGroupIds,
  onAttachGroup,
  onDetachGroup,
  onReorderGroups,
  onCreateInlineGroup,
}: {
  mode: "create" | "edit";
  item: Doc<"menuItems"> | undefined;
  attachedGroups: Doc<"modifierGroups">[] | undefined;
  availableGroups: Doc<"modifierGroups">[] | undefined;
  pendingAttachedGroupIds: Id<"modifierGroups">[];
  setPendingAttachedGroupIds: (
    next:
      | Id<"modifierGroups">[]
      | ((prev: Id<"modifierGroups">[]) => Id<"modifierGroups">[]),
  ) => void;
  onAttachGroup: (
    itemId: Id<"menuItems">,
    modifierGroupId: Id<"modifierGroups">,
  ) => void;
  onDetachGroup: (
    itemId: Id<"menuItems">,
    modifierGroupId: Id<"modifierGroups">,
  ) => void;
  onReorderGroups:
    | ((
        itemId: Id<"menuItems">,
        orderedGroupIds: Id<"modifierGroups">[],
      ) => void)
    | undefined;
  onCreateInlineGroup: (itemId: Id<"menuItems"> | null) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  // Lookup: `_id` → `Doc<"modifierGroups">`. Source of truth for chip render
  // names. The full tenant list (`availableGroups`) is the only place every
  // group is guaranteed to be — `attachedGroups` may not contain a freshly-
  // created group yet if the inline-create just landed.
  const groupById = useMemo(() => {
    const map = new Map<string, Doc<"modifierGroups">>();
    for (const g of availableGroups ?? []) {
      map.set(g._id as unknown as string, g);
    }
    // Defensive: edit-mode attached groups may include rows not in
    // `availableGroups` if the two queries paged differently — overlay them so
    // a chip never silently drops.
    for (const g of attachedGroups ?? []) {
      map.set(g._id as unknown as string, g);
    }
    return map;
  }, [availableGroups, attachedGroups]);

  // Resolve the chip set: edit mode reads from `attachedGroups` (sorted by
  // the edge `order`, ASC — handled backend-side by `listItemGroups`); create
  // mode reads from `pendingAttachedGroupIds` (the local order = the gérant's
  // intent). Both yield `Doc<"modifierGroups">` arrays — the chip render is
  // mode-agnostic.
  const chipGroups: Doc<"modifierGroups">[] = useMemo(() => {
    if (mode === "create") {
      return pendingAttachedGroupIds
        .map((id) => groupById.get(id as unknown as string))
        .filter((g): g is Doc<"modifierGroups"> => g !== undefined);
    }
    return attachedGroups ?? [];
  }, [mode, pendingAttachedGroupIds, attachedGroups, groupById]);

  const chipIds: Id<"modifierGroups">[] = useMemo(
    () => chipGroups.map((g) => g._id),
    [chipGroups],
  );

  // Picker source: full tenant set MINUS already-chipped ids. The backend
  // attach is idempotent (safety net); the filter is the UX-clarity layer.
  const chipIdSet = useMemo(
    () => new Set(chipIds as unknown as string[]),
    [chipIds],
  );
  const pickerSource = useMemo(() => {
    const candidates = (availableGroups ?? []).filter(
      (g) => !chipIdSet.has(g._id as unknown as string),
    );
    const q = pickerQuery.trim().toLowerCase();
    if (q === "") return candidates;
    return candidates.filter((g) => g.name.toLowerCase().includes(q));
  }, [availableGroups, chipIdSet, pickerQuery]);

  // Sensors mirror `category-list-editor.tsx` — pointer + keyboard sortable.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  // DnD reorder. CREATE: rewrite `pendingAttachedGroupIds`. EDIT: fire
  // `onReorderGroups` with the new ordered set (the page commits via the
  // `reorderItemGroups` mutation; Convex reactivity refires `listItemGroups`
  // with the new order).
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const activeId = active.id as Id<"modifierGroups">;
    const overId = over.id as Id<"modifierGroups">;
    const nextIds = reorderById(chipIds, activeId, overId);
    if (mode === "create") {
      setPendingAttachedGroupIds(nextIds);
      return;
    }
    if (item === undefined || onReorderGroups === undefined) return;
    onReorderGroups(item._id, nextIds);
  };

  // Attach a group. CREATE: push to local pending state. EDIT: fire backend.
  const handlePickGroup = (groupId: Id<"modifierGroups">) => {
    if (mode === "create") {
      setPendingAttachedGroupIds((prev) =>
        prev.includes(groupId) ? prev : [...prev, groupId],
      );
    } else if (item !== undefined) {
      onAttachGroup(item._id, groupId);
    }
    setPickerOpen(false);
    setPickerQuery("");
  };

  // Detach a chip. CREATE: drop from local pending state. EDIT: fire backend.
  const handleDetachChip = (groupId: Id<"modifierGroups">) => {
    if (mode === "create") {
      setPendingAttachedGroupIds((prev) => prev.filter((id) => id !== groupId));
    } else if (item !== undefined) {
      onDetachGroup(item._id, groupId);
    }
  };

  const inlineCreateTargetId: Id<"menuItems"> | null =
    mode === "edit" && item !== undefined ? item._id : null;

  // Loading sentinel — only meaningful in edit mode (CREATE has no Convex
  // round-trip to wait for: pending state starts at `[]`).
  const showLoading = mode === "edit" && attachedGroups === undefined;

  return (
    <div
      data-slot="menu-item-modal-modifiers-section"
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2">
        <Label>Personnalisations</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-slot="menu-item-modal-modifier-create-inline"
          onClick={() => onCreateInlineGroup(inlineCreateTargetId)}
        >
          <IconPlus className="mr-1.5 size-4" aria-hidden="true" />
          Créer un nouveau groupe
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Groupes d&apos;options réutilisables attachés à cet item. Cliquez sur la
        zone pour en ajouter, faites-les glisser pour réordonner.
      </p>

      {showLoading ? (
        <p
          data-slot="menu-item-modal-modifiers-loading"
          className="text-muted-foreground text-xs"
        >
          Chargement…
        </p>
      ) : (
        <ModifiersTagSelector
          chipGroups={chipGroups}
          chipIds={chipIds}
          pickerOpen={pickerOpen}
          setPickerOpen={setPickerOpen}
          pickerQuery={pickerQuery}
          setPickerQuery={setPickerQuery}
          pickerSource={pickerSource}
          availableGroups={availableGroups}
          sensors={sensors}
          onDragEnd={handleDragEnd}
          onPickGroup={handlePickGroup}
          onDetachChip={handleDetachChip}
          onOpenCreateInline={() => onCreateInlineGroup(inlineCreateTargetId)}
        />
      )}
    </div>
  );
}

/**
 * The unified tag multiselect itself — chips zone + popover picker + DnD. Pure
 * presentational : every state ref + handler is owned by the parent
 * `ModifiersSection` (so the create/edit branching stays in one place).
 *
 * Layout :
 *   - container with `border` styled like an input ;
 *   - each chip = a `SortableChip` (drag handle + name + ×) ;
 *   - a `+ ajouter` button at the end opens the popover ;
 *   - the popover contains a search input + filtered list of options (each
 *     a clickable row firing `onPickGroup`) OR an empty-state message.
 */
function ModifiersTagSelector({
  chipGroups,
  chipIds,
  pickerOpen,
  setPickerOpen,
  pickerQuery,
  setPickerQuery,
  pickerSource,
  availableGroups,
  sensors,
  onDragEnd,
  onPickGroup,
  onDetachChip,
  onOpenCreateInline,
}: {
  chipGroups: Doc<"modifierGroups">[];
  chipIds: Id<"modifierGroups">[];
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  pickerQuery: string;
  setPickerQuery: (q: string) => void;
  pickerSource: Doc<"modifierGroups">[];
  availableGroups: Doc<"modifierGroups">[] | undefined;
  sensors: ReturnType<typeof useSensors>;
  onDragEnd: (event: DragEndEvent) => void;
  onPickGroup: (groupId: Id<"modifierGroups">) => void;
  onDetachChip: (groupId: Id<"modifierGroups">) => void;
  onOpenCreateInline: () => void;
}) {
  const hasChips = chipGroups.length > 0;
  // `availableGroups === undefined` means the tenant query is still loading
  // (CREATE mode just-opened, no fetch yet for the picker source). When
  // there's nothing in the tenant at all, the empty-state nudges the gérant
  // toward the inline create.
  const tenantEmpty =
    Array.isArray(availableGroups) && availableGroups.length === 0;
  const noMoreToPick =
    Array.isArray(availableGroups) &&
    pickerSource.length === 0 &&
    pickerQuery.trim() === "" &&
    !tenantEmpty;
  const noSearchResult =
    Array.isArray(availableGroups) &&
    pickerSource.length === 0 &&
    pickerQuery.trim() !== "";

  return (
    <div
      data-slot="menu-item-modal-modifier-tag-selector"
      className="border-input bg-background focus-within:ring-ring/50 flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border p-1.5 focus-within:ring-[3px]"
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={chipIds as unknown as string[]}
          strategy={horizontalListSortingStrategy}
        >
          {chipGroups.map((group) => (
            <SortableModifierChip
              key={group._id}
              group={group}
              onDetach={() => onDetachChip(group._id)}
            />
          ))}
        </SortableContext>
      </DndContext>
      {/* Trigger : « + ajouter ». Always present so the gérant has a stable
          affordance even with zero chips (no « cliquez dans la zone » mystery). */}
      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            data-slot="menu-item-modal-modifier-picker-trigger"
            className="text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs font-medium"
          >
            <IconPlus className="size-3.5" aria-hidden="true" />
            {hasChips ? "Ajouter" : "Ajouter une personnalisation"}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 p-0"
          data-slot="menu-item-modal-modifier-picker-popover"
        >
          <div className="border-b p-2">
            <Input
              data-slot="menu-item-modal-modifier-picker-input"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Rechercher un groupe…"
              autoFocus
              className="h-8"
            />
          </div>
          <div
            data-slot="menu-item-modal-modifier-picker-list"
            className="max-h-56 overflow-y-auto p-1"
          >
            {pickerSource.length > 0 ? (
              pickerSource.map((group) => (
                <button
                  type="button"
                  key={group._id}
                  data-slot="menu-item-modal-modifier-picker-option"
                  data-group-id={group._id as unknown as string}
                  className="hover:bg-accent flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm"
                  onClick={() => onPickGroup(group._id)}
                >
                  <span className="truncate">{group.name}</span>
                </button>
              ))
            ) : tenantEmpty ? (
              <div
                data-slot="menu-item-modal-modifier-picker-empty"
                className="flex flex-col gap-2 p-2 text-xs"
              >
                <p className="text-muted-foreground">
                  Aucun groupe disponible. Créez-en un pour commencer.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setPickerOpen(false);
                    onOpenCreateInline();
                  }}
                  data-slot="menu-item-modal-modifier-picker-empty-create"
                >
                  <IconPlus className="mr-1.5 size-4" aria-hidden="true" />
                  Créer un nouveau groupe
                </Button>
              </div>
            ) : noMoreToPick ? (
              <p
                data-slot="menu-item-modal-modifier-picker-empty"
                className="text-muted-foreground p-2 text-xs"
              >
                Tous les groupes du tenant sont déjà attachés.
              </p>
            ) : noSearchResult ? (
              <p
                data-slot="menu-item-modal-modifier-picker-empty"
                className="text-muted-foreground p-2 text-xs"
              >
                Aucun résultat.
              </p>
            ) : (
              // availableGroups undefined (loading sentinel) — keep layout
              // stable rather than flashing a misleading « empty » message.
              <p
                data-slot="menu-item-modal-modifier-picker-loading"
                className="text-muted-foreground p-2 text-xs"
              >
                Chargement…
              </p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * One sortable chip — grip handle (drag activator) + group name + × (detach).
 * Mirror of the `SortableCategoryRow` pattern (`useSortable`, handle = drag
 * activator so the × stays clickable without triggering a drag).
 */
function SortableModifierChip({
  group,
  onDetach,
}: {
  group: Doc<"modifierGroups">;
  onDetach: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: group._id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <span
      ref={setNodeRef}
      style={style}
      data-slot="menu-item-modal-modifier-tag"
      data-group-id={group._id as unknown as string}
      className="bg-muted text-foreground inline-flex items-center gap-1 rounded-full pl-1 pr-2 py-1 text-xs font-medium"
    >
      <button
        type="button"
        data-slot="menu-item-modal-modifier-tag-drag-handle"
        aria-label={`Réordonner ${group.name}`}
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none rounded-full p-0.5 outline-none focus-visible:ring-2 active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <IconGripVertical className="size-3" aria-hidden="true" />
      </button>
      <span className="truncate">{group.name}</span>
      <button
        type="button"
        data-slot="menu-item-modal-modifier-tag-detach"
        data-group-id={group._id as unknown as string}
        aria-label={`Détacher ${group.name}`}
        onClick={onDetach}
        className="text-muted-foreground hover:text-destructive rounded-full p-0.5 outline-none focus-visible:ring-2"
      >
        <IconX className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}
