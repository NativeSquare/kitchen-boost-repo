"use client";

/**
 * F-MENU-05 (#219) — `ItemModal`, the load-bearing CRUD surface for menu items.
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
 * Scope discipline (#219 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/` — zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import { useEffect, useMemo, useState } from "react";
import { IconTrash } from "@tabler/icons-react";

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
