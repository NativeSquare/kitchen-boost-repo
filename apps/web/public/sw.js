/* PWA-S2 (#450) — KitchenBoost PWA service worker.
 *
 * Scope: `/` (registered by `<ServiceWorkerRegistration>` in the root layout).
 * Update strategy: `skipWaiting + clients.claim` so a deploy is live on the
 * next request without a user-facing toast (PRD §10 PWA Client Q4 « pas de
 * toast user, friction inutile client final »).
 *
 * NO Workbox. NO offline cache (V1 cmd flow needs network end-to-end).
 *
 * Two non-trivial decisions mirror the PURE TS algorithm in
 * `apps/web/src/lib/sw/decide-sw-handlers.ts` (vitest-pinned):
 *  - `push`              → see `deriveNotificationOptions`
 *  - `notificationclick` → see `decideNotificationClickAction`
 *
 * If you change the algorithm here, change it THERE first (red test), then
 * mirror the bytes here.
 */
/* global self, clients */
"use strict";

self.addEventListener("install", () => {
  // Activate the new SW immediately, skipping the default "wait for all tabs
  // to close" gate. Pairs with `clients.claim()` below for an in-place upgrade.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of every open client (existing PWA tabs) without a reload.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  // Backend dispatches the encrypted body as JSON. Defensive parse so a
  // malformed push (unlikely — we sign with VAPID) does NOT crash the SW.
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch (_e) {
    payload = null;
  }
  if (!payload || typeof payload.title !== "string") return;

  // Mirror of `deriveNotificationOptions` — tag prefers orderId then campaignId.
  const data = payload.data || {};
  const tag = data.orderId || data.campaignId || undefined;
  const options = {
    body: typeof payload.body === "string" ? payload.body : "",
    data: data,
  };
  if (tag !== undefined) options.tag = tag;

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const origin = self.location.origin;
  const rawUrl = typeof data.url === "string" ? data.url : "/";

  // Mirror of `resolveTargetUrl`.
  const targetUrl =
    rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
      ? rawUrl
      : origin + (rawUrl.startsWith("/") ? rawUrl : "/" + rawUrl);

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(function (clientList) {
        // Cross-origin target → always open a fresh window.
        if (!targetUrl.startsWith(origin + "/")) {
          return self.clients.openWindow(targetUrl);
        }
        // Mirror of `pickSameOriginClient` — prefer a focused tab.
        const sameOrigin = clientList.filter(function (c) {
          return c.url.indexOf(origin + "/") === 0;
        });
        if (sameOrigin.length === 0) {
          return self.clients.openWindow(targetUrl);
        }
        const target =
          sameOrigin.find(function (c) {
            return c.focused;
          }) || sameOrigin[0];
        // `navigate` returns the WindowClient; chain `focus` so the tab
        // surfaces above the browser. Both methods are widely supported.
        return target.navigate(targetUrl).then(function (client) {
          return client && client.focus ? client.focus() : undefined;
        });
      }),
  );
});
