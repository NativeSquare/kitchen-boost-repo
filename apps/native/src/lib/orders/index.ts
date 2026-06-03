/**
 * Public API of the `orders` native module (#401 KB Orders, PRD 20 §2 + §4 +
 * §5 + §13).
 *
 * Three concerns surface here, sharing the same kb-orders happy-path spec:
 *
 *  - `OrderCard` — React card the home screen list (`(app)/(tabs)/index.tsx`)
 *    maps over each `tenantOrders` row. Renders ID prefix, items summary,
 *    total, status, mode tag (🚴 LIVRAISON / 🛍️ À EMPORTER), "nouvelle"
 *    badge. Tapping navigates to the detail screen.
 *
 *  - `decideModeTag` / `decideStatusLabel` / `decideWorkflowButton` /
 *    `decideOrderBadgeNew` — the PURE decision functions (no React, no
 *    Convex, no Expo). Truth table pinned in `decide-order-card.test.ts`.
 *    Used by `OrderCard` AND by the detail screen — the detail screen
 *    reaches them directly via this barrel to keep state-machine knowledge
 *    in ONE place.
 *
 * The backend mutations (`acknowledge`, `markPrepared`, `markHandedOff`) +
 * the live queue query (`tenantOrders`) + the detail query (`getOrder`)
 * already exist on `api.lib.orders.workflow.*` / `api.lib.orders.orders.*`
 * (chantier 2.3-D, ADR 0010 — `tenantMutation` / `tenantQuery` with cross-
 * tenant fuzz). This module is the pure FRONT-END layer over them; no
 * backend writes happen here.
 */
export { OrderCard } from "./order-card";
export {
  decideModeTag,
  decideOrderBadgeNew,
  decidePickupHandoffNote,
  decideStatusLabel,
  decideWorkflowButton,
  type ModeTag,
  type PickupHandoffNoteDecision,
  type WorkflowAction,
  type WorkflowButtonDecision,
} from "./decide-order-card";
export {
  REFUSAL_REASONS,
  decideRefusalReasonLabel,
  decideRefuseButton,
  refuseFlowReducer,
  type RefuseButtonDecision,
  type RefuseFlowAction,
  type RefuseFlowState,
  type RefusalReason,
} from "./decide-refuse-flow";
export { RefuseDialog, type RefuseDialogProps } from "./refuse-dialog";
