/**
 * PWA-S9a (#460) — `wallet-prompt` module API.
 *
 * Pure decision consumed by both Wallet prompt UI surfaces (palier 1 card
 * after address-first + palier 2 banner permanent menu/panier — decisions-log
 * Q5 « 3 paliers Wallet install », US 27 + US 28):
 *
 *  - `decideWalletPromptVisibility` — given the live `walletStatus` from the
 *    customer's `pushEnrollment` + a session-scoped `dismissed` flag, decide
 *    whether the prompt should render or stay hidden (and WHY).
 *
 * Splitting the decision from the React IO keeps every branch vitest-pinnable
 * in node env, same shape as `checkout-gate` / `push-enrollment` /
 * `address-first`. The `<WalletPromptCard>` + `<WalletPromptBanner>`
 * components wire the IO around this pure function.
 */
export {
  type DecideWalletPromptVisibilityInput,
  type PushChannelStatus,
  type WalletPromptVisibility,
  decideWalletPromptVisibility,
} from "./decide-wallet-prompt-visibility";
export { WALLET_PROMPT_BANNER_DISMISS_KEY } from "./session-keys";
