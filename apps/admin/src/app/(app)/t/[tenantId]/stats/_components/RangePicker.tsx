"use client";

/**
 * F-STATS-DASHBOARD [3/8] (#253) — `RangePicker`, the resto stats range
 * selector (7 / 30 / 90 jours). Pure presentational toggle : owns no state,
 * forwards every selection via `onChange(value: RangeDays)` to the page (which
 * holds the `useState`).
 *
 * Why we render 3 hand-rolled `<button>`s instead of using shadcn's
 * `<ToggleGroup>` (built on Radix) : the view's unit test calls the function
 * pointer directly under `environment: "node"` (no React renderer, no
 * provider, no hooks). Radix primitives use hooks internally and would throw
 * « Invalid hook call ». The buttons here use ZERO hooks and surface the
 * canonical toggle-group data attributes (`data-state="on"/"off"`, `value`)
 * so a future accessibility audit can rely on them.
 *
 * Visual design : reuses the KB green accent (#1B7A3D) on the selected state,
 * same palette as the dashboard KPI cards.
 */
import * as React from "react";

import { cn } from "@/lib/utils";
import { RANGE_OPTIONS, type RangeDays, rangeLabel } from "@/lib/stats-range";

export type RangePickerProps = {
  /** Currently selected range. */
  value: RangeDays;
  /** Called when the user picks a different option. */
  onChange: (value: RangeDays) => void;
  /** Optional extra class names (e.g. for layout from the parent). */
  className?: string;
};

export function RangePicker({ value, onChange, className }: RangePickerProps) {
  return (
    <div
      data-slot="range-picker"
      role="radiogroup"
      aria-label="Période d'analyse"
      className={cn(
        "inline-flex items-center rounded-md border bg-background p-0.5",
        className,
      )}
    >
      {RANGE_OPTIONS.map((opt) => {
        const isSelected = opt === value;
        return (
          <button
            key={opt}
            type="button"
            data-slot="range-picker-option"
            data-state={isSelected ? "on" : "off"}
            value={String(opt)}
            role="radio"
            aria-checked={isSelected}
            onClick={() => onChange(opt)}
            className={cn(
              "rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1B7A3D]/40",
              isSelected
                ? "bg-[#1B7A3D] text-white"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {rangeLabel(opt)}
          </button>
        );
      })}
    </div>
  );
}
