/**
 * PWA-S6a (#455) / S6b (#456) / S6c (#457) — push enrollment modal module API.
 *
 * `<PushEnrollmentModal>` is the single mount-point the `<CheckoutForm>` opens
 * when the user clicks "Payer X €" with the gate disabled (decisions-log
 * Q8 « Modal single-screen non-skippable »). It owns the modal's internal
 * state machine (`decideModalStep`), the device-specific Wallet install flow
 * (S6a), the async install loader (S6a), the Web Push permission flow (S6b,
 * with iOS <16.4 masking via `decideWebPushCapability`), and the 3-level
 * frictional « Continuer sans notifs » fallback (S6c, `decideFallbackStep`
 * + `<NoNotifsFallback>`) that surfaces after 2 documented channel failures
 * and ultimately fires `customer.pushEnrollment.markNoChannelPossible` to
 * unlock the gate without any push channel (~5% cases per Q8 (5)).
 */
export {
  type PushEnrollmentModalProps,
  PushEnrollmentModal,
} from "./push-enrollment-modal";
export {
  type WebPushSubscribeButtonProps,
  WebPushSubscribeButton,
} from "./web-push-subscribe-button";
export {
  type NoNotifsFallbackProps,
  NoNotifsFallback,
} from "./no-notifs-fallback";
