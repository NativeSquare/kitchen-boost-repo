/**
 * PWA-S6a (#455) — push enrollment modal module API.
 *
 * `<PushEnrollmentModal>` is the single mount-point the `<CheckoutForm>` opens
 * when the user clicks "Payer X €" with the gate disabled (decisions-log
 * Q8 « Modal single-screen non-skippable »). It owns the modal's internal
 * state machine (`decideModalStep`) + the device-specific Wallet install flow
 * + the async install loader.
 *
 * The Web Push branch (S6b #456) and the 3-level fallback chain (S6c #457)
 * extend this module — they will add a `<WebPushButton>` + a
 * `<FallbackChain>` sibling and a few new `ModalStep` kinds.
 */
export {
  type PushEnrollmentModalProps,
  PushEnrollmentModal,
} from "./push-enrollment-modal";
