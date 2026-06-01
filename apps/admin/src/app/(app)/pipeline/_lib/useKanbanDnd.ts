"use client";

/**
 * F-PIPELINE-CRM 06 (#262) — `useKanbanDnd`, the React-side wrapper around
 * the pure orchestration `decideKanbanDnDEnd`.
 *
 * Owns the THREE shell concerns that can't live in the pure module:
 *  1. `@dnd-kit/core` sensors (`useSensor` + `useSensors`).
 *  2. The pending bypass dialog state (`useState({open, missing, phase,
 *     prospectId})`) — opened on `confirm` actions, closed on
 *     confirm / cancel.
 *  3. The Convex `changePhase` mutation trigger (`useMutation` from
 *     `convex/react`) — fired on `commit` actions OR on dialog confirm,
 *     with errors surfaced via `toast.error` (same UX as
 *     `milestone-checklist.tsx`).
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
  /** Wire to `<DndContext onDragEnd={onDragEnd}>`. */
  onDragEnd: (event: DragEndEvent) => void;
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

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const overId = event.over ? String(event.over.id) : null;

      const action = decideKanbanDnDEnd({
        activeId,
        overId,
        prospects,
      });

      switch (action.kind) {
        case "ignore":
        case "noop":
          return;
        case "commit":
          void fireChangePhase(activeId as Id<"prospects">, action.phase);
          return;
        case "confirm":
          setPending({
            prospectId: activeId as Id<"prospects">,
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

  return { sensors, onDragEnd, dialog };
}
