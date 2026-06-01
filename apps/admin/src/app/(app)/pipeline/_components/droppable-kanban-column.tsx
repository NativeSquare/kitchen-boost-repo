"use client";

/**
 * F-PIPELINE-CRM 06 (#262) — `DroppableKanbanColumn`.
 *
 * Thin DnD wrapper around the pure `KanbanColumn`. Calls `@dnd-kit/core`
 * `useDroppable` with `column:<phase>` (encoded via `columnDroppableId` —
 * single source of truth shared with `decideKanbanDnDEnd`) and swaps the
 * inner card list for `DraggableProspectCard`s. The pure column is rendered
 * untouched apart from the additional droppable ref + hover state, so every
 * #255 acceptance assertion still holds at runtime.
 *
 * The page mounts THIS wrapper. The presentational `KanbanColumn` stays
 * pure / hook-free for the vitest `node` env serializer.
 */
import { useDroppable } from "@dnd-kit/core";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import { columnDroppableId } from "../_lib/decideKanbanDnDEnd";
import type {
  ProspectCardSnapshot,
  ProspectPhase,
} from "../_lib/prospectFilter";

import { DraggableProspectCard } from "./draggable-prospect-card";

export type DroppableKanbanColumnProps = {
  phase: ProspectPhase;
  title: string;
  prospects: ReadonlyArray<ProspectCardSnapshot>;
  now?: number;
  className?: string;
};

export function DroppableKanbanColumn({
  phase,
  title,
  prospects,
  now,
  className,
}: DroppableKanbanColumnProps) {
  const referenceNow = now ?? 0;
  const { setNodeRef, isOver } = useDroppable({
    id: columnDroppableId(phase),
  });
  return (
    <section
      ref={setNodeRef}
      data-kanban-column={phase}
      data-dragging-over={isOver}
      data-droppable-id={columnDroppableId(phase)}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 min-w-[280px] max-h-[calc(100vh-12rem)] overflow-y-auto",
        isOver && "ring-2 ring-primary bg-primary/5",
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
              <DraggableProspectCard prospect={p} now={referenceNow} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
