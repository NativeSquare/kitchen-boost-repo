/**
 * PWA-S2 (#450) — `deriveNotificationOptions` + `decideNotificationClickAction`
 * — the PURE handler logic the service worker (`public/sw.js`) mirrors.
 * Written BEFORE the implementation (TDD red).
 *
 * The service worker itself is a hand-written `public/sw.js` (~50 lines, must
 * be raw JS — SW lives at a fixed URL and isn't bundled). To keep the logic
 * unit-testable WITHOUT spinning a service-worker test environment, the two
 * non-trivial decisions are extracted here as pure functions:
 *  - `deriveNotificationOptions(payload)` → what `showNotification(title, opts)`
 *    receives for a given backend payload (notifications CONTEXT « Push web »
 *    + PRD §10 PWA Client Q4 « SW affiche push avec emoji prefix VERBATIM »).
 *  - `decideNotificationClickAction(notification, openClients)` → for a tap
 *    on a notification, decide whether to focus + navigate an existing PWA
 *    window OR open a fresh one (PRD §10 Q4 « notificationclick deep-link via
 *    clients.openWindow / focus+navigate existing »).
 *
 * The `public/sw.js` file uses the SAME constants + algorithm — a comment
 * there points back to this module so future maintainers know the source of
 * truth lives here.
 */
import { describe, expect, it } from "vitest";
import {
  decideNotificationClickAction,
  deriveNotificationOptions,
  type PushPayload,
} from "./decide-sw-handlers";

describe("deriveNotificationOptions — title VERBATIM (no client-side formatting)", () => {
  it("keeps the emoji prefix + resto name VERBATIM from the payload (US 60)", () => {
    // PRD §10 PWA Client AC: « SW affiche push notifications avec le `title`
    // verbatim du payload (le payload backend contient déjà l'emoji prefix +
    // nom resto formatés, ex: "🥢 Buns & Bao : -20% bao ce soir") ».
    const payload: PushPayload = {
      title: "🥢 Buns & Bao : -20% bao ce soir",
      body: "Code BAO20",
      data: { url: "/menu" },
    };
    const result = deriveNotificationOptions(payload);
    // The function returns BOTH title (string) + options — caller passes both
    // to `registration.showNotification`. We assert the title is untouched
    // (no toLowerCase, no truncation, no extra prefix client-side).
    expect(result.title).toBe("🥢 Buns & Bao : -20% bao ce soir");
    expect(result.options.body).toBe("Code BAO20");
  });

  it("uses the `orderId` as the collapse tag when present (transactional push)", () => {
    // Tag collapse: a second push for the same order replaces the first in
    // the lock-screen tray (no spam — PRD §10 Q4 « tag: orderId|campaignId »).
    const payload: PushPayload = {
      title: "🚴 Courier en route",
      body: "ETA 12 min",
      data: { url: "/c/order_abc", orderId: "order_abc" },
    };
    const result = deriveNotificationOptions(payload);
    expect(result.options.tag).toBe("order_abc");
  });

  it("uses the `campaignId` as the collapse tag when present (marketing push)", () => {
    const payload: PushPayload = {
      title: "🍕 Pizza Roma : -10% ce soir",
      body: "Profite avant 22h",
      data: { url: "/menu?promo=cmp_42", campaignId: "cmp_42" },
    };
    const result = deriveNotificationOptions(payload);
    expect(result.options.tag).toBe("cmp_42");
  });

  it("prefers `orderId` over `campaignId` when both are present (transactional priority)", () => {
    // A transactional event mid-campaign should NOT be silently replaced by
    // the marketing push — the order push gets its own tag.
    const payload: PushPayload = {
      title: "Hybrid",
      body: "Hybrid",
      data: {
        url: "/c/order_abc",
        orderId: "order_abc",
        campaignId: "cmp_42",
      },
    };
    const result = deriveNotificationOptions(payload);
    expect(result.options.tag).toBe("order_abc");
  });

  it("falls back to no `tag` when neither orderId nor campaignId is present", () => {
    // No tag → each notification stacks separately. Safer default than a
    // hard-coded shared tag (which would silently drop a previous push).
    const payload: PushPayload = {
      title: "Ad-hoc",
      body: "msg",
      data: { url: "/" },
    };
    const result = deriveNotificationOptions(payload);
    expect(result.options.tag).toBeUndefined();
  });

  it("threads the payload data through to `options.data` so the click handler can read it", () => {
    // The notificationclick handler reads `event.notification.data.url` to
    // decide where to navigate. The push handler MUST pass the raw `data`
    // object on so the round-trip works.
    const payload: PushPayload = {
      title: "x",
      body: "x",
      data: { url: "/c/order_abc", orderId: "order_abc" },
    };
    const result = deriveNotificationOptions(payload);
    expect(result.options.data).toEqual({
      url: "/c/order_abc",
      orderId: "order_abc",
    });
  });

  it("falls back to an empty body when the payload has no body", () => {
    // The `body` field is optional in the backend dispatch — a payload with
    // only a title (rare but possible) must NOT crash the SW.
    const payload: PushPayload = {
      title: "Title only",
      data: { url: "/" },
    };
    const result = deriveNotificationOptions(payload);
    expect(result.options.body).toBe("");
  });
});

describe("decideNotificationClickAction — deep-link to PWA window", () => {
  it("returns `focus-existing` when an existing client matches the target URL origin", () => {
    // US 61: tap → land on the deep-link URL. If a PWA window is already
    // open on the same origin, FOCUS it + navigate (vs opening a duplicate
    // tab) — PRD §10 Q4 « focus+navigate existing window ».
    const action = decideNotificationClickAction({
      notificationData: { url: "/c/order_abc" },
      openClients: [
        { url: "https://buns.kitchen-boost.com/menu", focused: false },
      ],
      origin: "https://buns.kitchen-boost.com",
    });
    expect(action.kind).toBe("focus-existing");
    if (action.kind === "focus-existing") {
      expect(action.clientUrl).toBe("https://buns.kitchen-boost.com/menu");
      expect(action.targetUrl).toBe(
        "https://buns.kitchen-boost.com/c/order_abc",
      );
    }
  });

  it("returns `open-window` when no existing client matches the origin", () => {
    const action = decideNotificationClickAction({
      notificationData: { url: "/c/order_abc" },
      openClients: [
        { url: "https://other.kitchen-boost.com/menu", focused: false },
      ],
      origin: "https://buns.kitchen-boost.com",
    });
    expect(action.kind).toBe("open-window");
    if (action.kind === "open-window") {
      expect(action.targetUrl).toBe(
        "https://buns.kitchen-boost.com/c/order_abc",
      );
    }
  });

  it("returns `open-window` when no clients are open at all", () => {
    const action = decideNotificationClickAction({
      notificationData: { url: "/menu" },
      openClients: [],
      origin: "https://buns.kitchen-boost.com",
    });
    expect(action.kind).toBe("open-window");
    if (action.kind === "open-window") {
      expect(action.targetUrl).toBe("https://buns.kitchen-boost.com/menu");
    }
  });

  it("defaults the target to `/` when the notification data has no url", () => {
    // Defensive: a malformed payload (no url) lands the user on the home
    // page rather than throwing inside the SW.
    const action = decideNotificationClickAction({
      notificationData: {},
      openClients: [],
      origin: "https://buns.kitchen-boost.com",
    });
    expect(action.kind).toBe("open-window");
    if (action.kind === "open-window") {
      expect(action.targetUrl).toBe("https://buns.kitchen-boost.com/");
    }
  });

  it("preserves an absolute URL in notification data (cross-tenant deep link)", () => {
    // US 63: cross-tenant push (« Nouveau resto à 5 min de chez toi ») carries
    // an ABSOLUTE URL pointing at the OTHER tenant's PWA. The SW must NOT
    // re-anchor it to the current origin.
    const action = decideNotificationClickAction({
      notificationData: {
        url: "https://pizza.kitchen-boost.com/menu?promo=42",
      },
      openClients: [],
      origin: "https://buns.kitchen-boost.com",
    });
    expect(action.kind).toBe("open-window");
    if (action.kind === "open-window") {
      expect(action.targetUrl).toBe(
        "https://pizza.kitchen-boost.com/menu?promo=42",
      );
    }
  });

  it("prefers the focused client over an un-focused one when multiple same-origin clients are open", () => {
    // A subtle preference: if the user has two tabs of the same PWA open,
    // navigate the one that already has focus (their CURRENT context).
    const action = decideNotificationClickAction({
      notificationData: { url: "/c/order_abc" },
      openClients: [
        { url: "https://buns.kitchen-boost.com/menu", focused: false },
        { url: "https://buns.kitchen-boost.com/panier", focused: true },
      ],
      origin: "https://buns.kitchen-boost.com",
    });
    expect(action.kind).toBe("focus-existing");
    if (action.kind === "focus-existing") {
      expect(action.clientUrl).toBe("https://buns.kitchen-boost.com/panier");
    }
  });
});
