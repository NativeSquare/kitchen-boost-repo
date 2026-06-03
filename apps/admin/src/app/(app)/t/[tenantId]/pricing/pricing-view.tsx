/**
 * F-PRICING-1 (#241) — `PricingView`, pure presentational shell for the read-
 * only rules list. First tracer-bullet of F-PRICING (#146); slices 2-5 layer
 * create/update/toggle/delete on top.
 *
 * Three branches:
 *   - `rules === undefined` → loading skeleton (the header + banner stay
 *     mounted so the user never sees a blank flash).
 *   - `rules.length === 0`  → empty state that tells the TRUTH ("sans règle,
 *     le client paie l'intégralité des frais de livraison") AND surfaces the
 *     10 % share as an explicit RECOMMANDATION (badge + bulb icon), not an
 *     applied default. The engine has NO 10 % default — fallback is "client
 *     pays full gross" (`packages/shared/pricing/engine.ts` :141-148).
 *     NO create CTA here — slice 2 adds it.
 *   - else                  → list of rule rows (active + inactive),
 *     each one showing condition + action FR summaries and the active state.
 *     Inactive rows are visually de-emphasised (opacity + « Inactive » label).
 *
 * Hard guardrails (issue body) enforced by `pricing-view.test.tsx` AND
 * `guardrails.test.ts`:
 *   - NO `[draggable]` attribute anywhere — auto-priority means no manual
 *     order to drag.
 *   - NO `priority` / `order` identifier in the rendered DOM, nor as a form
 *     input name.
 *   - F-PRICING-5 (#251) — « Supprimer » becomes active when the page wires
 *     `onDeleteRule`, gated by a 2-click `AlertDialog` confirmation
 *     (1-click delete INTERDIT, issue body). Backward compat: when omitted,
 *     the button stays disabled (slice 1 placeholder shape).
 *
 * Split out of `page.tsx` (which owns the `useTenantQuery` call) so vitest
 * can pin every branch under `environment: "node"` — same pattern as
 * `menu/menu-view.tsx` and `mes-clients/mes-clients-view.tsx`.
 */
import { useState } from "react";
import { IconBulb, IconPlus } from "@tabler/icons-react";

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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

import { formatActionSummary, formatConditionsSummary } from "./format-rule";

/**
 * The verbatim French copy of the auto-priority banner (issue body §
 * « Comportement attendu » — load-bearing, pinned by test). Exported so the
 * test can assert it appears in the rendered tree AND that it contains the
 * three load-bearing phrases.
 */
export const AUTO_PRIORITY_BANNER_TEXT =
  "Quand plusieurs règles s'appliquent, KitchenBoost applique automatiquement celle qui est la plus avantageuse pour ton client. Pas d'ordre à gérer.";

export type PricingViewProps = {
  /**
   * Rules from `useTenantQuery(api.lib.pricing.rules.list)`.
   *   - `undefined` → query in flight (Convex loading sentinel)
   *   - `[]`        → tenant has no rules yet. Engine fallback: client pays
   *                    the FULL gross delivery cost, resto absorbs 0 (see
   *                    `packages/shared/pricing/engine.ts` :141-148). The UI
   *                    surfaces a 10 % RECOMMANDATION to nudge the resto to
   *                    create a rule — nothing 10 % is applied automatically.
   *   - else        → list to render (active + inactive)
   */
  rules: Doc<"pricingRules">[] | undefined;
  /**
   * F-PRICING-2 (#245) — fires when the gérant clicks « + Nouvelle règle ».
   * The page owns the modal state (RuleBuilderModal lives at the page level so
   * it survives reactive re-renders of the list); a successful create closes
   * the modal and the list re-renders via Convex reactivity. Optional so the
   * F-PRICING-1 read-only callers (and isolated component tests) keep working
   * without supplying a handler — defaults to a no-op.
   */
  onNewRule?: () => void;
  /**
   * F-PRICING-3 (#248) — fires when the gérant clicks « Éditer » on a row.
   * The page passes the rule under edit down to `RuleBuilderModal` via its
   * `existingRule` prop, switching the modal to edit mode (same builder, just
   * pre-filled — no duplicated component). Optional so the F-PRICING-1
   * isolated callers (and the « placeholders disabled » test) keep working
   * without supplying a handler: when omitted, the row's Éditer button STAYS
   * disabled (slice 1's contract — no-op, no misclick risk).
   */
  onEditRule?: (rule: Doc<"pricingRules">) => void;
  /**
   * F-PRICING-4 (#249) — fires when the gérant flips a row's Active/Inactive
   * toggle. The page bridges this to `api.lib.pricing.rules.setActive` via
   * `useTenantMutation` (auto-injected `tenantId`, ADR 0014 §4 / #183, ADR
   * 0010). Optional so F-PRICING-1 isolated callers (and the « placeholders
   * disabled » test) keep working without supplying a handler: when omitted,
   * the row's toggle is rendered but `disabled` (no-op, no row-mutation risk).
   *
   * Contract: the toggle is the ONLY thing the gérant flips here — it must
   * never be wired to a `remove` or `update` mutation. The rule's definition
   * (conditions + action) stays intact across activate / deactivate cycles
   * (« pas un delete déguisé », issue body), pinned at the page-source level
   * in `page.test.ts`.
   */
  onToggleActive?: (ruleId: Id<"pricingRules">, active: boolean) => void;
  /**
   * F-PRICING-5 (#251) — fires when the gérant confirms the deletion of a
   * rule via the 2-click `AlertDialog` flow. The page bridges this to
   * `api.lib.pricing.rules.remove` via `useTenantMutation` (auto-injected
   * `tenantId`, ADR 0014 §4 / #183, ADR 0010). Optional so the F-PRICING-1
   * isolated callers (and the « placeholders disabled » test) keep working
   * without supplying a handler: when omitted, the row's « Supprimer »
   * button stays disabled — same shape as slice 1's placeholder, no
   * row-mutation risk.
   *
   * Contract (issue body) — load-bearing:
   *   - The row button never invokes this directly; it only opens the
   *     confirmation `AlertDialog`. 1-click delete = INTERDIT.
   *   - The dialog's « Annuler » action is a no-op (dialog closes, rule
   *     intact). Only its « Supprimer » action fires this callback with the
   *     row's `_id`.
   */
  onDeleteRule?: (ruleId: Id<"pricingRules">) => void;
};

export function PricingView({
  rules,
  onNewRule,
  onEditRule,
  onToggleActive,
  onDeleteRule,
}: PricingViewProps) {
  // Default the click handler so the button is always present (issue body:
  // « Bouton « + Nouvelle règle » sur la page liste »). The page wires the
  // real opener via the prop; tests that don't care about the click pass
  // nothing and the button no-ops.
  const handleNewRule = onNewRule ?? (() => undefined);
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="flex items-center justify-between px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Pricing</h1>
        <Button
          type="button"
          data-slot="pricing-new-rule"
          onClick={handleNewRule}
        >
          <IconPlus className="mr-1.5 size-4" aria-hidden="true" />
          Nouvelle règle
        </Button>
      </div>
      <div className="px-4 lg:px-6">
        <AutoPriorityBanner />
      </div>
      <div className="px-4 lg:px-6">
        <PricingBody
          rules={rules}
          onEditRule={onEditRule}
          onToggleActive={onToggleActive}
          onDeleteRule={onDeleteRule}
        />
      </div>
    </div>
  );
}

function AutoPriorityBanner() {
  // Static pedagogical banner (issue body): explains the engine's auto-pick
  // semantics so the gérant doesn't go looking for a drag handle. Kept as a
  // muted card to read more like a "did you know" than a warning.
  return (
    <div
      className="bg-muted/50 text-muted-foreground rounded-lg border p-4 text-sm"
      role="note"
    >
      {AUTO_PRIORITY_BANNER_TEXT}
    </div>
  );
}

function PricingBody({
  rules,
  onEditRule,
  onToggleActive,
  onDeleteRule,
}: {
  rules: Doc<"pricingRules">[] | undefined;
  onEditRule?: (rule: Doc<"pricingRules">) => void;
  onToggleActive?: (ruleId: Id<"pricingRules">, active: boolean) => void;
  onDeleteRule?: (ruleId: Id<"pricingRules">) => void;
}) {
  if (rules === undefined) {
    return <RulesSkeleton />;
  }
  if (rules.length === 0) {
    return <PricingEmptyState />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {rules.map((rule) => (
        <li key={rule._id}>
          <RuleRow
            rule={rule}
            onEditRule={onEditRule}
            onToggleActive={onToggleActive}
            onDeleteRule={onDeleteRule}
          />
        </li>
      ))}
    </ul>
  );
}

function PricingEmptyState() {
  // Honest empty state (PR1 critical fix — Alex E2E manuel) : the previous
  // copy claimed "la règle KitchenBoost par défaut (10 % du panier absorbés
  // par le resto) s'applique" — that was a LIE. The engine has NO default
  // rule; its fallback is "client pays full gross, resto absorbs 0" (see
  // `packages/shared/pricing/engine.ts` :141-148). We now (1) state the
  // system truth explicitly, then (2) surface the 10 % as a RECOMMENDATION
  // (Badge + bulb icon) — a nudge, not a system state.
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-dashed p-8 text-center">
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Aucune règle pour l&apos;instant.</p>
        <p className="text-muted-foreground text-sm">
          Sans règle, le client paie l&apos;intégralité des frais de livraison.
        </p>
      </div>
      <div className="bg-muted/50 mx-auto flex max-w-md flex-col gap-2 rounded-lg border p-4 text-left">
        <div className="flex items-center gap-2">
          <IconBulb
            className="text-primary size-4 shrink-0"
            aria-hidden="true"
          />
          <Badge variant="secondary">Recommandation KitchenBoost</Badge>
        </div>
        <p className="text-muted-foreground text-sm">
          Absorbe <strong>10&nbsp;%</strong> du panier (frais de livraison à ta
          charge) pour rester compétitif face à Uber Eats. Crée une règle en 1
          clic via «&nbsp;+ Nouvelle règle&nbsp;».
        </p>
      </div>
    </div>
  );
}

function RuleRow({
  rule,
  onEditRule,
  onToggleActive,
  onDeleteRule,
}: {
  rule: Doc<"pricingRules">;
  onEditRule?: (rule: Doc<"pricingRules">) => void;
  onToggleActive?: (ruleId: Id<"pricingRules">, active: boolean) => void;
  onDeleteRule?: (ruleId: Id<"pricingRules">) => void;
}) {
  const conditionsSummary = formatConditionsSummary(rule.conditions);
  const actionSummary = formatActionSummary(rule.action);
  const isActive = rule.active;
  // Inactive rows visually de-emphasised via `opacity-60` + muted text on the
  // body. The `Inactive` label below is the explicit textual signal — opacity
  // alone wouldn't be accessible.
  const rowClass = isActive ? "" : "opacity-60";
  // F-PRICING-3 (#248) — « Éditer » becomes active when the page wires
  // `onEditRule`. Backward compat (slice 1's isolated callers + the
  // « placeholders disabled » test): if `onEditRule` is omitted, the button
  // stays disabled — same DOM shape, no row-mutation risk.
  const editEnabled = onEditRule !== undefined;
  const handleEdit = () => {
    onEditRule?.(rule);
  };
  // F-PRICING-4 (#249) — same backward-compat discipline as `onEditRule`:
  // when the page omits `onToggleActive`, the Switch is rendered but stays
  // `disabled` (slice-1 placeholder shape). When wired, Radix Switch hands
  // us the FLIPPED value via `onCheckedChange`, which we forward verbatim to
  // the page's `setActive` bridge. We intentionally do NOT compute `!isActive`
  // here — the toggle is the source of truth for the next state and Radix
  // already gives it to us, so re-deriving would be redundant + fragile.
  const toggleEnabled = onToggleActive !== undefined;
  const handleToggle = (next: boolean) => {
    onToggleActive?.(rule._id, next);
  };
  // F-PRICING-5 (#251) — same backward-compat discipline as `onEditRule` /
  // `onToggleActive`: when the page omits `onDeleteRule`, « Supprimer »
  // stays disabled (slice-1 placeholder shape). When wired, clicking the row
  // button toggles a local `confirmOpen` flag that mounts an `AlertDialog`;
  // ONLY the dialog's « Supprimer » action invokes `onDeleteRule(rule._id)`
  // — never the row button itself (1-click delete INTERDIT). « Annuler » is
  // a no-op (the dialog's onOpenChange closes itself).
  const deleteEnabled = onDeleteRule !== undefined;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const handleOpenConfirm = () => {
    setConfirmOpen(true);
  };
  const handleConfirmDelete = () => {
    onDeleteRule?.(rule._id);
    setConfirmOpen(false);
  };
  return (
    <Card className={rowClass}>
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{conditionsSummary}</p>
          <p className="text-muted-foreground text-sm">{actionSummary}</p>
        </div>
        <div className="flex items-center gap-2">
          {/*
            F-PRICING-4 (#249) — per-row Active/Inactive Switch. `checked`
            mirrors `rule.active`; flipping it fires `onToggleActive` with
            the NEW value, which the page bridges to
            `api.lib.pricing.rules.setActive`. The Badge below stays as the
            redundant textual signal (accessibility — opacity alone doesn't
            carry meaning for screen readers).
          */}
          <Switch
            data-slot="pricing-rule-active-toggle"
            checked={isActive}
            disabled={!toggleEnabled}
            onCheckedChange={toggleEnabled ? handleToggle : undefined}
            aria-label={`Activer ou désactiver la règle ${String(rule._id)}`}
          />
          <Badge variant={isActive ? "default" : "secondary"}>
            {isActive ? "Active" : "Inactive"}
          </Badge>
          {/*
            F-PRICING-3 (#248) wires « Éditer » via `onEditRule` (per-row
            binding — clicking emits THIS row's rule).
          */}
          <Button
            variant="outline"
            size="sm"
            disabled={!editEnabled}
            onClick={editEnabled ? handleEdit : undefined}
          >
            Éditer
          </Button>
          {/*
            F-PRICING-5 (#251) — « Supprimer » row button is the 1st click of
            the 2-click confirmation. It NEVER invokes `onDeleteRule`; it
            only opens the AlertDialog (`confirmOpen` local state). The
            dialog's « Supprimer » action (rendered below, identical FR
            label) is the 2nd click — that one fires the callback. When
            `onDeleteRule` is omitted, the button stays disabled (same
            backward-compat shape as slice 3 / 4) and the dialog is not
            mounted at all (no risk of an inert dialog leaking into the
            tree).
          */}
          <Button
            variant="outline"
            size="sm"
            data-slot="pricing-rule-delete"
            disabled={!deleteEnabled}
            onClick={deleteEnabled ? handleOpenConfirm : undefined}
            aria-label={`Supprimer la règle ${String(rule._id)}`}
          >
            Supprimer
          </Button>
        </div>
      </CardContent>
      {deleteEnabled ? (
        <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Supprimer cette règle ?</AlertDialogTitle>
              <AlertDialogDescription>
                Cette action est irréversible. La règle ne sera plus appliquée
                aux prochaines commandes.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              {/* « Annuler » = AlertDialogCancel — Radix wires it to close
                  the dialog (onOpenChange(false)). No-op on the rule. */}
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleConfirmDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-slot="pricing-rule-delete-confirm"
              >
                Supprimer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}
    </Card>
  );
}

function RulesSkeleton() {
  // 3 skeleton rows — same shape as a populated row (avoids a layout shift
  // when the data lands). The `animate-pulse` class from the shadcn Skeleton
  // primitive is what the test pins as the loading-affordance marker.
  return (
    <ul className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <li key={i}>
          <Card>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-4 w-48" />
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-16" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-24" />
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}
