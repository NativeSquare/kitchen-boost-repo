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

import { parsePriceEuros, type ParsedPrice } from "./parse-price";

/** A draft option row — same shape as the backend `modifierOption` validator. */
type OptionDraft = { label: string; priceDelta: number };

/**
 * Centimes → French euro input string (« 50 » → « 0,50 », « 1290 » → « 12,90 »).
 *
 * Pre-fills the editable « supplément » input in EDIT mode and seeds new
 * option rows to « 0,00 » so the gérant always sees an euro-shaped value (Alex
 * E2E manuel — « il faut que les prix apparaissent bien en Euros avec option
 * de gérer les centimes d'euros (2 décimales) »). Always renders 2 decimals
 * with the FR comma separator — the round-trip `parsePriceEuros` accepts it.
 *
 * Negative input is preserved as a leading « - » so a contract violation
 * (`priceDelta < 0` arriving from the wire) surfaces in the input AND triggers
 * the inline error via `parsePriceEuros` (`{ ok: false, reason: "negative" }`).
 */
function centimesToEuroInput(centimes: number): string {
  if (!Number.isFinite(centimes)) return "0,00";
  const negative = centimes < 0;
  const abs = Math.abs(Math.round(centimes));
  const euros = Math.floor(abs / 100);
  const cents = abs % 100;
  const fractional = cents.toString().padStart(2, "0");
  return `${negative ? "-" : ""}${euros},${fractional}`;
}

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

/**
 * Local draft row — same shape as `OptionDraft` PLUS a `priceInput` string
 * (the raw text the gérant types). We keep BOTH `priceInput` and `priceDelta`
 * in state because (a) the input is uncontrolled-feeling (locale-friendly,
 * comma OR dot accepted, lets the user type a half-formed « 12, » without
 * the model wiping it) and (b) the payload sent to the backend MUST be the
 * parsed centimes integer. `priceDelta` is recomputed by `parsePriceEuros`
 * on every keystroke so the submit path always reads a fresh value.
 */
type OptionRow = { label: string; priceInput: string; priceDelta: number };

/** Default new-option row (« offert » case — « 0,00 € » so the gérant sees the unit). */
const EMPTY_OPTION_ROW: OptionRow = {
  label: "",
  priceInput: "0,00",
  priceDelta: 0,
};

/**
 * Map a `ParsedPrice` failure to the user-facing French message — strict
 * mirror of the item-modal price-error vocabulary (F-MENU-05 #219) so a
 * gérant who learns the wording on item « Prix » recognises it instantly on a
 * modifier option « Supplément ». The « empty » branch is intentionally
 * unreachable here (caller short-circuits on empty input = 0 cents) but kept
 * exhaustive for the type checker.
 */
function priceErrorMessage(
  parsed: Extract<ParsedPrice, { ok: false }>,
): string {
  switch (parsed.reason) {
    case "negative":
      return "Le supplément doit être positif ou nul.";
    case "fraction":
      return "Le supplément accepte au maximum 2 décimales (centimes).";
    case "format":
      return "Format invalide (ex. 1,50).";
    case "empty":
      return "Le supplément est obligatoire.";
  }
}

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
  const [options, setOptions] = useState<OptionRow[]>(
    group?.options.map((o) => ({
      label: o.label,
      priceInput: centimesToEuroInput(o.priceDelta),
      priceDelta: o.priceDelta,
    })) ?? [],
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

  // Per-option price errors — single source of truth = `parsePriceEuros`,
  // strictly mirroring the item-modal pattern (F-MENU-05 #219). Both
  // « priceInput is parseable euros » (UX validation) and « priceDelta ≥ 0 »
  // (schema mirror) go through the same helper so the wording matches the
  // user-facing messages on the item « Prix » input. The « empty » reason is
  // tolerated as a 0-cent supplement (« option offerte ») — same behaviour as
  // the previous integer-only input that defaulted to 0.
  //
  // The defensive `priceDelta < 0` branch catches a contract-violation row
  // (e.g. a bogus group seeded with `priceDelta: -50` — pinned by the
  // existing AC5 test) so the inline error fires even when the input string
  // would otherwise look clean.
  const optionPriceErrors = useMemo<Array<string | null>>(
    () =>
      options.map((o) => {
        const trimmed = o.priceInput.trim();
        if (trimmed.length === 0) return null;
        const parsed = parsePriceEuros(trimmed);
        if (!parsed.ok) return priceErrorMessage(parsed);
        if (o.priceDelta < 0) {
          return "Le supplément ne peut pas être négatif.";
        }
        return null;
      }),
    [options],
  );
  const hasAnyOptionPriceError = optionPriceErrors.some((e) => e !== null);

  // -- Option-row handlers ---------------------------------------------------
  const handleAddOption = () => {
    setOptions([...options, { ...EMPTY_OPTION_ROW }]);
  };
  const handleRemoveOption = (index: number) => {
    setOptions(options.filter((_, i) => i !== index));
  };
  const handleOptionLabel = (index: number, label: string) => {
    setOptions(options.map((o, i) => (i === index ? { ...o, label } : o)));
  };
  const handleOptionPrice = (index: number, raw: string) => {
    // Locale-friendly text input (« 1.50 » OR « 1,50 ») — we KEEP the raw
    // typed string in `priceInput` so the field never wipes a half-typed
    // « 12, » mid-keystroke. The centimes integer is derived strictly from
    // `parsePriceEuros` (single source of truth, mirror of item-modal's
    // F-MENU-05 contract): if it parses, we cache the result on the row so
    // the submit path reads a fresh value without re-parsing; if it doesn't,
    // we leave the last-known-good `priceDelta` in place AND surface the
    // inline error through `optionPriceErrors` (`canSubmit` blocks « Créer »
    // until every row parses).
    setOptions(
      options.map((o, i) => {
        if (i !== index) return o;
        const trimmed = raw.trim();
        if (trimmed.length === 0) {
          // Empty input = « offert » (0 cents) — same behaviour as the
          // previous integer-only input that fell back to 0 on blank.
          return { ...o, priceInput: raw, priceDelta: 0 };
        }
        const parsed = parsePriceEuros(trimmed);
        if (!parsed.ok) {
          // Keep the raw string so the user can see + correct what they
          // typed; preserve the prior `priceDelta` so a transient invalid
          // keystroke doesn't poison the model.
          return { ...o, priceInput: raw };
        }
        return { ...o, priceInput: raw, priceDelta: parsed.centimes };
      }),
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
                  {/* Euro-suffixed price input — Alex E2E manuel : « il faut
                      que les prix apparaissent bien en Euros avec option de
                      gérer les centimes d'euros (2 décimales) ». Wrapping
                      `div.relative` + absolute `€` glyph mirrors the standard
                      shadcn pattern for suffixed inputs; the input keeps
                      `pr-7` (right padding) so the typed digits never collide
                      with the symbol. Plain text input (no `type="number"` —
                      same rationale as item-modal: better touch UX, lockable
                      locale via `parsePriceEuros`). */}
                  <div className="relative w-28">
                    <Input
                      data-slot="menu-modifier-modal-option-price-input"
                      type="text"
                      inputMode="decimal"
                      value={opt.priceInput}
                      onChange={(e) => handleOptionPrice(index, e.target.value)}
                      placeholder="0,00"
                      className="pr-7 text-right"
                      aria-label={`Supplément en euros de l'option ${index + 1}`}
                      aria-invalid={priceErr !== null || undefined}
                    />
                    <span
                      aria-hidden="true"
                      className="text-muted-foreground pointer-events-none absolute inset-y-0 right-2 flex items-center text-sm"
                    >
                      €
                    </span>
                  </div>
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
