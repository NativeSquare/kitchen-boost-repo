"use client";

/**
 * F-PIPELINE-CRM 05 (#255) — `KanbanColumn`.
 *
 * One of the 3 static columns of the `/pipeline` Kanban (Acquisition /
 * Préparation / Installation). Pure presentation : takes the column `title`
 * and the list of `prospects` already partitioned by `partitionProspectsByPhase`,
 * and renders a titled vertical stack of `ProspectCard`s.
 *
 * NO drag-and-drop in this slice (#255 « Pas de drag-and-drop dans cette
 * story — seulement la mise en colonnes statique »). PIPELINE-06 (#221)
 * cables the DnD on top of this same column shell — the surface is
 * intentionally stable so that slice is purely additive.
 *
 * The `now` prop is plumbed through to each `ProspectCard` for deterministic
 * tests of the relative-time rendering. Production callers omit it.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type {
  ProspectCardSnapshot,
  ProspectPhase,
} from "../_lib/prospectFilter";

import { ProspectCard } from "./prospect-card";

export type KanbanColumnProps = {
  phase: ProspectPhase;
  title: string;
  prospects: ReadonlyArray<ProspectCardSnapshot>;
  /**
   * Reference instant plumbed through to every `ProspectCard` for
   * relative-time rendering. ALWAYS passed by the parent (the page
   * computes it once via `useState(() => Date.now())` — see
   * `ProspectCardProps.now` for the React-purity rationale). Defaults to
   * `Date.now()` in tests that don't care about determinism.
   */
  now?: number;
  className?: string;
};

export function KanbanColumn({
  phase,
  title,
  prospects,
  now,
  className,
}: KanbanColumnProps) {
  const referenceNow = now ?? 0;
  return (
    <section
      data-kanban-column={phase}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 min-w-[280px] max-h-[calc(100vh-12rem)] overflow-y-auto",
        className,
      )}
    >
      <header className="flex items-center justify-between gap-2 px-1">
        <h2 className="font-semibold text-sm">{title}</h2>
        <Badge variant="secondary" aria-label="Nombre de prospects">
          {prospects.length}
        </Badge>
      </header>
      {prospects.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center">
          <p className="text-xs text-muted-foreground">Aucun prospect</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {prospects.map((p) => (
            <li key={p._id as string}>
              <ProspectCard prospect={p} now={referenceNow} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
