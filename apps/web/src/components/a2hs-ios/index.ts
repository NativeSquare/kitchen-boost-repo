/**
 * PWA-S11 (#463) — `a2hs-ios` component re-exports (iOS A2HS bottom-sheet
 * + standalone heuristique runner — decisions-log Q4, US 58 / 59).
 *
 *  - `<IOSInstallBottomSheet>` — Vaul Drawer rendered on `/c/[orderId]`
 *    state T+0 with the 3-step Safari Share → « Sur l'écran d'accueil » →
 *    « Ajouter » instructions. Visible only on iOS Safari, not standalone,
 *    not enrolled, not dismissed-this-session.
 *  - `<IOSStandaloneHeuristicRunner>` — mounted at the root layout, fires
 *    `customer.pushEnrollment.recordA2hsAccepted` the first time it detects
 *    standalone display-mode on a fiche whose `a2hsStatus` is not yet
 *    enrolled. Cross-platform safety net (iOS install signal proxy +
 *    Android `appinstalled`-event-missed race).
 *
 * Android Chrome install path (`beforeinstallprompt` event capture +
 * post-cart floating button) is the SIBLING surface PWA-S10 #462 — see
 * `apps/web/src/components/a2hs-install`.
 */
export {
  type IOSInstallBottomSheetProps,
  IOSInstallBottomSheet,
} from "./ios-install-bottom-sheet";
export {
  type IOSStandaloneHeuristicRunnerProps,
  IOSStandaloneHeuristicRunner,
} from "./ios-standalone-heuristic-runner";
