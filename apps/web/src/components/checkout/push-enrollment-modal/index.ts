/**
 * PWA-S6a (#455) / S6b (#456) — push enrollment modal module API.
 *
 * `<PushEnrollmentModal>` is the single mount-point the `<CheckoutForm>` opens
 * when the user clicks "Payer X €" with the gate disabled (decisions-log
 * Q8 « Modal single-screen non-skippable »). It owns the modal's internal
 * state machine (`decideModalStep`), the device-specific Wallet install flow
 * (S6a), the async install loader (S6a) and the Web Push permission flow
 * (S6b, with iOS <16.4 masking via `decideWebPushCapability`).
 *
 * The 3-level fallback chain (S6c #457) extends this module — it will add a
 * `<FallbackChain>` sibling and a few new `ModalStep` kinds.
 */
export {
  type PushEnrollmentModalProps,
  PushEnrollmentModal,
} from "./push-enrollment-modal";
export {
  type WebPushSubscribeButtonProps,
  WebPushSubscribeButton,
} from "./web-push-subscribe-button";
