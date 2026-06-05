import Toast from "react-native-toast-message";
import {
  decideToastVariant,
  decideWorkflowActionKey,
  type ActionKey,
} from "./decide-toast";
import type { WorkflowAction } from "@/lib/orders/decide-order-card";
import type { OrderMode } from "@packages/backend/convex/lib/orders";

/**
 * Thin adapter over `react-native-toast-message`. Call from any `onSuccess`
 * branch (mutation has committed, no throw). The lib is mounted once at the
 * app root (`apps/native/src/app/_layout.tsx`) via `<Toast config={...} />`.
 *
 * Two entry points:
 *
 *  - `notifyAction(key, { detail? })` — closed-set action key + optional
 *    secondary line (e.g. « Fermé jusqu'au 12/06 » under « Resto fermé »).
 *  - `notifyWorkflowAction(action, mode, opts?)` — sugar for the order
 *    workflow site that resolves the `markHandedOff` mode discrimination
 *    via `decideWorkflowActionKey`.
 *
 * Both use the `top` position with a 32 px offset (room for the iOS notch +
 * Android status bar), the variant-specific `durationMs` from
 * `decideToastVariant`, and the custom render config in `toast-config.tsx`.
 */
export function notifyAction(key: ActionKey, opts?: { detail?: string }): void {
  const variant = decideToastVariant(key);
  Toast.show({
    type: variant.kind,
    position: "top",
    topOffset: 32,
    visibilityTime: variant.durationMs,
    text1: variant.label,
    text2: opts?.detail,
    props: { icon: variant.icon },
  });
}

export function notifyWorkflowAction(
  action: WorkflowAction,
  mode: OrderMode,
  opts?: { detail?: string },
): void {
  notifyAction(decideWorkflowActionKey(action, mode), opts);
}
