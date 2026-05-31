"use client";

/**
 * F-MENU-08 (#242) — `ModifierGroupModal`, the CRUD surface for a REUSABLE
 * [[Personnalisations]] group (CONTEXT kb-admin « Personnalisations » :
 * groupes réutilisables attachés aux items via lien N-N, model Uber Eats).
 *
 * REUSABLE (per the backend head-comment in `packages/backend/convex/lib/menu/modifiers.ts`):
 * a group is created ONCE (`createGroup`) and attached to N items via
 * `attachGroupToItem`. Because the link references the group BY ID,
 * `updateGroup` reflects on EVERY linked item with a single write — no
 * per-item copy. The modal makes this safety load-bearing by surfacing the
 * impact panel (items that will see the edit) BEFORE the user commits.
 *
 * Two modes, ONE component (DRY — same form, same validation, same fields):
 *   - `mode === "create"` — opened by the « + Personnalisation » CTA in
 *     `ModifierGroupsSection`. One explicit « Créer » button calls `onCreate`
 *     with the full payload. NO delete button (nothing exists yet). Defaults
 *     pre-fill the bounds at the lowest legal pair (minSelect=0, maxSelect=1
 *     → « optional, single-choice » — the gérant only has to type a name to
 *     submit).
 *   - `mode === "edit"` — opened by the edit affordance on a row. Pre-fills
 *     every field from the group doc. NO autosave (a reusable group edit
 *     reflects on N items; the gérant must confirm by clicking « Sauvegarder »,
 *     load-bearing safety vs. a debounce that races itself across siblings).
 *     Delete button gated by a confirmation `AlertDialog` listing the impact
 *     items (« sera détaché de X items »).
 *
 * Validation contract (LOCAL guard before mutation — mirror of
 * `assertGroupBounds` in `packages/backend/convex/lib/menu/modifiers.ts`):
 *   - `minSelect` ≥ 0 (integer),
 *   - `maxSelect` ≥ 1 (integer),
 *   - `maxSelect` ≥ max(1, minSelect) (#106-d — never unsatisfiable),
 *   - every option `priceDelta` ≥ 0 centimes (no discount V1).
 * Invalid bounds disable the submit + surface an inline bounds-error
 * (`data-slot="menu-modifier-modal-bounds-error"`); invalid option prices
 * surface a per-row error (`data-slot="menu-modifier-modal-option-price-error"`).
 * Any backend bypass still surfaces as a `toast.error(getConvexErrorMessage(...))`
 * at the page level (« message clair dérivé de INVALID_MODIFIER », AC6).
 *
 * Impact panel (issue body « Avant édit/suppression, afficher la liste des
 * items qui réutilisent ce groupe »): when the page resolves `listGroupItems`
 * and threads the result down via `impactItems`, the modal surfaces a panel
 * listing every item name in EDIT mode (so the gérant knows the edit will
 * reflect on N items) AND inside the delete confirmation. The impact list is
 * the page's responsibility to keep fresh (Convex reactivity).
 *
 * Scope discipline (#242): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/menu/` — zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */

import { useMemo, useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";

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

/** A draft option row — same shape as the backend `modifierOption` validator. */
type OptionDraft = { label: string; priceDelta: number };

/** Payload sent to `api.lib.menu.modifiers.createGroup`. */
export type ModifierGroupCreatePayload = {
  name: string;
  minSelect: number;
  maxSelect: number;
  options: OptionDraft[];
};

/** Payload sent to `api.lib.menu.modifiers.updateGroup`. */
export type ModifierGroupUpdatePayload = ModifierGroupCreatePayload;

export type ModifierGroupModalProps = {
  mode: "create" | "edit";
  /** Controlled open flag — owned by the page so the modal can close after a successful create. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit mode only — the group being edited. Undefined in create mode. */
  group?: Doc<"modifierGroups">;
  /**
   * Edit mode only — the items that REUSE this group, resolved by the page
   * through `api.lib.menu.modifiers.listGroupItems`. The modal surfaces
   * every item name in the impact panel + the delete confirmation. When
   * `undefined` (query still in flight), no impact panel renders; when `[]`,
   * the modal surfaces a « groupe non utilisé » message in the confirmation
   * so the gérant knows nothing will be detached.
   */
  impactItems?: Doc<"menuItems">[];
  /** Create-mode commit. Fires once on the « Créer » button click. */
  onCreate: (payload: ModifierGroupCreatePayload) => void;
  /** Edit-mode commit. Fires once on the « Sauvegarder » button click. */
  onUpdate: (
    groupId: Id<"modifierGroups">,
    payload: ModifierGroupUpdatePayload,
  ) => void;
  /** Edit-mode delete. Fires from the confirmation dialog's « Confirmer » action. */
  onDelete: (groupId: Id<"modifierGroups">) => void;
};

/** Default new-option row (label empty, priceDelta=0 → the « offert » case). */
const EMPTY_OPTION: OptionDraft = { label: "", priceDelta: 0 };

/**
 * Pre-fill the lowest-legal bounds for create mode: `minSelect=0`, `maxSelect=1`
 * — the « optional, single-choice » group. Both satisfy `min ≥ 0`, `max ≥ 1`,
 * `max ≥ max(1, min) = 1`. A gérant only has to type a name to submit.
 */
const CREATE_DEFAULT_MIN = 0;
const CREATE_DEFAULT_MAX = 1;

export function ModifierGroupModal(props: ModifierGroupModalProps) {
  const { mode, open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="menu-modifier-modal">
        <DialogHeader>
          <DialogTitle>
            {mode === "create"
              ? "Nouvelle personnalisation"
              : "Éditer la personnalisation"}
          </DialogTitle>
          <DialogDescription>
            {mode === "create"
              ? "Créez un groupe d'options réutilisable (ex. « Sauce », « Suppléments »)."
              : "Modifiez ce groupe. Les changements s'appliqueront à tous les items qui le réutilisent."}
          </DialogDescription>
        </DialogHeader>
        <ModifierGroupForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function ModifierGroupForm({
  mode,
  group,
  impactItems,
  onOpenChange,
  onCreate,
  onUpdate,
  onDelete,
}: ModifierGroupModalProps) {
  // -- Local form state ------------------------------------------------------
  const [name, setName] = useState<string>(group?.name ?? "");
  const [minSelect, setMinSelect] = useState<number>(
    group?.minSelect ?? CREATE_DEFAULT_MIN,
  );
  const [maxSelect, setMaxSelect] = useState<number>(
    group?.maxSelect ?? CREATE_DEFAULT_MAX,
  );
  const [options, setOptions] = useState<OptionDraft[]>(
    group?.options.map((o) => ({ label: o.label, priceDelta: o.priceDelta })) ??
      [],
  );
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // -- Validation -----------------------------------------------------------
  // Mirror of the backend's `assertGroupBounds`. Splitting into « bounds »
  // vs. « per-option » errors so we can surface each next to its own field.
  const boundsError = useMemo<string | null>(() => {
    if (!Number.isInteger(minSelect) || minSelect < 0) {
      return "Le minimum doit être un entier ≥ 0.";
    }
    if (!Number.isInteger(maxSelect) || maxSelect < 1) {
      return "Le maximum doit être un entier ≥ 1.";
    }
    if (maxSelect < Math.max(1, minSelect)) {
      return "Le maximum doit être ≥ au minimum (et ≥ 1).";
    }
    return null;
  }, [minSelect, maxSelect]);

  const optionPriceErrors = useMemo<Array<string | null>>(
    () =>
      options.map((o) => {
        if (!Number.isInteger(o.priceDelta) || o.priceDelta < 0) {
          return "Le supplément doit être un entier ≥ 0 (en centimes).";
        }
        return null;
      }),
    [options],
  );
  const hasAnyOptionPriceError = optionPriceErrors.some((e) => e !== null);

  // -- Option-row handlers ---------------------------------------------------
  const handleAddOption = () => {
    setOptions([...options, { ...EMPTY_OPTION }]);
  };
  const handleRemoveOption = (index: number) => {
    setOptions(options.filter((_, i) => i !== index));
  };
  const handleOptionLabel = (index: number, label: string) => {
    setOptions(options.map((o, i) => (i === index ? { ...o, label } : o)));
  };
  const handleOptionPrice = (index: number, raw: string) => {
    // Parse euros input → centimes integer. We keep the same UX as the item
    // modal (locale-friendly decimal separator) but only forward valid integers
    // to state; an invalid keystroke leaves the previous valid value (no
    // « NaN » in the model). Empty input → 0 (the « gratuit » case).
    const trimmed = raw.trim().replace(",", ".");
    if (trimmed === "") {
      setOptions(
        options.map((o, i) => (i === index ? { ...o, priceDelta: 0 } : o)),
      );
      return;
    }
    const euros = Number(trimmed);
    if (!Number.isFinite(euros)) return;
    // Round to nearest centime to avoid float-noise (1.10 -> 110).
    const centimes = Math.round(euros * 100);
    setOptions(
      options.map((o, i) => (i === index ? { ...o, priceDelta: centimes } : o)),
    );
  };

  // -- Bounds handlers (the inputs are typed; we coerce strictly) ------------
  const handleMinChange = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setMinSelect(Math.trunc(n));
  };
  const handleMaxChange = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    setMaxSelect(Math.trunc(n));
  };

  // -- Submit ----------------------------------------------------------------
  const canSubmit =
    name.trim().length > 0 && boundsError === null && !hasAnyOptionPriceError;

  const buildPayload = (): ModifierGroupCreatePayload => ({
    name: name.trim(),
    minSelect,
    maxSelect,
    options: options.map((o) => ({
      label: o.label.trim(),
      priceDelta: o.priceDelta,
    })),
  });

  const handleSubmit = () => {
    if (!canSubmit) return;
    const payload = buildPayload();
    if (mode === "create") {
      onCreate(payload);
      return;
    }
    if (group !== undefined) {
      onUpdate(group._id, payload);
    }
  };

  const handleDeleteConfirm = () => {
    if (group === undefined) return;
    onDelete(group._id);
    setConfirmDeleteOpen(false);
    onOpenChange(false);
  };

  // -- Display euros from centimes (mirror of item-modal) --------------------
  const displayPrice = (centimes: number): string => {
    const euros = centimes / 100;
    if (Number.isInteger(euros)) return String(euros);
    return String(euros);
  };

  // -- Impact panel (edit mode only) -----------------------------------------
  // Rendered when the page has resolved listGroupItems AND there is at least
  // ONE item — surfaces « réutilisé par X items » so the gérant knows the
  // edit will reflect on N items before committing.
  const showImpactPanel =
    mode === "edit" && impactItems !== undefined && impactItems.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Name */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="menu-modifier-modal-name">Nom du groupe</Label>
        <Input
          id="menu-modifier-modal-name"
          data-slot="menu-modifier-modal-name-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Sauce, Suppléments, Cuisson…"
        />
      </div>

      {/* Bounds */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="menu-modifier-modal-min-select">
            Minimum à choisir
          </Label>
          <Input
            id="menu-modifier-modal-min-select"
            data-slot="menu-modifier-modal-min-select-input"
            type="number"
            min={0}
            step={1}
            value={minSelect}
            onChange={(e) => handleMinChange(e.target.value)}
          />
          <p className="text-muted-foreground text-xs">
            0 = optionnel · ≥ 1 = obligatoire
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="menu-modifier-modal-max-select">
            Maximum à choisir
          </Label>
          <Input
            id="menu-modifier-modal-max-select"
            data-slot="menu-modifier-modal-max-select-input"
            type="number"
            min={1}
            step={1}
            value={maxSelect}
            onChange={(e) => handleMaxChange(e.target.value)}
            aria-invalid={boundsError !== null || undefined}
          />
          <p className="text-muted-foreground text-xs">
            1 = choix unique · &gt; 1 = multi-choix
          </p>
        </div>
      </div>
      {boundsError !== null ? (
        <p
          data-slot="menu-modifier-modal-bounds-error"
          className="text-destructive text-xs"
        >
          {boundsError}
        </p>
      ) : null}

      {/* Options */}
      <div className="flex flex-col gap-2">
        <Label>Options</Label>
        <p className="text-muted-foreground text-xs">
          Chaque option a un libellé et un supplément en euros (≥ 0, jamais de
          remise).
        </p>
        <div
          className="flex flex-col gap-2"
          data-slot="menu-modifier-modal-options-list"
        >
          {options.map((opt, index) => {
            const priceErr = optionPriceErrors[index];
            return (
              <div
                key={index}
                data-slot="menu-modifier-modal-option-row"
                className="flex flex-col gap-1"
              >
                <div className="flex items-center gap-2">
                  <Input
                    data-slot="menu-modifier-modal-option-label-input"
                    value={opt.label}
                    onChange={(e) => handleOptionLabel(index, e.target.value)}
                    placeholder="Ketchup, Bacon, +1 œuf…"
                    className="flex-1"
                    aria-label={`Libellé de l'option ${index + 1}`}
                  />
                  <Input
                    data-slot="menu-modifier-modal-option-price-input"
                    type="text"
                    inputMode="decimal"
                    value={displayPrice(opt.priceDelta)}
                    onChange={(e) => handleOptionPrice(index, e.target.value)}
                    placeholder="0"
                    className="w-24"
                    aria-label={`Supplément de l'option ${index + 1}`}
                    aria-invalid={priceErr !== null || undefined}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-slot="menu-modifier-modal-option-remove"
                    onClick={() => handleRemoveOption(index)}
                    aria-label={`Supprimer l'option ${index + 1}`}
                  >
                    <IconTrash className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                {priceErr !== null ? (
                  <p
                    data-slot="menu-modifier-modal-option-price-error"
                    className="text-destructive text-xs"
                  >
                    {priceErr}
                  </p>
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-slot="menu-modifier-modal-option-add"
            onClick={handleAddOption}
          >
            <IconPlus className="mr-2 size-4" aria-hidden="true" />
            Ajouter une option
          </Button>
        </div>
      </div>

      {/* Impact panel — edit mode only, when the page has resolved the list */}
      {showImpactPanel && impactItems !== undefined ? (
        <div
          data-slot="menu-modifier-modal-impact"
          className="rounded-md border border-dashed p-3 text-sm"
        >
          <p className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
            Réutilisé par {impactItems.length} item
            {impactItems.length > 1 ? "s" : ""}
          </p>
          <ul className="list-inside list-disc">
            {impactItems.map((it) => (
              <li key={it._id}>{it.name}</li>
            ))}
          </ul>
          <p className="text-muted-foreground mt-2 text-xs">
            Toute modification s&apos;appliquera à ces items.
          </p>
        </div>
      ) : null}

      <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
        {/* Delete (edit mode only), confirmation-gated */}
        <div>
          {mode === "edit" && group !== undefined ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-slot="menu-modifier-modal-delete"
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
            onClick={() => onOpenChange(false)}
            data-slot="menu-modifier-modal-close"
          >
            {mode === "create" ? "Annuler" : "Fermer"}
          </Button>
          <Button
            type="button"
            data-slot="menu-modifier-modal-submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
          >
            {mode === "create" ? "Créer" : "Sauvegarder"}
          </Button>
        </div>
      </DialogFooter>

      {/* Delete confirmation — surfaces the impact list so the gérant knows
          which items will be detached. The cascade itself (drop the N-N edges,
          NOT the items) happens backend-side in `removeGroup`. */}
      {mode === "edit" && group !== undefined ? (
        <AlertDialog
          open={confirmDeleteOpen}
          onOpenChange={setConfirmDeleteOpen}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer « {group.name} » ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action est irréversible. Les items qui réutilisent ce
                groupe le perdront mais ne seront pas supprimés.
              </AlertDialogDescription>
            </AlertDialogHeader>
            {impactItems !== undefined ? (
              <div
                data-slot="menu-modifier-modal-delete-impact"
                className="text-sm"
              >
                {impactItems.length === 0 ? (
                  <p className="text-muted-foreground">
                    Aucun item ne réutilise ce groupe actuellement.
                  </p>
                ) : (
                  <>
                    <p className="mb-1 font-medium">
                      Sera détaché de {impactItems.length} item
                      {impactItems.length > 1 ? "s" : ""} :
                    </p>
                    <ul className="list-inside list-disc">
                      {impactItems.map((it) => (
                        <li key={it._id}>{it.name}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                data-slot="menu-modifier-modal-delete-confirm"
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
