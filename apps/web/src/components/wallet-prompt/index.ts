/**
 * PWA-S9a (#460) — `wallet-prompt` component re-exports (paliers 1 + 2 of the
 * 3-paliers Wallet install moat — decisions-log Q5, US 27 + US 28).
 *
 *  - `<WalletPromptCard>` (palier 1) — full-page card after a deliverable
 *    address-first verdict, with primary « Ajouter à mon Wallet » CTA +
 *    « Plus tard » skip.
 *  - `<WalletPromptBanner>` (palier 2) — permanent top banner on /menu +
 *    /panier, dismissable session-scoped via sessionStorage.
 *
 * Both surfaces share the pure `decideWalletPromptVisibility` decision +
 * the existing `<AddToWalletButton>` from `push-enrollment-modal/` (S6a
 * #455). Palier 3 (blocking modal at click-Payer) is already covered by
 * `<PushEnrollmentModal>` itself — not re-exported here.
 */
export {
  type WalletPromptBannerProps,
  WalletPromptBanner,
} from "./wallet-prompt-banner";
export {
  type WalletPromptCardProps,
  WalletPromptCard,
} from "./wallet-prompt-card";
