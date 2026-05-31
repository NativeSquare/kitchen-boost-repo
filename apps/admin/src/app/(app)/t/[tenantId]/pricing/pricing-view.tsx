/**
 * F-PRICING-1 (#241) — `PricingView`, pure presentational shell for the read-
 * only rules list. First tracer-bullet of F-PRICING (#146); slices 2-5 layer
 * create/update/toggle/delete on top.
 *
 * Three branches:
 *   - `rules === undefined` → loading skeleton (the header + banner stay
 *     mounted so the user never sees a blank flash).
 *   - `rules.length === 0`  → empty state with the "règle par défaut 10 %"
 *     copy. NO create CTA here — slice 2 adds it.
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
 *   - The placeholders « Éditer » / « Supprimer » MUST be disabled (slices
 *     2-3 will flip them on).
 *
 * Split out of `page.tsx` (which owns the `useTenantQuery` call) so vitest
 * can pin every branch under `environment: "node"` — same pattern as
 * `menu/menu-view.tsx` and `mes-clients/mes-clients-view.tsx`.
 */
import { IconPlus } from "@tabler/icons-react";

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

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
   *   - `[]`        → tenant has no rules yet (default rule applies on backend)
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
};

export function PricingView({
  rules,
  onNewRule,
  onEditRule,
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
        <PricingBody rules={rules} onEditRule={onEditRule} />
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
}: {
  rules: Doc<"pricingRules">[] | undefined;
  onEditRule?: (rule: Doc<"pricingRules">) => void;
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
          <RuleRow rule={rule} onEditRule={onEditRule} />
        </li>
      ))}
    </ul>
  );
}

function PricingEmptyState() {
  return (
    <div className="rounded-lg border border-dashed p-8 text-center">
      <p className="text-muted-foreground text-sm">
        Aucune règle pour l&apos;instant. La règle KitchenBoost par défaut
        (10&nbsp;% du panier absorbés par le resto) s&apos;applique.
      </p>
    </div>
  );
}

function RuleRow({
  rule,
  onEditRule,
}: {
  rule: Doc<"pricingRules">;
  onEditRule?: (rule: Doc<"pricingRules">) => void;
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
  return (
    <Card className={rowClass}>
      <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{conditionsSummary}</p>
          <p className="text-muted-foreground text-sm">{actionSummary}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isActive ? "default" : "secondary"}>
            {isActive ? "Active" : "Inactive"}
          </Badge>
          {/*
            F-PRICING-3 (#248) wires « Éditer » via `onEditRule` (per-row
            binding — clicking emits THIS row's rule). « Supprimer » remains a
            disabled placeholder (slice 5 will wire it to the CRUD remove
            mutation).
          */}
          <Button
            variant="outline"
            size="sm"
            disabled={!editEnabled}
            onClick={editEnabled ? handleEdit : undefined}
          >
            Éditer
          </Button>
          <Button variant="outline" size="sm" disabled>
            Supprimer
          </Button>
        </div>
      </CardContent>
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
