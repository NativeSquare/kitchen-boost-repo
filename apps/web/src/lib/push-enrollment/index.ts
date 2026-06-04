/**
 * PWA-S6a (#455) / S6b (#456) — `push-enrollment` module API.
 *
 * Pure decisions consumed by the `<PushEnrollmentModal>` family
 * (decisions-log Q5 + Q8):
 *
 *  - `decideDeviceTarget` — given the `navigator.userAgent`, returns the
 *    Wallet install flow bucket: `ios` (Blob `.pkpass`), `android`
 *    (Google Save link redirect), or `desktop` (button disabled). Q5
 *    « Distribution device-specific ».
 *
 *  - `decideModalStep` — pure state machine for the modal: `choice` (entry
 *    screen with the 2 channel options) ↔ `wallet-loading` (async install
 *    loader, S6a) ↔ `web-push-loading` (Web Push permission flow, S6b).
 *    Q8 « Modal single-screen non-skippable ».
 *
 *  - `decideWebPushCapability` — given 3 runtime capability probes, decide
 *    whether the modal exposes the Web Push option at all. Masks the option
 *    on iOS <16.4 (`'PushManager' in window === false`, US 35).
 *
 *  - `decideWebPushBranch` — pure state machine for the Web Push sub-flow
 *    inside the modal: idle → requesting-permission → subscribing →
 *    registering → registered, with denied/error branches that increment a
 *    failureCount (read by the S6c #457 fallback link).
 *
 *  - `urlBase64ToUint8Array` — VAPID public key (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`)
 *    string-to-bytes converter for `PushManager.subscribe`.
 *
 * Splitting the decisions from the React IO keeps every branch vitest-pinnable
 * in node env, same pattern as `checkout-gate`. S6c extends `ModalStep`
 * and `ModalEvent` with the 3-level fallback chain.
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
export {
  type DecideWebPushCapabilityInput,
  type WebPushCapability,
  type WebPushUnsupportedReason,
  decideWebPushCapability,
} from "./decide-web-push-capability";
export {
  type WebPushBranchEvent,
  type WebPushBranchState,
  type WebPushBranchStateKind,
  decideWebPushBranch,
} from "./decide-web-push-branch";
export { urlBase64ToUint8Array } from "./encode-vapid-key";
