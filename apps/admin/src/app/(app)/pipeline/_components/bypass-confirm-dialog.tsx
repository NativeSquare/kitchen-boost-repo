"use client";

/**
 * F-PIPELINE-CRM 06 (#262) — `BypassConfirmDialog`.
 *
 * Pure CONTROLLED dialog rendered by the Kanban shell (`page.tsx` via
 * `useKanbanDnd`) when a drag forward lands on a phase whose required
 * milestones are not all met (the bypass branch of `decidePhaseMove`).
 *
 * The dialog lists the missing milestones (FR labels via
 * `labelForMilestoneKey`) and exposes two CTAs:
 *  - « Annuler » → `onCancel()` — no mutation; the card snaps back.
 *  - « Confirmer le bypass » → `onConfirm()` — the shell fires
 *    `crm.changePhase` with the bypass flag (the backend mutation
 *    re-computes the gate AND logs the `prospect.changePhase.bypass` audit
 *    row when the missing list is non-empty).
 *
 * Why AlertDialog (not Dialog)
 * ----------------------------
 * The drag-forward-bypass is a SEMANTIC interrupt — the operator is taking a
 * shortcut around the indicative gate, and the dialog asks for an explicit
 * confirmation. AlertDialog gives the radix accessibility primitive the
 * right role (`alertdialog`) so screen readers announce it as a confirm-or-
 * cancel decision rather than a regular modal. Same primitive used by the
 * refund flow (`order-detail-modal.tsx`).
 *
 * Why pure / controlled (no `useState`)
 * -------------------------------------
 * `useKanbanDnd` owns the open state + the missing list + the pending
 * mutation closure. Keeping the dialog a pure function of its props makes it
 * directly testable via the React-tree serializer (no jsdom, no event
 * dispatch). The shell wires the radix `onOpenChange` to its own state in
 * one place.
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

import { labelForMilestoneKey } from "../_lib/milestoneLabels";

export type BypassConfirmDialogProps = {
  /** Controlled open flag — owned by the Kanban shell (`useKanbanDnd`). */
  open: boolean;
  /**
   * The applicable milestones for the target phase that the prospect has
   * NOT yet achieved — computed front-side by `missingMilestonesForPhase`.
   * Each key is rendered as an FR-labelled bullet via `labelForMilestoneKey`.
   */
  missing: ReadonlyArray<string>;
  /** Fired when the operator confirms the bypass (the shell calls `changePhase`). */
  onConfirm: () => void;
  /** Fired when the operator cancels (Escape / Cancel button / overlay click). */
  onCancel: () => void;
};

export function BypassConfirmDialog({
  open,
  missing,
  onConfirm,
  onCancel,
}: BypassConfirmDialogProps) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmer le bypass</AlertDialogTitle>
          <AlertDialogDescription>
            Les jalons suivants sont encore manquants pour cette phase. Vous
            pouvez quand même déplacer le prospect — l&apos;écart sera tracé en
            audit.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <ul
          data-slot="bypass-missing-list"
          className="list-disc pl-6 text-sm flex flex-col gap-1"
        >
          {missing.map((key) => (
            <li key={key} data-milestone-key={key}>
              {labelForMilestoneKey(key)}
            </li>
          ))}
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Annuler</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Confirmer le bypass
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
