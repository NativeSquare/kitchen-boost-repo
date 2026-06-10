/**
 * PWA-S11 (#463) — sessionStorage key for the iOS A2HS bottom-sheet
 * « OK plus tard » dismiss flag (decisions-log Q4, US 58).
 *
 * Centralised here so the component + a future test fixture share ONE
 * source of truth (mirror of `WALLET_PROMPT_BANNER_DISMISS_KEY` in
 * `lib/wallet-prompt`).
 *
 * Key : `kb_a2hs_ios_sheet_dismissed` (kb_ prefix avoids collisions with
 * other 1st-party storage like cart/verdict + 3rd-party scripts the resto
 * might attach to its branded domain).
 *
 * Value : the literal string `"1"` (one-byte truthy marker — presence/
 * absence drives the boolean, content irrelevant).
 *
 * Scope :
 *  - sessionStorage = per browser tab, cleared on tab close.
 *  - Survives intra-session navigation (the user dismisses on /c/[orderId]
 *    then re-opens the same orderId after a menu detour — the sheet stays
 *    dismissed for the rest of the session).
 *  - Next session (new tab/window/visit) starts fresh → the sheet
 *    re-appears on the next T+0 tracking page IF the install hasn't
 *    happened in the meantime (the Convex sub on `a2hsStatus = "enrolled"`
 *    would otherwise hide it via the pure decision regardless of dismiss).
 */
export const A2HS_IOS_SHEET_DISMISS_KEY = "kb_a2hs_ios_sheet_dismissed";
