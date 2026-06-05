/**
 * Public API of the `toast` native module.
 *
 * Cuisine action-confirmation toast (top-center, KB green / rouge, auto-
 * dismiss). The lib (`react-native-toast-message`) is mounted once at root via
 * `<Toast config={TOAST_CONFIG} />`; consumers fire one of the helpers below
 * from the `onSuccess` branch of each mutation site.
 *
 * `decideToastVariant` is the pure decision matrix (pinned by `decide-toast.test.ts`).
 * `notifyAction` / `notifyWorkflowAction` are the React adapters.
 */
export {
  decideToastVariant,
  decideWorkflowActionKey,
  type ActionKey,
  type ToastKind,
  type ToastVariant,
} from "./decide-toast";
export { notifyAction, notifyWorkflowAction } from "./notify";
export { TOAST_CONFIG } from "./toast-config";
