"use client";

/**
 * F-PIPELINE-CRM 05 (#255) — `KanbanColumn`.
 *
 * One of the 3 static columns of the `/pipeline` Kanban (Acquisition /
 * Préparation / Installation). Pure presentation : takes the column `title`
 * and the list of `prospects` already partitioned by `partitionProspectsByPhase`,
 * and renders a titled vertical stack of `ProspectCard`s.
 *
 * F-PIPELINE-CRM 06 (#262) — split presentational shell vs droppable wrapper
 * -------------------------------------------------------------------------
 * This file stays PURE (no hooks, no @dnd-kit) so the React-tree serializer
 * used by the vitest `node` env can expand it directly — every #255 acceptance
 * test keeps passing. The DnD wiring lives in the sibling
 * `DroppableKanbanColumn` (`droppable-kanban-column.tsx`) which calls
 * `useDroppable` and wraps this pure column + swaps `ProspectCard` for
 * `DraggableProspectCard`. The page imports the droppable wrapper; tests
 * still mount `KanbanColumn` directly.
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
