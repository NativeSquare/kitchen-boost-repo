/**
 * PWA-S9a (#460) — sessionStorage key for the palier 2 banner dismissal flag
 * (issue AC « X session-scoped (sessionStorage) »). Centralised here so the
 * banner component + a future test fixture share ONE source of truth (mirror
 * of the `VERDICT_STORAGE_KEY` pattern from `lib/delivery-mode`).
 *
 * The KEY is `kb_wallet_banner_dismissed` (kb_ prefix avoids collisions
 * with other 1st-party storage like cart/verdict + 3rd-party scripts the
 * resto might attach to its branded domain).
 *
 * The VALUE is the literal string `"1"` (any truthy value would do — we
 * pick a one-byte value so quota pressure is minimal). The presence/absence
 * of the key drives the boolean; the value content is irrelevant.
 *
 * sessionStorage scope :
 *  - Per browser tab : a new tab gets a fresh empty storage → the banner
 *    re-appears (intended behaviour — the « next session » in the AC means
 *    the next tab/window/visit).
 *  - Cleared on tab close. NOT cleared on navigation between
 *    /menu ↔ /panier within the same tab (the banner stays dismissed across
 *    the cart + menu pages of the same browsing session).
 *  - NOT cleared on Wallet install (the install flips `walletStatus` to
 *    `"enrolled"` → the pure decision already hides the prompt regardless
 *    of dismissed).
 */
export const WALLET_PROMPT_BANNER_DISMISS_KEY = "kb_wallet_banner_dismissed";
