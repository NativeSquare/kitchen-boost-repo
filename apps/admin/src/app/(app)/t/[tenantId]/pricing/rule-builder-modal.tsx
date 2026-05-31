"use client";

/**
 * F-PRICING-2 (#245) — `RuleBuilderModal`, the create surface of a pricing
 * rule. Second tracer-bullet of F-PRICING (#146); slice 3 will layer EDIT
 * on top of THIS exact form (DRY — same selects, same per-kind switch).
 *
 * Contract pinned by `rule-builder-modal.test.tsx`:
 *   - Condition picker = CLOSED-list `<select>` over the 6 V1 condition kinds.
 *     The 6 FR labels are imported from `./labels.ts` (single source of truth
 *     shared with the read-only list — F-PRICING-1).
 *   - Action picker = CLOSED-list `<select>` over the 3 V1 action kinds.
 *     `livraison_offerte_client` is NEVER listed (Q35-Q1 — KB does not subsidise
 *     V1 delivery).
 *   - Per-kind fields are dispatched by a `switch (kind)` — there is NO free-
 *     text input letting the gérant type an arbitrary `kind`.
 *   - Conditions are AND-ed (V1 — no OR option). A subtle FR reminder is
 *     surfaced under the list.
 *   - « + Ajouter une condition » grows the list with a default `total_panier`
 *     row (the most common case); « Supprimer » per row prunes it.
 *   - Unit conversion happens INSIDE the modal at SUBMIT time: euros (UI) →
 *     `valueCents` (schema); percent (UI) → integer percent (schema convention
 *     mirrored from `pricingRules.ts` and `format-rule.ts`).
 *   - The page wires the network call (`useTenantMutation(api.lib.pricing.rules.create)`,
 *     ADR 0014 §4 / #183, ADR 0010) and catches the typed
 *     `CONTRADICTORY_CONDITIONS` ConvexError, threading `error.data.message`
 *     back to this modal via the `submitError` prop. The modal renders it
 *     inline under the submit button — NO toast (the issue body explicitly
 *     forbids a « toast technique »).
 *   - The modal stays open on error so the gérant can correct the bounds
 *     without re-typing the whole form.
 *
 * Native HTML `<select>` (not the shadcn radix wrapper) for two reasons:
 *   - Closed list is the load-bearing contract — the schema VALUES are the
 *     kind literals; `<option value="…">` keeps form semantics native and
 *     trivially testable under `environment: "node"` (no portal, no
 *     `useId` to mock). The shadcn `<Select>` would pull radix in here.
 *   - Touch UX on a phone is fine — the gérant rarely creates a rule, and a
 *     native dropdown is universally understood. Mirrors the
 *     `NativeSelect`/`NativeSelectOption` pattern used in `item-modal.tsx`.
 *
 * Scope discipline (#245 hard constraint): this file lives under
 * `apps/admin/src/app/(app)/t/[tenantId]/pricing/` — zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`. No import of the backend
 * pricing engine here (ADR 0013 — backend-only; the module-wide guardrail
 * in `guardrails.test.ts` sweeps this file for the banned path).
 */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";

import type { Doc } from "@packages/backend/convex/_generated/dataModel";
import type {
  PricingAction,
  PricingCondition,
} from "@packages/backend/convex/table/pricingRules";

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

import {
  ACTION_KIND_LABELS,
  CONDITION_KIND_LABELS,
  type ActionKind,
  type ConditionKind,
} from "./labels";

/** Payload sent to `api.lib.pricing.rules.create`. */
export type RuleBuilderSubmitPayload = {
  conditions: PricingCondition[];
  action: PricingAction;
};

export type RuleBuilderModalProps = {
  /** Controlled open flag — owned by the page (clears on success). */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired on « Enregistrer » with the typed payload (unit-converted). */
  onSubmit: (payload: RuleBuilderSubmitPayload) => void;
  /**
   * Inline error message under the submit button (e.g. the
   * `ConvexError.data.message` for `CONTRADICTORY_CONDITIONS`). `null` hides
   * the error zone. NO toast (issue body forbids « toast technique »).
   */
  submitError: string | null;
  /**
   * F-PRICING-3 (#248) — when defined, switches the modal to EDIT mode:
   *   - The form's initial state hydrates from this rule's `conditions` +
   *     `action` (no duplicate component, no separate "edit form" — same
   *     builder, just pre-filled). The page picks up the persisted shape from
   *     `useTenantQuery(api.lib.pricing.rules.list)` and threads it down.
   *   - The dialog title flips to « Modifier la règle » and the submit button
   *     label flips to « Enregistrer les modifications » so the gérant sees
   *     immediately which mode they are in.
   *   - The page is responsible for branching the network call: edit fires
   *     `api.lib.pricing.rules.update({ ruleId: existingRule._id, … })`
   *     (NOT `create`). The modal stays mode-agnostic on the wire — it just
   *     emits the typed payload via `onSubmit`.
   * When `undefined`, the modal is in CREATE mode (F-PRICING-2 behaviour,
   * unchanged).
   * To re-hydrate when switching from one rule to another in edit mode, the
   * page should `key={existingRule?._id ?? "create"}` the modal so React
   * re-mounts and `useState` re-runs its initializer.
   */
  existingRule?: Doc<"pricingRules">;
};

/** Empty default for a fresh condition row — the most common kind first. */
const DEFAULT_CONDITION: PricingCondition = {
  kind: "total_panier",
  operator: "gte",
  valueCents: 0,
};

/** Empty default for the action picker — the simplest case (no extra field). */
const DEFAULT_ACTION: PricingAction = { kind: "livraison_offerte_resto" };

/** The 7 day codes in display order (LU first per FR convention). */
const DAY_CODES = ["LU", "MA", "ME", "JE", "VE", "SA", "DI"] as const;
const DAY_LABELS: Record<(typeof DAY_CODES)[number], string> = {
  LU: "Lu",
  MA: "Ma",
  ME: "Me",
  JE: "Je",
  VE: "Ve",
  SA: "Sa",
  DI: "Di",
};

export function RuleBuilderModal(props: RuleBuilderModalProps) {
  const { open, onOpenChange, existingRule } = props;
  // F-PRICING-3 (#248) — mode-derived strings. We compute them here (not in
  // the form) so the dialog HEADER reflects the mode without re-running the
  // form's state initializer. The form keeps its own derived label.
  const isEditMode = existingRule !== undefined;
  const title = isEditMode ? "Modifier la règle" : "Nouvelle règle de pricing";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="pricing-rule-builder">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Définissez les conditions qui déclenchent la règle, puis ce que le
            resto absorbe sur les frais de livraison.
          </DialogDescription>
        </DialogHeader>
        <RuleBuilderForm {...props} />
      </DialogContent>
    </Dialog>
  );
}

function RuleBuilderForm({
  onSubmit,
  onOpenChange,
  submitError,
  existingRule,
}: RuleBuilderModalProps) {
  // -- State -----------------------------------------------------------------
  // Two top-level pieces of state, in this order (the test's
  // `mockStateOverrides` keys assume `[conditions, action]` — keep the order
  // STABLE):
  //   state[0]: conditions array  (default = [], the gérant explicitly adds)
  //                                EDIT mode: pre-filled from existingRule.conditions
  //   state[1]: action            (default = livraison_offerte_resto)
  //                                EDIT mode: pre-filled from existingRule.action
  //
  // The initializers are functions so they only run on first mount. The page
  // is expected to `key={existingRule?._id ?? "create"}` the modal to force a
  // re-mount when switching from one rule to another — otherwise React would
  // keep the previous rule's state and the new pre-fill would silently fail.
  // Cents/percent stay in their schema units inside state; the per-kind input
  // converts to UI representation at render time (centsToEuroDisplay /
  // String(percent)), so no separate "load conversion" step is needed.
  const [conditions, setConditions] = useState<PricingCondition[]>(
    () => existingRule?.conditions ?? [],
  );
  const [action, setAction] = useState<PricingAction>(
    () => existingRule?.action ?? DEFAULT_ACTION,
  );
  const isEditMode = existingRule !== undefined;

  // -- Conditions: add / remove / mutate -------------------------------------
  const handleAddCondition = () => {
    setConditions([...conditions, { ...DEFAULT_CONDITION }]);
  };
  const handleRemoveCondition = (index: number) => {
    setConditions(conditions.filter((_, i) => i !== index));
  };
  const replaceConditionAt = (index: number, next: PricingCondition): void => {
    setConditions(conditions.map((c, i) => (i === index ? next : c)));
  };

  /**
   * Re-shape a condition when the gérant switches its kind via the picker.
   * The schema is a discriminated union — we MUST provide the new kind's
   * required fields. We default each kind to a sane, schema-satisfying
   * shape (the same defaults the « + Ajouter » CTA starts from).
   */
  const handleChangeConditionKind = (
    index: number,
    nextKind: ConditionKind,
  ): void => {
    const fresh = defaultConditionForKind(nextKind);
    replaceConditionAt(index, fresh);
  };

  // -- Action: switch kind ---------------------------------------------------
  const handleChangeActionKind = (nextKind: ActionKind): void => {
    setAction(defaultActionForKind(nextKind));
  };

  // -- Submit ----------------------------------------------------------------
  const handleSubmit = () => {
    // We trust the per-row inputs to keep their state in shape (the kind
    // switch resets the row to a valid default; the per-field handlers
    // only assign legal subtypes). The page-level network catch is the
    // safety net for backend-detected contradictions.
    onSubmit({ conditions, action });
  };

  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-5">
      {/* Conditions ----------------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <Label>Conditions</Label>
        <p className="text-muted-foreground text-xs">
          Toutes les conditions doivent être vraies pour que la règle
          s&apos;applique.
        </p>

        <div
          className="flex flex-col gap-3"
          data-slot="pricing-rule-builder-conditions-list"
        >
          {conditions.map((condition, index) => (
            <div
              key={index}
              data-slot="pricing-rule-builder-condition-row"
              className="rounded-md border p-3"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <NativeSelect
                    data-slot="pricing-rule-builder-condition-kind"
                    value={condition.kind}
                    onChange={(e) =>
                      handleChangeConditionKind(
                        index,
                        e.target.value as ConditionKind,
                      )
                    }
                    className="w-full"
                  >
                    {(
                      Object.keys(CONDITION_KIND_LABELS) as ConditionKind[]
                    ).map((kind) => (
                      <NativeSelectOption
                        key={kind}
                        value={kind}
                        data-slot="pricing-rule-builder-condition-kind-option"
                      >
                        {CONDITION_KIND_LABELS[kind]}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  data-slot="pricing-rule-builder-condition-remove"
                  onClick={() => handleRemoveCondition(index)}
                  aria-label={`Supprimer la condition ${index + 1}`}
                >
                  <IconTrash className="size-4" aria-hidden="true" />
                </Button>
              </div>
              <div className="mt-3">
                <ConditionFields
                  condition={condition}
                  onChange={(next) => replaceConditionAt(index, next)}
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-slot="pricing-rule-builder-condition-add"
            onClick={handleAddCondition}
          >
            <IconPlus className="mr-1.5 size-4" aria-hidden="true" />
            Ajouter une condition
          </Button>
        </div>
      </section>

      {/* Action --------------------------------------------------------- */}
      <section className="flex flex-col gap-2">
        <Label htmlFor="pricing-rule-builder-action-kind">Action</Label>
        <NativeSelect
          id="pricing-rule-builder-action-kind"
          data-slot="pricing-rule-builder-action-kind"
          value={action.kind}
          onChange={(e) => handleChangeActionKind(e.target.value as ActionKind)}
          className="w-full"
        >
          {(Object.keys(ACTION_KIND_LABELS) as ActionKind[]).map((kind) => (
            <NativeSelectOption
              key={kind}
              value={kind}
              data-slot="pricing-rule-builder-action-kind-option"
            >
              {ACTION_KIND_LABELS[kind]}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <ActionFields action={action} onChange={setAction} />
      </section>

      {/* Footer: Cancel / Save + inline error --------------------------- */}
      <DialogFooter className="flex-col items-stretch gap-2 sm:flex-col sm:items-stretch">
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            data-slot="pricing-rule-builder-cancel"
          >
            Annuler
          </Button>
          <Button
            type="button"
            data-slot="pricing-rule-builder-submit"
            onClick={handleSubmit}
          >
            {isEditMode ? "Enregistrer les modifications" : "Enregistrer"}
          </Button>
        </div>
        {submitError !== null ? (
          <p
            data-slot="pricing-rule-builder-submit-error"
            className="text-destructive text-right text-xs"
          >
            {submitError}
          </p>
        ) : null}
      </DialogFooter>
    </div>
  );
}

// ===========================================================================
// Per-kind condition fields — switch on `kind`, render adapted inputs.
// ===========================================================================
function ConditionFields({
  condition,
  onChange,
}: {
  condition: PricingCondition;
  onChange: (next: PricingCondition) => void;
}) {
  switch (condition.kind) {
    case "total_panier":
      return (
        <div
          className="flex items-center gap-2"
          data-slot="pricing-rule-builder-condition-fields-total_panier"
        >
          <NativeSelect
            data-slot="pricing-rule-builder-condition-total_panier-operator"
            value={condition.operator}
            onChange={(e) =>
              onChange({
                ...condition,
                operator: e.target.value as "gte" | "lte",
              })
            }
            className="w-20"
          >
            <NativeSelectOption value="gte">≥</NativeSelectOption>
            <NativeSelectOption value="lte">≤</NativeSelectOption>
          </NativeSelect>
          <Input
            data-slot="pricing-rule-builder-condition-total_panier-euros"
            type="text"
            inputMode="decimal"
            value={centsToEuroDisplay(condition.valueCents)}
            onChange={(e) =>
              onChange({
                ...condition,
                valueCents: euroDisplayToCents(e.target.value),
              })
            }
            placeholder="25"
            className="w-32"
            aria-label="Total panier en euros"
          />
          <span className="text-muted-foreground text-sm">€</span>
        </div>
      );

    case "premiere_cmd_client":
      return (
        <div
          className="flex items-center gap-2"
          data-slot="pricing-rule-builder-condition-fields-premiere_cmd_client"
        >
          <Checkbox
            id={`pricing-rule-builder-premiere-${randomId()}`}
            data-slot="pricing-rule-builder-condition-premiere_cmd_client-toggle"
            checked={condition.value}
            onCheckedChange={(next) =>
              onChange({ ...condition, value: next === true })
            }
          />
          <span className="text-sm">
            Oui — c&apos;est la première commande du client
          </span>
        </div>
      );

    case "nombre_cmds_client":
      return (
        <div
          className="flex items-center gap-2"
          data-slot="pricing-rule-builder-condition-fields-nombre_cmds_client"
        >
          <NativeSelect
            data-slot="pricing-rule-builder-condition-nombre_cmds_client-operator"
            value={condition.operator}
            onChange={(e) =>
              onChange({
                ...condition,
                operator: e.target.value as "gte" | "lte",
              })
            }
            className="w-20"
          >
            <NativeSelectOption value="gte">≥</NativeSelectOption>
            <NativeSelectOption value="lte">≤</NativeSelectOption>
          </NativeSelect>
          <Input
            data-slot="pricing-rule-builder-condition-nombre_cmds_client-count"
            type="number"
            min={0}
            step={1}
            value={String(condition.value)}
            onChange={(e) =>
              onChange({
                ...condition,
                value: parseIntStrict(e.target.value),
              })
            }
            placeholder="3"
            className="w-24"
            aria-label="Nombre de commandes"
          />
          <span className="text-muted-foreground text-sm">commande(s)</span>
        </div>
      );

    case "plage_horaire":
      return (
        <div
          className="flex items-center gap-2"
          data-slot="pricing-rule-builder-condition-fields-plage_horaire"
        >
          <Input
            data-slot="pricing-rule-builder-condition-plage_horaire-start"
            type="time"
            value={condition.start}
            onChange={(e) => onChange({ ...condition, start: e.target.value })}
            aria-label="Début de la plage horaire"
            className="w-32"
          />
          <span className="text-muted-foreground text-sm">→</span>
          <Input
            data-slot="pricing-rule-builder-condition-plage_horaire-end"
            type="time"
            value={condition.end}
            onChange={(e) => onChange({ ...condition, end: e.target.value })}
            aria-label="Fin de la plage horaire"
            className="w-32"
          />
        </div>
      );

    case "jour_semaine":
      return (
        <div
          className="flex flex-wrap gap-2"
          data-slot="pricing-rule-builder-condition-fields-jour_semaine"
        >
          {DAY_CODES.map((day) => {
            const selected = condition.days.includes(day);
            return (
              <button
                key={day}
                type="button"
                data-slot="pricing-rule-builder-condition-jour_semaine-day"
                data-day={day}
                data-selected={selected ? "true" : "false"}
                onClick={() => {
                  const nextDays = selected
                    ? condition.days.filter((d) => d !== day)
                    : [...condition.days, day];
                  onChange({ ...condition, days: nextDays });
                }}
                className={
                  selected
                    ? "bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-xs font-medium"
                    : "border-input hover:bg-accent rounded-md border px-3 py-1.5 text-xs font-medium"
                }
                aria-pressed={selected}
              >
                {DAY_LABELS[day]}
              </button>
            );
          })}
        </div>
      );

    case "contient_item":
      return (
        <div
          className="flex flex-col gap-2"
          data-slot="pricing-rule-builder-condition-fields-contient_item"
        >
          <Input
            data-slot="pricing-rule-builder-condition-contient_item-category"
            type="text"
            value={condition.category ?? ""}
            onChange={(e) =>
              onChange({
                ...condition,
                category:
                  e.target.value.trim() === "" ? undefined : e.target.value,
              })
            }
            placeholder="Catégorie (ex. burger) — optionnel"
            aria-label="Catégorie d'item contenue"
          />
          <Input
            data-slot="pricing-rule-builder-condition-contient_item-itemId"
            type="text"
            value={condition.itemId ?? ""}
            onChange={(e) =>
              onChange({
                ...condition,
                itemId:
                  e.target.value.trim() === "" ? undefined : e.target.value,
              })
            }
            placeholder="Identifiant d'item — optionnel"
            aria-label="Identifiant d'item contenu"
          />
          <p className="text-muted-foreground text-xs">
            Renseignez au moins l&apos;un des deux : catégorie ou identifiant
            d&apos;item.
          </p>
        </div>
      );
  }
}

// ===========================================================================
// Per-kind action fields — switch on `kind`, render adapted inputs.
// ===========================================================================
function ActionFields({
  action,
  onChange,
}: {
  action: PricingAction;
  onChange: (next: PricingAction) => void;
}) {
  switch (action.kind) {
    case "livraison_offerte_resto":
      return (
        <div
          className="text-muted-foreground text-xs"
          data-slot="pricing-rule-builder-action-fields-livraison_offerte_resto"
        >
          Le resto prend en charge la totalité des frais de livraison. Le client
          paye 0&nbsp;€.
        </div>
      );

    case "frais_livraison_part_resto_fixe":
      return (
        <div
          className="flex items-center gap-2"
          data-slot="pricing-rule-builder-action-fields-frais_livraison_part_resto_fixe"
        >
          <Label htmlFor="pricing-rule-builder-action-fixe-euros">
            Part absorbée
          </Label>
          <Input
            id="pricing-rule-builder-action-fixe-euros"
            data-slot="pricing-rule-builder-action-frais_livraison_part_resto_fixe-euros"
            type="text"
            inputMode="decimal"
            value={centsToEuroDisplay(action.valueCents)}
            onChange={(e) =>
              onChange({
                ...action,
                valueCents: euroDisplayToCents(e.target.value),
              })
            }
            placeholder="2,50"
            className="w-32"
          />
          <span className="text-muted-foreground text-sm">€</span>
        </div>
      );

    case "frais_livraison_part_resto_pourcentage_panier":
      return (
        <div
          className="flex items-center gap-2"
          data-slot="pricing-rule-builder-action-fields-frais_livraison_part_resto_pourcentage_panier"
        >
          <Label htmlFor="pricing-rule-builder-action-percent">
            Part absorbée
          </Label>
          <Input
            id="pricing-rule-builder-action-percent"
            data-slot="pricing-rule-builder-action-frais_livraison_part_resto_pourcentage_panier-percent"
            type="number"
            min={0}
            max={100}
            step={1}
            value={String(action.percent)}
            onChange={(e) =>
              onChange({
                ...action,
                percent: parseIntStrict(e.target.value),
              })
            }
            placeholder="30"
            className="w-24"
          />
          <span className="text-muted-foreground text-sm">% du panier</span>
        </div>
      );
  }
}

// ===========================================================================
// Defaults per kind — keep submit payload schema-satisfying after a kind switch.
// ===========================================================================
function defaultConditionForKind(kind: ConditionKind): PricingCondition {
  switch (kind) {
    case "total_panier":
      return { kind: "total_panier", operator: "gte", valueCents: 0 };
    case "premiere_cmd_client":
      return { kind: "premiere_cmd_client", value: true };
    case "nombre_cmds_client":
      return { kind: "nombre_cmds_client", operator: "gte", value: 1 };
    case "plage_horaire":
      return { kind: "plage_horaire", start: "11:30", end: "14:00" };
    case "jour_semaine":
      return { kind: "jour_semaine", days: [] };
    case "contient_item":
      return { kind: "contient_item", category: undefined, itemId: undefined };
  }
}

function defaultActionForKind(kind: ActionKind): PricingAction {
  switch (kind) {
    case "livraison_offerte_resto":
      return { kind: "livraison_offerte_resto" };
    case "frais_livraison_part_resto_fixe":
      return { kind: "frais_livraison_part_resto_fixe", valueCents: 0 };
    case "frais_livraison_part_resto_pourcentage_panier":
      return {
        kind: "frais_livraison_part_resto_pourcentage_panier",
        percent: 0,
      };
  }
}

// ===========================================================================
// Unit-conversion helpers — €(UI) ↔ centimes(schema), permissive parse so a
// half-typed value doesn't snap back to 0.
// ===========================================================================

/** « 2,50 € » UI ← 250 centimes. Empty/0 → empty string (no « 0 » to backspace). */
function centsToEuroDisplay(cents: number): string {
  if (cents === 0) return "";
  const euros = cents / 100;
  // Use a comma for FR locale display, no forced trailing zero.
  if (Number.isInteger(euros)) return String(euros);
  return String(euros).replace(".", ",");
}

/**
 * « 2,50 » UI → 250 centimes. Accepts both « , » and « . » as decimal
 * separator. Returns 0 for any unparseable input (the page-level submit
 * catches schema-level errors). Caps at 2 decimals (centimes = smallest unit).
 */
function euroDisplayToCents(raw: string): number {
  const trimmed = raw.trim().replace(",", ".");
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/**
 * Strict integer parse — returns 0 for any unparseable input. The number
 * inputs already constrain the keyboard, but a paste of « abc » falls back
 * safely to 0 (visual blank for the gérant, no NaN in the model).
 */
function parseIntStrict(raw: string): number {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

/**
 * Lightweight id source for the per-row checkbox `htmlFor`. We don't need
 * cryptographic uniqueness — a render-stable suffix is enough for a label.
 * Hooks-friendly (no `useId`, which would force jsdom in tests).
 */
let _idCounter = 0;
function randomId(): string {
  _idCounter += 1;
  return `kb-${_idCounter}`;
}
