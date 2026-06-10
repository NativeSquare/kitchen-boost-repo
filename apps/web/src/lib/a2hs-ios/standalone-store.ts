/**
 * PWA-S11 (#463) — `useSyncExternalStore` adapters for
 * `window.matchMedia('(display-mode: standalone)')`.
 *
 * Extracted here so both `<IOSInstallBottomSheet>` and
 * `<IOSStandaloneHeuristicRunner>` (and any future surface needing the
 * standalone signal) share ONE implementation. Same external-store shape
 * as `<AndroidInstallButton>` (#462) — kept SSR-safe (server snapshot
 * pinned to `false`) and defensive against exotic MediaQueryList APIs
 * (legacy `addListener` fallback).
 *
 * The hook itself stays in the components (the standard
 * `useSyncExternalStore` invocation) — only the three slots
 * (subscribe / getSnapshot / getServerSnapshot) live here, so the module
 * stays import-only-from-React-clients (no React imports needed in this
 * file → testable in pure node env).
 */

const STANDALONE_MEDIA_QUERY = "(display-mode: standalone)";

/** Read whether the PWA is currently in installed standalone mode. */
export function readIsStandalone(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.matchMedia(STANDALONE_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * SSR snapshot — always false so server HTML and the first client paint
 * agree (the standalone signal is purely runtime).
 */
export function getServerIsStandalone(): boolean {
  return false;
}

/**
 * Subscribe to `matchMedia` changes so a user installing mid-session
 * (rare but possible — they tap the email link in the standalone PWA
 * after following the GIF instructions) triggers a re-render.
 */
export function subscribeIsStandalone(notify: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  let mql: MediaQueryList;
  try {
    mql = window.matchMedia(STANDALONE_MEDIA_QUERY);
  } catch {
    return () => {};
  }
  const onChange = (): void => notify();
  // Modern API (Safari 14+, all evergreen) — fall back to deprecated
  // addListener for older WebViews. Mirror of #462.
  if (typeof mql.addEventListener === "function") {
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }
  mql.addListener(onChange);
  return () => mql.removeListener(onChange);
}
