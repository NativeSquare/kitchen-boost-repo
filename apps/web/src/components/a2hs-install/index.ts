/**
 * PWA-S10 (#462) — `a2hs-install` component re-exports (A2HS Android post-cart
 * — decisions-log Q4, US 56-57-59).
 *
 *  - `<PWAInstallProvider>` — captures the Android Chrome
 *    `beforeinstallprompt` event at the ROOT layout so the post-cart button
 *    can consume it later. Also listens for the `appinstalled` window event
 *    (Chrome 3-dot-menu install path).
 *  - `<AndroidInstallButton>` — fixed bottom-right floating CTA rendered
 *    conditionally (4-gate decision in `lib/a2hs-install`) on cart-bearing
 *    routes (/menu + /panier). Click → native Android install sheet →
 *    `customer.pushEnrollment.recordA2hsAccepted` mutation on accept.
 *
 * iOS A2HS bottom-sheet is a SEPARATE surface (PWA-S11 #463) — out of scope.
 */
export {
  type BeforeInstallPromptEvent,
  type PWAInstallContextValue,
  PWAInstallProvider,
  usePWAInstall,
} from "./pwa-install-context";
export {
  type AndroidInstallButtonProps,
  AndroidInstallButton,
} from "./android-install-button";
