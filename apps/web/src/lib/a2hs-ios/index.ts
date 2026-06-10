/**
 * PWA-S11 (#463) — `a2hs-ios` module API (iOS A2HS bottom-sheet + standalone
 * heuristique — decisions-log Q4, US 58 / 59).
 *
 * Pure decisions consumed by the React surfaces in `components/a2hs-ios`.
 * Splitting decision from React IO keeps every branch vitest-pinnable in
 * node env, same shape as `a2hs-install` (#462), `wallet-prompt` (#460),
 * `push-enrollment` (#454→#457), `checkout-gate` (#454), etc.
 *
 *  - `isIosSafari(userAgent)` — pure UA sniff (iPhone/iPad/iPod AND not
 *    a known in-app or non-Safari iOS browser).
 *  - `decideIosBottomSheetVisibility` — 4-gate visibility for the Vaul
 *    bottom-sheet rendered on `/c/[orderId]` T+0.
 *  - `decideIosStandaloneHeuristic` — 2-gate decision for the « fire
 *    recordA2hsAccepted on first standalone visit » runner mounted at the
 *    root layout.
 *  - `A2HS_IOS_SHEET_DISMISS_KEY` — sessionStorage key for the « OK plus
 *    tard » flag.
 */
export { isIosSafari } from "./is-ios-safari";
export {
  type DecideIosBottomSheetVisibilityInput,
  type IosBottomSheetHiddenReason,
  type IosBottomSheetVisibility,
  type PushChannelStatus,
  decideIosBottomSheetVisibility,
} from "./decide-ios-bottom-sheet-visibility";
export {
  type DecideIosStandaloneHeuristicInput,
  type IosStandaloneHeuristicDecision,
  decideIosStandaloneHeuristic,
} from "./decide-ios-standalone-heuristic";
export { A2HS_IOS_SHEET_DISMISS_KEY } from "./session-keys";
