"use client";

/**
 * F-PIPELINE-CRM 05 (#255) — `ProspectSearchBar`.
 *
 * Controlled `<input type="search">` for the `/pipeline` Kanban. The
 * parent holds the query string and runs `searchProspectsByName` on the
 * fetched prospect list before partitioning into columns. Adapter pattern
 * — this component knows nothing about prospects ; it only forwards the
 * next string value to its `onChange` so the parent stays
 * React-shape-agnostic.
 *
 * No debouncing here : the filter is pure + O(n) on at most a few hundred
 * cards, and the dataset comes from a single Convex subscription (no
 * round-trip per keystroke). Adding a debounce would only delay UX feedback.
 */
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type ProspectSearchBarProps = {
  value: string;
  onChange: (next: string) => void;
  className?: string;
};

export function ProspectSearchBar({
  value,
  onChange,
  className,
}: ProspectSearchBarProps) {
  return (
    <Input
      type="search"
      value={value}
      onChange={(e) => onChange((e.target as HTMLInputElement).value)}
      placeholder="Rechercher un prospect par nom…"
      aria-label="Rechercher un prospect"
      className={cn("max-w-md", className)}
    />
  );
}
