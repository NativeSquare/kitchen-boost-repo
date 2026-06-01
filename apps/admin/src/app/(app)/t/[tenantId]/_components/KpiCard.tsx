/**
 * F-STATS-DASHBOARD (#252) — `KpiCard`, the réutilisable presentational
 * primitive used by the dashboard home `/t/[tenantId]/page.tsx` to surface
 * one KPI of the day (CA jour, nb commandes jour, panier moyen, commandes en
 * cours).
 *
 * Tri-state contract:
 *   - `value === undefined` → `<Skeleton/>` (Convex loading sentinel).
 *   - `value: string`       → the formatted value (parent owns formatting:
 *     cents → "€", integers as-is) — so the card stays presentation-only and
 *     can be reused for any KPI shape later.
 *
 * No hook calls, no Convex import — the card is callable from a node-env
 * vitest test (no jsdom, no RTL, see `apps/admin/vitest.config.ts`). Accent
 * couleur KB (vert #1B7A3D) reserved for the positive-value label.
 */
import * as React from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type KpiCardProps = {
  /** Free-text card label, FR (e.g. "Chiffre d'affaires du jour"). */
  label: string;
  /**
   * The formatted value to surface (e.g. "1 234,56 €", "12"). `undefined` is
   * the loading sentinel — renders the skeleton placeholder instead.
   */
  value: string | undefined;
  /** Optional FR sub-label (e.g. "depuis 00h00"). */
  hint?: string;
};

export function KpiCard({ label, value, hint }: KpiCardProps) {
  return (
    <Card data-slot="kpi-card" className="h-full">
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {value === undefined ? (
          // Reuses the shadcn `<Skeleton/>` primitive (carries
          // `data-slot="skeleton"`) — DO NOT override the slot here so the
          // view's branch tests can pin loading via the canonical attribute.
          <Skeleton className="h-8 w-24" />
        ) : (
          <p
            data-slot="kpi-card-value"
            className="text-2xl font-bold tabular-nums text-[#1B7A3D]"
          >
            {value}
          </p>
        )}
        {hint !== undefined ? (
          <p className="text-muted-foreground mt-1 text-xs">{hint}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
