/**
 * PWA-S2 (#450) — `deriveNotificationOptions` + `decideNotificationClickAction`
 * — the PURE handler logic mirrored by `public/sw.js`.
 *
 * The service worker is a hand-written raw-JS file (`public/sw.js`) because
 * a SW lives at a fixed URL and cannot be bundled. To keep the branching
 * logic unit-testable WITHOUT spinning a service-worker test environment,
 * the two non-trivial decisions live here as pure TS functions; the SW
 * imports nothing — it just MIRRORS this exact algorithm.
 *
 * A comment at the top of `public/sw.js` points back to this file so future
 * maintainers know the source of truth.
 */

/** The data envelope the backend dispatch puts in the encrypted push body. */
export type PushPayload = {
  /** VERBATIM title — backend has already formatted the emoji prefix + resto
   * name (US 60 / PRD §10 Q4). The SW does NOT re-format. */
  title: string;
  /** Optional body line. Empty string in the showNotification options when
   * absent (a missing body would log a warning in some browsers). */
  body?: string;
  /** Round-trip data the notificationclick handler reads. `url` is the
   * deep-link target; `orderId` / `campaignId` are tags for collapse. */
  data: {
    url?: string;
    orderId?: string;
    campaignId?: string;
  };
};

/** The args the SW passes to `registration.showNotification(title, options)`. */
export type ShowNotificationArgs = {
  title: string;
  options: {
    body: string;
    tag?: string;
    data: PushPayload["data"];
  };
};

/**
 * Decide what `showNotification` receives for a given backend payload.
 *
 * Title is VERBATIM (US 60). Tag prefers `orderId` over `campaignId` so a
 * transactional event mid-marketing-campaign is not silently swallowed.
 */
export function deriveNotificationOptions(
  payload: PushPayload,
): ShowNotificationArgs {
  const tag = payload.data.orderId ?? payload.data.campaignId;
  return {
    title: payload.title,
    options: {
      body: payload.body ?? "",
      ...(tag === undefined ? {} : { tag }),
      data: payload.data,
    },
  };
}

/** Minimal projection of a `Clients.matchAll()` entry the SW iterates over. */
export type OpenClientHandle = {
  url: string;
  focused: boolean;
};

export type NotificationClickInput = {
  notificationData: { url?: string };
  openClients: OpenClientHandle[];
  /** `self.location.origin` — the PWA's own origin (host-scoped SW). */
  origin: string;
};

export type NotificationClickAction =
  | {
      kind: "focus-existing";
      /** The PWA window URL we will `focus()` + `navigate(targetUrl)`. */
      clientUrl: string;
      /** Absolute URL to navigate the focused client to. */
      targetUrl: string;
    }
  | {
      kind: "open-window";
      /** Absolute URL to pass to `clients.openWindow(...)`. */
      targetUrl: string;
    };

/**
 * Resolve a (possibly relative) URL in the notification payload against the
 * PWA origin. Absolute URLs (cross-tenant deep links) are passed through.
 * Defensive: a missing url lands the user on the home page.
 */
function resolveTargetUrl(
  notificationUrl: string | undefined,
  origin: string,
): string {
  const raw = notificationUrl ?? "/";
  // Pure string check rather than `new URL()` to keep the SW byte-for-byte
  // mirror trivial (no URL constructor in the algorithm).
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `${origin}${raw.startsWith("/") ? raw : `/${raw}`}`;
}

/**
 * Same-origin client lookup, preferring a focused tab. Cross-origin clients
 * are ignored — opening a fresh window is the correct UX (the user does NOT
 * want a different tenant's PWA hijacked into a deep link).
 */
function pickSameOriginClient(
  clients: OpenClientHandle[],
  origin: string,
): OpenClientHandle | null {
  const sameOrigin = clients.filter((c) => c.url.startsWith(`${origin}/`));
  if (sameOrigin.length === 0) return null;
  return sameOrigin.find((c) => c.focused) ?? sameOrigin[0] ?? null;
}

/**
 * Decide focus-existing vs open-window for a notification tap (PRD §10 Q4,
 * US 61). Encodes the cross-tenant nuance (US 63): an absolute URL pointing
 * at ANOTHER tenant's PWA always opens a fresh window — we do not focus a
 * Buns & Bao tab to send the user to Pizza Roma.
 */
export function decideNotificationClickAction(
  input: NotificationClickInput,
): NotificationClickAction {
  const targetUrl = resolveTargetUrl(input.notificationData.url, input.origin);
  // Cross-origin target → always open-window. Same-origin → focus an existing
  // tab if there is one.
  if (!targetUrl.startsWith(`${input.origin}/`)) {
    return { kind: "open-window", targetUrl };
  }
  const existing = pickSameOriginClient(input.openClients, input.origin);
  if (existing === null) {
    return { kind: "open-window", targetUrl };
  }
  return { kind: "focus-existing", clientUrl: existing.url, targetUrl };
}
