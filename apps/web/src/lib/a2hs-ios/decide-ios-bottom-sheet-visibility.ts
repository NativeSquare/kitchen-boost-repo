/**
 * PWA-S11 (#463) — `decideIosBottomSheetVisibility` — pure decision returning
 * whether the iOS A2HS instructional bottom-sheet (`<IOSInstallBottomSheet>`,
 * Vaul Drawer rendered on `/c/[orderId]` state T+0) should render right now
 * (decisions-log Q4 « iOS bottom-sheet GIF instructions », US 58).
 *
 * Four conditions ALL required to SHOW (any missing → hidden):
 *   1. `isIosSafari = true`              — only Safari has the share-sheet → A2HS path
 *                                          (the GIF instructions are Safari-specific)
 *   2. `isStandalone = false`            — not already running as an installed PWA
 *                                          (standalone = install completed, nothing
 *                                          to instruct)
 *   3. `a2hsStatus !== "enrolled"`       — backend already saw the install
 *                                          (heuristique S11 — once flipped, retire)
 *   4. `dismissed = false`               — session-scoped « OK plus tard » respect
 *                                          (sessionStorage)
 *
 * Splitting the decision from the React IO keeps every branch vitest-pinnable
 * in node env, same shape as `decideA2hsButtonVisibility` (#462 sibling).
 * Both A2HS surfaces (Android button + iOS sheet) share the precedence order
 * for the analytics breadcrumb:
 *   enrolled > standalone > device-mismatch > soft-trigger.
 *
 * `PushChannelStatus` mirrors the backend `pushChannelStatus` union — we
 * re-declare it locally (same pattern as #462 / wallet-prompt / checkout-gate)
 * so the front never gains a transitive backend coupling.
 */

/** Per-channel push enrollment status (mirror of backend `pushChannelStatus`). */
export type PushChannelStatus = "enrolled" | "not_enrolled" | "revoked";

export type DecideIosBottomSheetVisibilityInput = {
  /**
   * Result of `isIosSafari(navigator.userAgent)` evaluated on mount. Stays
   * `false` on Android (US 59 AC 4 « Android → bottom sheet n'apparaît
   * jamais »), on iOS in-app browsers (Instagram / Facebook / TikTok), on
   * iOS Chrome / Firefox / Edge / Opera (different share-menu UI), and on
   * desktop.
   */
  isIosSafari: boolean;
  /**
   * `true` when the PWA is running in installed standalone mode
   * (`window.matchMedia('(display-mode: standalone)').matches`). The
   * sibling `<IOSStandaloneHeuristicRunner>` flips `a2hsStatus = "enrolled"`
   * on the backend on the next visit; the sheet hides immediately on the
   * same visit so it never flashes inside the PWA itself.
   */
  isStandalone: boolean;
  /**
   * The live `a2hsStatus` from the customer's `pushEnrollment` (Convex sub
   * on `getCurrentCustomer`). Same treatment as #462: `undefined` /
   * `"not_enrolled"` / `"revoked"` all mean « not yet enrolled, show the
   * sheet »; only the explicit `"enrolled"` literal vetoes.
   */
  a2hsStatus: PushChannelStatus | undefined;
  /**
   * Session-scoped « OK plus tard » dismiss flag (sessionStorage). New tab
   * gets a fresh storage → the sheet re-appears on the next session — same
   * shape as `<WalletPromptBanner>` palier 2 (#460).
   */
  dismissed: boolean;
};

export type IosBottomSheetHiddenReason =
  | "already-enrolled"
  | "already-standalone"
  | "not-ios-safari"
  | "dismissed";

export type IosBottomSheetVisibility =
  | { kind: "show" }
  | { kind: "hidden"; reason: IosBottomSheetHiddenReason };

/**
 * Decide whether `<IOSInstallBottomSheet>` should render.
 *
 * Precedence rationale (strongest backend/device truth wins — mirrors #462):
 *  1. `a2hsStatus = "enrolled"` — loudest backend truth. They installed and
 *     the backend knows; the sheet is permanently retired on this fiche.
 *  2. `isStandalone = true` — live device truth (running INSIDE the PWA
 *     right now). The runner fires the mutation to flip the flag; the sheet
 *     hides immediately to avoid the flash.
 *  3. `!isIosSafari` — we literally can't instruct (Android, in-app browser,
 *     non-Safari iOS, desktop). The sibling A2HS surfaces (Android button)
 *     cover the other platforms.
 *  4. `dismissed` — soft session preference, last to surface.
 */
export function decideIosBottomSheetVisibility(
  input: DecideIosBottomSheetVisibilityInput,
): IosBottomSheetVisibility {
  if (input.a2hsStatus === "enrolled") {
    return { kind: "hidden", reason: "already-enrolled" };
  }
  if (input.isStandalone) {
    return { kind: "hidden", reason: "already-standalone" };
  }
  if (!input.isIosSafari) {
    return { kind: "hidden", reason: "not-ios-safari" };
  }
  if (input.dismissed) {
    return { kind: "hidden", reason: "dismissed" };
  }
  return { kind: "show" };
}
