/**
 * PWA-S6a (#455) — `push-enrollment` module API.
 *
 * Pure decisions consumed by the `<PushEnrollmentModal>` family
 * (decisions-log Q5 + Q8):
 *
 *  - `decideDeviceTarget` — given the `navigator.userAgent`, returns the
 *    Wallet install flow bucket: `ios` (Blob `.pkpass`), `android`
 *    (Google Save link redirect), or `desktop` (button disabled). Q5
 *    « Distribution device-specific ».
 *
 *  - `decideModalStep` — pure state machine for the 2-step modal:
 *    `choice` (entry screen) ↔ `wallet-loading` (async install loader).
 *    Q8 « Modal single-screen non-skippable + flow async install Wallet ».
 *
 * Splitting the decisions from the React IO keeps every branch vitest-pinnable
 * in node env, same pattern as `checkout-gate`. S6b / S6c extend `ModalStep`
 * and `ModalEvent` with the Web Push branch + the 3-level fallback chain.
 */
export {
  type DecideDeviceTargetInput,
  type DeviceTarget,
  decideDeviceTarget,
} from "./decide-device-target";
export {
  type ModalEvent,
  type ModalStep,
  decideModalStep,
} from "./decide-modal-step";
