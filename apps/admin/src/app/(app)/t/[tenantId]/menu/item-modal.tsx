"use client";

/**
 * F-MENU-05 (#219) + F-MENU-06 (#226) — `ItemModal`, the load-bearing CRUD
 * surface for menu items.
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
 * Scope discipline (#219 / #226 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/` — zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import {
  IconLink,
  IconLinkOff,
  IconPhoto,
  IconPlus,
  IconTrash,
  IconUpload,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

import { parsePriceEuros, type ParsedPrice } from "./parse-price";
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

/** Payload sent to `api.lib.menu.items.create` from the « Créer » action. */
export type ItemCreatePayload = {
  categoryId: Id<"menuCategories">;
  name: string;
  description: string;
  basePrice: number;
  allergens: Allergen[];
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
   * F-MENU-09 (#246) — fired when the gérant clicks « Créer un nouveau
   * groupe ». The page handles stacking the `ModifierGroupModal` over the
   * item modal (issue body « ouvre la modale groupe (F-MENU-08) par-dessus
   * la modale item ») AND chaining `attachGroupToItem({ itemId, modifierGroupId })`
   * once `createGroup` resolves (« à la confirmation, attache automatiquement
   * le nouveau groupe à l item courant »). The modal here just fires the
   * open intent — keeping the cross-modal state on the page is what makes
   * the stacking robust to a successful create (the page closes the group
   * modal but keeps the item modal open).
   */
  onCreateInlineGroup?: (itemId: Id<"menuItems">) => void;
};

export function ItemModal(props: ItemModalProps) {
  const { mode, open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="menu-item-modal">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? "Nouvel item" : "Éditer l'item"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Ajoutez un nouvel article à votre menu."
              : "Modifiez les informations de l'article. Les changements sont enregistrés automatiquement."}
          </DialogDescription>
        </DialogHeader>
        <ItemModalForm {...props} />
      </DialogContent>
    </Dialog>
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
  onAttachGroup,
  onDetachGroup,
  onCreateInlineGroup,
}: ItemModalProps) {
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
    <div className="flex flex-col gap-4">
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

      {/* Personnalisations — F-MENU-09 (#246). Edit mode only AND wired only
          when the page passes the three Personnalisations handlers (slice
          OPT-IN to preserve the F-MENU-05/06/08 contracts: callers from the
          previous slices don't pass these). The section surfaces three
          affordances on the issue body's (a/b/c):
            (a) the list of REUSABLE groups currently attached to the item
                (name + min/max + options summary + « Détacher »);
            (b) a picker over the tenant's full `availableGroups` MINUS the
                already-attached set — selecting one fires `onAttachGroup`;
            (c) a « Créer un nouveau groupe » button that fires
                `onCreateInlineGroup(itemId)` — the page handles stacking
                the modifier-group modal on top + auto-attaching on save. */}
      {mode === "edit" &&
      item !== undefined &&
      onAttachGroup !== undefined &&
      onDetachGroup !== undefined &&
      onCreateInlineGroup !== undefined ? (
        <ModifiersSection
          item={item}
          attachedGroups={attachedGroups}
          availableGroups={availableGroups}
          onAttachGroup={onAttachGroup}
          onDetachGroup={onDetachGroup}
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

      <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
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
      </DialogFooter>

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
 * F-MENU-09 (#246) — Personnalisations section: the attach / detach / create-
 * inline surface for REUSABLE modifier groups on ONE item.
 *
 * Three affordances mirror the issue body:
 *   (a) `attachedGroups` rows — each row carries the group name, a min/max
 *       badge (« 1/1 », « 0/3 »…), a short option summary, and a « Détacher »
 *       button that fires `onDetachGroup(itemId, groupId)`. The backend
 *       `detachGroupFromItem` removes ONE edge (siblings + group untouched —
 *       issue body « n affecte ni le groupe ni les autres items »).
 *   (b) a picker built over `availableGroups MINUS attachedGroups`: each
 *       remaining group is exposed as a clickable row that fires
 *       `onAttachGroup(itemId, groupId)`. Idempotency is the SAFETY net
 *       (re-attach = no-op backend-side); the filter keeps the affordance
 *       from offering an obvious no-op. We use a plain text-input filter
 *       (no Base UI / Radix Combobox) so the testable surface stays a flat
 *       React tree under the lean `node` test env.
 *   (c) a « Créer un nouveau groupe » button that fires
 *       `onCreateInlineGroup(itemId)`. The page handles stacking the
 *       `ModifierGroupModal` over the item modal AND auto-attaching the
 *       newly-created group to the originating item (pinned by `page.test.ts`).
 *
 * Layout: a single section after the photo block and before the allergens
 * checkboxes — same data-slot discipline as the rest of the modal.
 */
function ModifiersSection({
  item,
  attachedGroups,
  availableGroups,
  onAttachGroup,
  onDetachGroup,
  onCreateInlineGroup,
}: {
  item: Doc<"menuItems">;
  attachedGroups: Doc<"modifierGroups">[] | undefined;
  availableGroups: Doc<"modifierGroups">[] | undefined;
  onAttachGroup: (
    itemId: Id<"menuItems">,
    modifierGroupId: Id<"modifierGroups">,
  ) => void;
  onDetachGroup: (
    itemId: Id<"menuItems">,
    modifierGroupId: Id<"modifierGroups">,
  ) => void;
  onCreateInlineGroup: (itemId: Id<"menuItems">) => void;
}) {
  const [pickerQuery, setPickerQuery] = useState("");

  // Filter the picker source: full available set MINUS already-attached ids.
  // Idempotent backend (issue body « ré-attacher = no-op ») — this filter
  // is the UX-clarity layer, not the safety net.
  const attachedIds = useMemo(
    () => new Set((attachedGroups ?? []).map((g) => g._id)),
    [attachedGroups],
  );
  const pickerSource = useMemo(() => {
    const candidates = (availableGroups ?? []).filter(
      (g) => !attachedIds.has(g._id),
    );
    const q = pickerQuery.trim().toLowerCase();
    if (q === "") return candidates;
    return candidates.filter((g) => g.name.toLowerCase().includes(q));
  }, [availableGroups, attachedIds, pickerQuery]);

  const hasAttached =
    Array.isArray(attachedGroups) && attachedGroups.length > 0;

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
          onClick={() => onCreateInlineGroup(item._id)}
        >
          <IconPlus className="mr-1.5 size-4" aria-hidden="true" />
          Créer un nouveau groupe
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        Groupes d&apos;options réutilisables attachés à cet item (édité une
        fois, répercuté partout).
      </p>

      {/* (a) Attached rows OR empty state. */}
      {hasAttached ? (
        <div className="flex flex-col gap-2">
          {(attachedGroups ?? []).map((group) => (
            <AttachedGroupRow
              key={group._id}
              group={group}
              onDetach={() => onDetachGroup(item._id, group._id)}
            />
          ))}
        </div>
      ) : attachedGroups === undefined ? (
        // Loading sentinel — Convex returns undefined while listItemGroups
        // is in flight. Keep the layout stable so the section doesn't pop.
        <p
          data-slot="menu-item-modal-modifiers-loading"
          className="text-muted-foreground text-xs"
        >
          Chargement…
        </p>
      ) : (
        <div
          data-slot="menu-item-modal-modifiers-empty"
          className="text-muted-foreground rounded-md border border-dashed p-3 text-center text-xs"
        >
          Aucun groupe attaché à cet item pour le moment.
        </div>
      )}

      {/* (b) Picker — autocomplete on availableGroups MINUS attached. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`menu-item-modal-modifier-picker-${item._id}`}>
          Ajouter un groupe existant
        </Label>
        <Input
          id={`menu-item-modal-modifier-picker-${item._id}`}
          data-slot="menu-item-modal-modifier-picker-input"
          value={pickerQuery}
          onChange={(e) => setPickerQuery(e.target.value)}
          placeholder="Rechercher un groupe…"
        />
        {pickerSource.length > 0 ? (
          <div
            data-slot="menu-item-modal-modifier-picker-list"
            className="max-h-48 overflow-y-auto rounded-md border"
          >
            {pickerSource.map((group) => (
              <button
                type="button"
                key={group._id}
                data-slot="menu-item-modal-modifier-picker-option"
                data-group-id={group._id as unknown as string}
                className="hover:bg-accent flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm"
                onClick={() => onAttachGroup(item._id, group._id)}
              >
                <span className="flex flex-col">
                  <span className="font-medium">{group.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {summariseBoundsBadge(group.minSelect, group.maxSelect)} ·{" "}
                    {group.options.length} option
                    {group.options.length > 1 ? "s" : ""}
                  </span>
                </span>
                <IconLink className="size-4" aria-hidden="true" />
              </button>
            ))}
          </div>
        ) : (
          <p
            data-slot="menu-item-modal-modifier-picker-empty"
            className="text-muted-foreground text-xs"
          >
            {(availableGroups ?? []).length === attachedIds.size
              ? "Tous les groupes du tenant sont déjà attachés."
              : "Aucun groupe ne correspond à la recherche."}
          </p>
        )}
      </div>
    </div>
  );
}

/** Mini-row for an attached group — name + min/max badge + options summary + Détacher. */
function AttachedGroupRow({
  group,
  onDetach,
}: {
  group: Doc<"modifierGroups">;
  onDetach: () => void;
}) {
  return (
    <div
      data-slot="menu-item-modal-modifier-attached-row"
      data-group-id={group._id as unknown as string}
      className="flex items-center justify-between gap-2 rounded-md border p-2"
    >
      <div className="flex min-w-0 flex-col">
        <span className="flex items-center gap-2 text-sm font-medium">
          <span className="truncate">{group.name}</span>
          <span
            data-slot="menu-item-modal-modifier-attached-bounds"
            className="bg-muted text-muted-foreground rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
          >
            {group.minSelect}/{group.maxSelect}
          </span>
        </span>
        <span className="text-muted-foreground truncate text-xs">
          {summariseOptions(group.options)}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-slot="menu-item-modal-modifier-detach"
        onClick={onDetach}
        className="text-muted-foreground hover:text-destructive"
        aria-label={`Détacher le groupe ${group.name}`}
      >
        <IconLinkOff className="mr-1.5 size-4" aria-hidden="true" />
        Détacher
      </Button>
    </div>
  );
}

/**
 * Same heuristic as `modifier-groups-section.tsx::summariseBounds`, but kept
 * short for the per-row badge in the item modal. We KEEP both numbers visible
 * (« 1/1 » badge) AND a textual paraphrase next to it for accessibility —
 * tested by `item-modal.test.tsx` which accepts either form.
 */
function summariseBoundsBadge(minSelect: number, maxSelect: number): string {
  if (minSelect === 0 && maxSelect === 1) return "choix unique optionnel";
  if (minSelect === 0) return `jusqu'à ${maxSelect} (optionnel)`;
  if (minSelect === maxSelect && minSelect === 1)
    return "choix unique obligatoire";
  if (minSelect === maxSelect) return `exactement ${minSelect}`;
  return `entre ${minSelect} et ${maxSelect}`;
}

/** Compact options summary — first 2 labels + « +N » when there are more. */
function summariseOptions(options: Doc<"modifierGroups">["options"]): string {
  if (options.length === 0) return "Aucune option";
  const labels = options.map((o) => o.label).filter((l) => l.trim() !== "");
  if (labels.length === 0) return `${options.length} option(s)`;
  if (labels.length <= 2) return labels.join(", ");
  return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}
