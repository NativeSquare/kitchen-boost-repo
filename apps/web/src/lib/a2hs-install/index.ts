/**
 * PWA-S10 (#462) — `a2hs-install` module API.
 *
 * Pure decision consumed by the React `<AndroidInstallButton>` (frontend) +
 * the `<PWAInstallProvider>` capture context. Splitting the decision from
 * the React IO keeps every branch vitest-pinnable in node env, same shape
 * as `wallet-prompt` / `push-enrollment` / `checkout-gate`.
 *
 *  - `decideA2hsButtonVisibility` — given (a) whether a `beforeinstallprompt`
 *    event was captured, (b) the current cart item count, (c) whether the
 *    PWA is already running standalone, (d) the live `a2hsStatus`, decide
 *    whether the install button should render (and WHY if not).
 */
export {
  type A2hsButtonHiddenReason,
  type A2hsButtonVisibility,
  type DecideA2hsButtonVisibilityInput,
  type PushChannelStatus,
  decideA2hsButtonVisibility,
} from "./decide-a2hs-button-visibility";
