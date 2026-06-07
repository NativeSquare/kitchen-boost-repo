/**
 * Pure decision helpers for the KB cuisine action-confirmation toast.
 *
 * Same testing pattern as `decide-order-card.ts` / `decide-refuse-flow.ts` —
 * keep React, Convex, Expo and the toast lib out of the matrix so the wording
 * + icon + variant per action is pinned by a fast deterministic vitest suite.
 *
 * The React adapter that actually fires the toast lives in `notify.ts` and
 * consumes the verdict here.
 */

import type { Ionicons } from "@expo/vector-icons";
import type { WorkflowAction } from "@/lib/orders/decide-order-card";
import type { OrderMode } from "@packages/backend/convex/lib/orders";

/**
 * Two-variant palette aligned with the design system:
 *
 *   `positive`    → CSS var `--primary` (KitchenBoost green #1B7A3D)
 *   `destructive` → CSS var `--destructive` (rouge erreur)
 *
 * Text color is always white (`--primary-foreground` / `--destructive-foreground`).
 */
export type ToastKind = "positive" | "destructive";

/** Closed set of UX actions surfaced via a toast. Extend explicitly. */
export type ActionKey =
  | "workflow.acknowledge"
  | "workflow.markPrepared"
  | "workflow.markHandedOff.delivery"
  | "workflow.markHandedOff.pickup"
  | "workflow.refuse"
  | "availability.pause"
  | "availability.resume"
  | "availability.close"
  | "availability.reopen"
  | "printer.save"
  | "printer.testOk"
  | "printer.remove"
  | "printer.reprintOk"
  | "printer.reprintError"
  | "serviceHours.save"
  | "menu.itemSetAvailable"
  | "menu.itemSetUnavailable";

export type ToastVariant = {
  kind: ToastKind;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /**
   * Auto-dismiss duration in ms. Longer for fermetures (the body carries a
   * date the gérant must have time to read).
   */
  durationMs: number;
};

/**
 * Pure projection from a closed `ActionKey` to the toast variant.
 *
 * Icons match the buttons that trigger the action (visual i18n mirror of
 * `decideWorkflowButtonIcon` / `decideRefusalReasonIcon`) so the toast
 * reinforces the same glyph the cuisinier just tapped.
 */
export function decideToastVariant(action: ActionKey): ToastVariant {
  switch (action) {
    case "workflow.acknowledge":
      return {
        kind: "positive",
        label: "Commande acceptée",
        icon: "restaurant-outline",
        durationMs: 2500,
      };
    case "workflow.markPrepared":
      return {
        kind: "positive",
        label: "Commande prête",
        icon: "checkmark-done-outline",
        durationMs: 2500,
      };
    case "workflow.markHandedOff.delivery":
      return {
        kind: "positive",
        label: "Remise au coursier",
        icon: "bicycle-outline",
        durationMs: 2500,
      };
    case "workflow.markHandedOff.pickup":
      return {
        kind: "positive",
        label: "Remise au client",
        icon: "bag-handle-outline",
        durationMs: 2500,
      };
    case "workflow.refuse":
      return {
        kind: "destructive",
        label: "Commande refusée",
        icon: "close-circle-outline",
        durationMs: 2500,
      };
    case "availability.pause":
      return {
        kind: "destructive",
        label: "En pause",
        icon: "pause-circle-outline",
        durationMs: 2500,
      };
    case "availability.resume":
      return {
        kind: "positive",
        label: "Resto rouvert",
        icon: "play-outline",
        durationMs: 2500,
      };
    case "availability.close":
      return {
        kind: "destructive",
        label: "Resto fermé",
        icon: "lock-closed-outline",
        // Longer — body usually carries a date (« Fermé jusqu'au 12/06 »).
        durationMs: 4000,
      };
    case "availability.reopen":
      return {
        kind: "positive",
        label: "Resto rouvert",
        icon: "lock-open-outline",
        durationMs: 2500,
      };
    case "printer.save":
      return {
        kind: "positive",
        label: "Imprimante enregistrée",
        icon: "save-outline",
        durationMs: 2500,
      };
    case "printer.testOk":
      return {
        kind: "positive",
        label: "Test d'impression envoyé",
        icon: "print-outline",
        durationMs: 2500,
      };
    case "printer.remove":
      return {
        kind: "destructive",
        label: "Imprimante retirée",
        icon: "trash-outline",
        durationMs: 2500,
      };
    case "printer.reprintOk":
      return {
        kind: "positive",
        label: "Ticket réimprimé",
        icon: "print-outline",
        durationMs: 2500,
      };
    case "printer.reprintError":
      return {
        kind: "destructive",
        label: "Réimpression échouée",
        icon: "warning-outline",
        durationMs: 4000,
      };
    case "serviceHours.save":
      return {
        kind: "positive",
        label: "Horaires mis à jour",
        icon: "time-outline",
        durationMs: 2500,
      };
    case "menu.itemSetAvailable":
      return {
        kind: "positive",
        label: "Article rendu disponible",
        icon: "checkmark-circle-outline",
        durationMs: 2500,
      };
    case "menu.itemSetUnavailable":
      return {
        kind: "destructive",
        label: "Article rendu indisponible",
        icon: "close-circle-outline",
        durationMs: 2500,
      };
  }
}

/**
 * Map a workflow (action, mode) to the matching `ActionKey`. Mirrors the
 * `decideWorkflowButton` discrimination on `markHandedOff` so the toast for
 * « Remise » carries the right copy + icon per mode (coursier vs client).
 */
export function decideWorkflowActionKey(
  action: WorkflowAction,
  mode: OrderMode,
): ActionKey {
  switch (action) {
    case "acknowledge":
      return "workflow.acknowledge";
    case "markPrepared":
      return "workflow.markPrepared";
    case "markHandedOff":
      return mode === "delivery"
        ? "workflow.markHandedOff.delivery"
        : "workflow.markHandedOff.pickup";
  }
}
