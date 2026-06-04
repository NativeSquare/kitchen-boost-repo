"use client";

/**
 * PWA-S2 (#450) — registers the PWA service worker (`public/sw.js`) on mount.
 *
 * Non-blocking by design (PRD §10 PWA Client Q4 « useEffect non-blocking,
 * échec silencieux »): a failed registration must NEVER break the PWA's
 * critical path (menu/cart/checkout). The render output is `null` — this is
 * a side-effect-only component the root layout mounts under `<body>`.
 *
 * Update strategy (`skipWaiting + clients.claim` in the SW itself) means a
 * new SW version takes over on the next request after deploy — no toast, no
 * reload prompt (friction inutile pour le client final, PRD §10 Q4).
 *
 * Scope is implicit (`/`) — the SW file is served from the origin root via
 * `public/sw.js`. The middleware matcher excludes `_next` / `api` / dotted
 * paths, so `/sw.js` (a literal dotted path) is served as a static file
 * without going through the tenant resolution edge logic — exactly what a
 * SW needs (it must be reachable at the origin root regardless of cookies).
 *
 * Browser support: `serviceWorker` is universal on modern Chrome / Safari /
 * Firefox. The `'serviceWorker' in navigator` guard short-circuits on older
 * browsers + on the server (SSR initial render).
 */
import { useEffect } from "react";

export function ServiceWorkerRegistration(): null {
  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    // Async wrapper so we can `await` cleanly; the effect doesn't await it
    // (registration runs in the background; failures are swallowed).
    void (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        // Silent failure — see PRD §10 Q4. The PWA's critical path must
        // never depend on SW registration succeeding (push enrollment is
        // gated separately at /checkout, PRD §9).
      }
    })();
  }, []);
  return null;
}
