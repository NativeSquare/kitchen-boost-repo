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
};

export function PricingView({ rules }: PricingViewProps) {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
      <div className="px-4 lg:px-6">
        <h1 className="text-2xl font-bold">Pricing</h1>
      </div>
      <div className="px-4 lg:px-6">
        <AutoPriorityBanner />
      </div>
      <div className="px-4 lg:px-6">
        <PricingBody rules={rules} />
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

function PricingBody({ rules }: { rules: Doc<"pricingRules">[] | undefined }) {
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
          <RuleRow rule={rule} />
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

function RuleRow({ rule }: { rule: Doc<"pricingRules"> }) {
  const conditionsSummary = formatConditionsSummary(rule.conditions);
  const actionSummary = formatActionSummary(rule.action);
  const isActive = rule.active;
  // Inactive rows visually de-emphasised via `opacity-60` + muted text on the
  // body. The `Inactive` label below is the explicit textual signal — opacity
  // alone wouldn't be accessible.
  const rowClass = isActive ? "" : "opacity-60";
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
            Placeholders disabled in slice 1 (issue body): the slices 2-3 will
            wire « Éditer » to the builder modal and « Supprimer » to the CRUD
            mutation. Disabling them now avoids any chance of a misclick
            mutating the wrong row before the handlers exist.
          */}
          <Button variant="outline" size="sm" disabled>
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
