"use client";

/**
 * F-STATS-DASHBOARD [4/8] (#257) — `RevenuePerDayBlock`, the LineChart Recharts
 * card on the resto stats page `/t/[tenantId]/stats` (parent EPIC #151, PRD 70
 * §4.10).
 *
 * Pure presentational : receives the `revenuePerDay` payload as a prop ; the
 * `page.tsx` owns the `useTenantQuery` call and the `range` state. Keeps the
 * component hook-free so vitest's `environment: "node"` (apps/admin) can
 * function-pointer-render the component without React DOM / RTL.
 *
 * Tri-state contract :
 *   - `undefined` → loading (Convex sentinel) : render a `<Skeleton/>` in the
 *     chart area ;
 *   - `[]`        → empty period : surface the FR message « Pas encore de
 *     données sur cette période » (US9) ;
 *   - non-empty   → render the Recharts `<LineChart/>` with the KB green
 *     stroke (#1B7A3D), date X-axis (DD/MM short label), euro Y-axis, native
 *     Recharts tooltip on hover.
 *
 * Values are expected in CENTS (matches backend `pricingSnapshot.total`
 * convention) — the Y-axis formatter divides by 100 before formatting in fr-FR
 * EUR, and the tooltip mirrors the same formatting.
 */
import * as React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import type { RangeDays } from "@/lib/stats-range";

/** One bucket from `api.lib.stats.revenuePerDay`. */
export type RevenuePerDayEntry = {
  /** ISO `YYYY-MM-DD` (UTC) label. */
  date: string;
  /** Daily revenue in CENTS. */
  revenue: number;
};

export type RevenuePerDayBlockProps = {
  /** Currently selected window (used in the card subtitle). */
  range: RangeDays;
  /**
   * Tri-state payload from
   * `useTenantQuery(api.lib.stats.revenuePerDay.revenuePerDay, { rangeDays })` :
   *   - `undefined` → loading (Convex sentinel) ;
   *   - `[]`        → empty period ;
   *   - non-empty   → render the LineChart.
   */
  revenuePerDay: RevenuePerDayEntry[] | undefined;
};

/** Format `YYYY-MM-DD` as `DD/MM` for the X-axis tick (concise on small screens). */
function shortDateLabel(iso: string): string {
  // iso = YYYY-MM-DD ; split is enough — no need to construct a Date (avoids
  // an implicit local-tz shift on the label).
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

/** fr-FR EUR formatter (cents → "1 234,56 €"). */
function formatEuros(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(cents / 100);
}

const KB_GREEN = "#1B7A3D";

/**
 * Recharts tooltip body — surfaces the date (full ISO) + the formatted EUR
 * revenue for the hovered point. Kept inline (no module export) so the chart
 * stays self-contained.
 */
type TooltipPayloadEntry = { value?: number };
type RechartsTooltipProps = {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  label?: string;
};

function ChartTooltip({ active, payload, label }: RechartsTooltipProps) {
  if (active !== true || payload === undefined || payload.length === 0) {
    return null;
  }
  const raw = payload[0]?.value;
  const value = typeof raw === "number" ? raw : 0;
  return (
    <div
      data-slot="revenue-per-day-tooltip"
      className="rounded-md border bg-background px-3 py-2 text-xs shadow-sm"
    >
      <p className="text-muted-foreground">{label ?? ""}</p>
      <p className="font-semibold tabular-nums" style={{ color: KB_GREEN }}>
        {formatEuros(value)}
      </p>
    </div>
  );
}

export function RevenuePerDayBlock({
  range,
  revenuePerDay,
}: RevenuePerDayBlockProps) {
  const isLoading = revenuePerDay === undefined;
  const isEmpty = Array.isArray(revenuePerDay) && revenuePerDay.length === 0;

  return (
    <Card data-slot="revenue-per-day" className="h-full">
      <CardHeader>
        <CardTitle className="text-sm font-medium">Revenus par jour</CardTitle>
        <p className="text-muted-foreground text-xs">
          Sur les {range} derniers jours
        </p>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : isEmpty ? (
          <div
            data-slot="revenue-per-day-empty"
            className="text-muted-foreground flex h-48 items-center justify-center text-sm"
          >
            Pas encore de données sur cette période
          </div>
        ) : (
          <div className="h-48 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={revenuePerDay}
                margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-border"
                />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDateLabel}
                  fontSize={11}
                  minTickGap={16}
                />
                <YAxis
                  tickFormatter={(v: number) => formatEuros(v)}
                  fontSize={11}
                  width={70}
                />
                <Tooltip content={<ChartTooltip />} />
                <Line
                  type="monotone"
                  dataKey="revenue"
                  stroke={KB_GREEN}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: KB_GREEN }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
