"use client";

/**
 * F-PIPELINE-CRM 06 (#262) — `DraggableProspectCard`.
 *
 * Thin DnD wrapper around the pure `ProspectCard` (kept pure on purpose so
 * the #255 React-tree-serializer test matrix keeps passing in the lean
 * vitest `node` env). Calls `@dnd-kit/core` `useDraggable` with the
 * prospect id, applies the live transform + `isDragging` opacity, and
 * forwards the listeners + attributes on the outer `div`.
 *
 * Click vs drag disambiguation
 * ----------------------------
 * The `PointerSensor` configured by `useKanbanDnd` has a 4 px activation
 * distance — clicks under that threshold fall through to the inner anchor
 * (the operator still drills down to the fiche), drags above engage DnD.
 *
 * The card itself is rendered untouched — so every #255 assertion (text,
 * anchor href, tenant badge, source label, score, relative time) still
 * holds at runtime: this wrapper is purely structural.
 */
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import type { ProspectCardSnapshot } from "../_lib/prospectFilter";

import { ProspectCard } from "./prospect-card";

export type DraggableProspectCardProps = {
  prospect: ProspectCardSnapshot;
  now: number;
  className?: string;
};

export function DraggableProspectCard({
  prospect,
  now,
  className,
}: DraggableProspectCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: prospect._id as string });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.6 : 1,
    // `touch-action: none` lets the PointerSensor capture touch events on
    // mobile / trackpad without the browser hijacking the gesture for
    // scrolling — dnd-kit recommended default.
    touchAction: "none",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-prospect-draggable={prospect._id as string}
      data-dragging={isDragging}
      className="cursor-grab active:cursor-grabbing"
      {...listeners}
      {...attributes}
    >
      <ProspectCard prospect={prospect} now={now} className={className} />
    </div>
  );
}
