"use client";

/**
 * F-PIPELINE-CRM 06 (#262) — `useKanbanDnd`, the React-side wrapper around
 * the pure orchestration `decideKanbanDnDEnd`.
 *
 * Owns the FOUR shell concerns that can't live in the pure module:
 *  1. `@dnd-kit/core` sensors (`useSensor` + `useSensors`).
 *  2. The pending bypass dialog state (`useState({open, missing, phase,
 *     prospectId})`) — opened on `confirm` actions, closed on
 *     confirm / cancel.
 *  3. The Convex `changePhase` mutation trigger (`useMutation` from
 *     `convex/react`) — fired on `commit` actions OR on dialog confirm,
 *     with errors surfaced via `toast.error` (same UX as
 *     `milestone-checklist.tsx`).
 *  4. The currently-dragged prospect id, exposed so the page can render
 *     a `<DragOverlay>` clone that follows the cursor (dnd-kit's
 *     recommended pattern — see «Drag preview / overlay» note below).
 *
 * Drag preview / overlay (T17 bug fix, 2026-06-01)
 * ------------------------------------------------
 * Before the fix, `DraggableProspectCard` applied `CSS.Translate` directly
 * on the in-flow draggable node. Two combined hazards broke the visual:
 *  - the kanban column wrapper has `overflow-y-auto`, which CLIPS the
 *    transformed card to the column's bounding box → the preview
 *    visually drifts but never reaches the cursor on long drags;
 *  - the card lives inside a `flex` `<li>`, so the transform anchors
 *    relative to its slot, not the viewport, so the preview only follows
 *    the cursor when dragged near the source slot.
 *
 * The fix routes the visual through `<DragOverlay>` — a portal-positioned
 * `position: fixed` clone that dnd-kit places at the cursor every frame.
 * The hook now exposes `activeId` + `onDragStart` + `onDragCancel` so the
 * page can mount/unmount the overlay's `<ProspectCard>` clone.
 *
 * Auto-bascule toast detection lives in a SIBLING hook
 * (`useAutoBasculeToast`) that consumes the pure `detectAutoBascule` diff —
 * keeps both hooks single-responsibility and trivially composable from
 * `page.tsx`.
 *
 * Scope discipline (#262 hard constraint): file lives under
 * `apps/admin/src/app/(app)/pipeline/_lib/`. Zero touch to `apps/web`,
 * `apps/native`, or `packages/backend/convex/`.
 */
import {
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useMutation } from "convex/react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import {
  type DnDProspectSnapshot,
  decideKanbanDnDEnd,
} from "./decideKanbanDnDEnd";
import type { Phase } from "./prospectPhaseMover";

/**
 * State the dialog needs while open. `null` ⇒ closed (no pending decision).
 */
type PendingBypass = {
  prospectId: Id<"prospects">;
  phase: Phase;
  missing: string[];
};

export type UseKanbanDndResult = {
  /** Wire to `<DndContext sensors={sensors}>`. */
  sensors: ReturnType<typeof useSensors>;
  /** Wire to `<DndContext onDragStart={onDragStart}>`. */
  onDragStart: (event: DragStartEvent) => void;
  /** Wire to `<DndContext onDragEnd={onDragEnd}>`. */
  onDragEnd: (event: DragEndEvent) => void;
  /** Wire to `<DndContext onDragCancel={onDragCancel}>`. */
  onDragCancel: () => void;
  /**
   * The currently-dragged prospect id (null when no drag is active).
   * The page renders the `<DragOverlay>` clone iff this is non-null.
   */
  activeId: string | null;
  /** Wire to `<BypassConfirmDialog open={dialog.open} ... />`. */
  dialog: {
    open: boolean;
    missing: string[];
    onConfirm: () => void;
    onCancel: () => void;
  };
};

export function useKanbanDnd(
  prospects: ReadonlyArray<DnDProspectSnapshot>,
): UseKanbanDndResult {
  // PointerSensor with a tiny activation distance — prevents accidental
  // drags on plain card clicks (the cards are also `<a>` anchors to the
  // fiche).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const [pending, setPending] = useState<PendingBypass | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const changePhase = useMutation(api.lib.onboarding.crm.changePhase);

  const fireChangePhase = useCallback(
    async (prospectId: Id<"prospects">, phase: Phase) => {
      try {
        await changePhase({ prospectId, phase });
      } catch (err) {
        toast.error(getConvexErrorMessage(err));
      }
    },
    [changePhase],
  );

  const onDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  }, []);

  const onDragCancel = useCallback(() => {
    setActiveId(null);
  }, []);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const activeIdString = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;

      const action = decideKanbanDnDEnd({
        activeId: activeIdString,
        overId,
        prospects,
      });

      switch (action.kind) {
        case "ignore":
        case "noop":
          return;
        case "commit":
          void fireChangePhase(activeIdString as Id<"prospects">, action.phase);
          return;
        case "confirm":
          setPending({
            prospectId: activeIdString as Id<"prospects">,
            phase: action.phase,
            missing: action.missing,
          });
          return;
      }
    },
    [prospects, fireChangePhase],
  );

  const onConfirm = useCallback(() => {
    if (pending === null) return;
    const { prospectId, phase } = pending;
    setPending(null);
    void fireChangePhase(prospectId, phase);
  }, [pending, fireChangePhase]);

  const onCancel = useCallback(() => {
    setPending(null);
  }, []);

  const dialog = useMemo(
    () => ({
      open: pending !== null,
      missing: pending?.missing ?? [],
      onConfirm,
      onCancel,
    }),
    [pending, onConfirm, onCancel],
  );

  return {
    sensors,
    onDragStart,
    onDragEnd,
    onDragCancel,
    activeId,
    dialog,
  };
}
