/**
 * PWA-S6a (#455) — `decideDeviceTarget` — pure decision returning which Wallet
 * install flow `<AddToWalletButton>` should expose for a given user-agent
 * string (decisions-log Q5 « Distribution device-specific iOS Blob /
 * Android Save link / Desktop disabled »).
 *
 * 3 buckets:
 *   - `"ios"`     → Blob `application/vnd.apple.pkpass` → `URL.createObjectURL`
 *                   → `window.location.assign(blobUrl)` → Safari intercepts MIME
 *                   → native Apple Wallet sheet (US 31).
 *   - `"android"` → `window.location.href = googleSaveLink` → Google Wallet
 *                   preview (US 32).
 *   - `"desktop"` → button disabled + message « Disponible sur mobile uniquement »
 *                   (Q5 explicitly rejects desktop install — Wallet is mobile-only).
 *
 * Splitting the device detection from the React IO keeps every branch
 * vitest-pinnable in node env (mirroring `decidePaymentGate` /
 * `decideAddressFirstAction` shape). The actual browser detection happens via
 * the user-agent string the React component reads from `navigator.userAgent` —
 * passed as an explicit argument here so the function is pure and the test
 * fixtures can pin every relevant UA.
 *
 * Detection rule (Q5):
 *   1. iPhone / iPod / iPad UA tokens → `ios` (iPadOS still ships «Safari» +
 *      «AppleWebKit» but the «iPad» token is enough for the binary triage).
 *   2. iPadOS 13+ desktop-mode no longer says iPad → presents as Mac. We
 *      deliberately do NOT detect desktop-mode iPad V1 (Sophie's PWA target
 *      is the iPhone, US 31) — Mac UA stays `desktop`. Decisions-log accepted
 *      trade-off.
 *   3. Android UA token → `android`.
 *   4. Everything else (Mac / Windows / Linux / unknown) → `desktop`.
 *   5. Empty / undefined UA → `desktop` (safe default: never offer a Blob
 *      install we can't support).
 */

export type DeviceTarget = "ios" | "android" | "desktop";

export type DecideDeviceTargetInput = {
  /**
   * The browser user-agent string. Pass `undefined` for the SSR path where
   * `navigator` isn't available — the function will safely return `"desktop"`.
   */
  userAgent: string | undefined;
};

/**
 * Decide the Wallet install flow bucket for a given UA. Order matters:
 * Apple-family checks first (iPhone / iPod / iPad), then Android, then
 * desktop default.
 */
export function decideDeviceTarget(
  input: DecideDeviceTargetInput,
): DeviceTarget {
  const ua = input.userAgent ?? "";
  if (ua === "") return "desktop";

  // Apple family. iPad UA matters before Android because the iPad UA can
  // contain "Mobile" but never "Android".
  if (/iPhone|iPod|iPad/.test(ua)) return "ios";

  // Android (any browser).
  if (/Android/.test(ua)) return "android";

  return "desktop";
}
