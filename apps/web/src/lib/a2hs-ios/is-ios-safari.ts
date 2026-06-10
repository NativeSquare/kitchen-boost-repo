/**
 * PWA-S11 (#463) — `isIosSafari` — pure UA sniff for the iOS A2HS surface
 * (decisions-log Q4 « iOS bottom-sheet GIF instructions sur page Tracking
 * T+0 », US 58).
 *
 * iOS Safari is the ONLY iOS browser exposing the Share → « Sur l'écran
 * d'accueil » → « Ajouter » path the GIF illustrates. In-app browsers
 * (Instagram / Facebook / TikTok WebViews) and other iOS browsers (CriOS /
 * FxiOS / EdgiOS / OPiOS — all WebKit-based but with their own UI chrome)
 * do NOT expose that share-sheet entry, so a bottom-sheet shown there would
 * dead-end the user.
 *
 * Two checks combined:
 *  1. The UA mentions `iPhone` / `iPad` / `iPod` — strict device family
 *     (iPadOS still reports `iPad` in its mobile UA; the desktop-mode UA
 *     spoof is the user's responsibility — at worst we hide a hint that
 *     wouldn't work either way).
 *  2. The UA does NOT contain any known non-Safari browser tag. The list
 *     is conservative: Chrome (`CriOS`), Firefox (`FxiOS`), Edge (`EdgiOS`),
 *     Opera (`OPiOS`), Instagram (`Instagram`), Facebook (`FBAN`/`FBAV`),
 *     TikTok (`musical_ly`), Snapchat (`Snapchat`), Pinterest
 *     (`Pinterest`/`PinterestiOS`).
 *
 * `userAgent` is `string | undefined` so the SSR snapshot (no UA available
 * yet) just returns `false` — the runner re-evaluates on mount with the real
 * `navigator.userAgent`.
 */
const IOS_DEVICE_REGEX = /iPhone|iPad|iPod/;

/**
 * Tokens that, if present, disqualify the UA as « real » iOS Safari.
 * Conservative list — adding here is safe, removing requires evidence the
 * browser DOES expose the share-sheet → A2HS path.
 */
const NON_SAFARI_TOKENS = [
  "CriOS", // Chrome iOS
  "FxiOS", // Firefox iOS
  "EdgiOS", // Edge iOS
  "OPiOS", // Opera iOS
  "Instagram",
  "FBAN", // Facebook in-app
  "FBAV",
  "FB_IAB", // Facebook in-app browser (Android-style token, defensive)
  "musical_ly", // TikTok
  "Snapchat",
  "Pinterest",
  "PinterestiOS",
];

export function isIosSafari(userAgent: string | undefined): boolean {
  if (typeof userAgent !== "string" || userAgent.length === 0) return false;
  if (!IOS_DEVICE_REGEX.test(userAgent)) return false;
  for (const token of NON_SAFARI_TOKENS) {
    if (userAgent.includes(token)) return false;
  }
  return true;
}
