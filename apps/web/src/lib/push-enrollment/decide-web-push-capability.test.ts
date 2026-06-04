/**
 * PWA-S6b (#456) — `decideWebPushCapability` — the pure capability check that
 * decides whether the modal exposes the Web Push option at all (US 35 + Q8
 * « Cas iOS < 16.4 ou iOS sans A2HS : `'PushManager' in window === false`
 * détecté côté front → option Web Push masquée par le modal »).
 *
 * Three real-world causes of « not supported » a fresh PWA hits in the wild:
 *  - **iOS < 16.4 Safari** : no `PushManager` constructor on `window` (Apple
 *    only shipped the Web Push API on iOS 16.4+). This is the headline case
 *    the modal masking targets — US 35 is « As Sophie iOS <16.4, I want the
 *    Web Push option masked from the modal, so I'm not offered something that
 *    won't work ».
 *  - **Older Android browser without Service Worker** : `serviceWorker` missing
 *    on `navigator`. Can't `pushManager.subscribe()` without a SW.
 *  - **Notification API missing** : `Notification` constructor absent on
 *    `window` (e.g. private browsing on certain Firefox builds). Without
 *    `Notification.requestPermission()`, the modal can't prompt at all.
 *
 * The function deliberately takes 3 booleans rather than reading the live
 * globals — keeps it node-pinnable + lets the React caller decide which
 * runtime probe maps to each (`'PushManager' in window`, `'serviceWorker' in
 * navigator`, `'Notification' in window`). Decisions-log Q8 explicitly calls
 * out `'PushManager' in window === false` as THE detection rule.
 */
import { describe, expect, it } from "vitest";
import {
  type WebPushCapability,
  decideWebPushCapability,
} from "./decide-web-push-capability";

describe("decideWebPushCapability — supported branch", () => {
  it("returns `supported` when all 3 capabilities are present (Android Chrome / iOS 16.4+)", () => {
    expect(
      decideWebPushCapability({
        hasPushManager: true,
        hasServiceWorker: true,
        hasNotification: true,
      }),
    ).toEqual({ kind: "supported" });
  });
});

describe("decideWebPushCapability — unsupported branch (iOS <16.4 = THE masking case)", () => {
  it("returns `unsupported` with reason `no-push-manager` when `'PushManager' in window === false` (US 35 iOS <16.4)", () => {
    const result = decideWebPushCapability({
      hasPushManager: false,
      hasServiceWorker: true,
      hasNotification: true,
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("no-push-manager");
    }
  });

  it("returns `unsupported` with reason `no-service-worker` when SW API missing (legacy Android browser)", () => {
    const result = decideWebPushCapability({
      hasPushManager: true,
      hasServiceWorker: false,
      hasNotification: true,
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("no-service-worker");
    }
  });

  it("returns `unsupported` with reason `no-notification` when `Notification` constructor missing", () => {
    const result = decideWebPushCapability({
      hasPushManager: true,
      hasServiceWorker: true,
      hasNotification: false,
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("no-notification");
    }
  });

  it("returns `unsupported` (no-push-manager takes priority) when all 3 missing — most explicit single root cause", () => {
    // Priority order matters for the error message we ultimately surface
    // (we don't show 3 reasons). The Q8 spec calls out PushManager as THE
    // detection axis, so it wins over the other two when all are absent.
    const result = decideWebPushCapability({
      hasPushManager: false,
      hasServiceWorker: false,
      hasNotification: false,
    });
    expect(result.kind).toBe("unsupported");
    if (result.kind === "unsupported") {
      expect(result.reason).toBe("no-push-manager");
    }
  });
});

describe("decideWebPushCapability — purity", () => {
  it("returns equivalent results for the same input (referential transparency)", () => {
    const a = decideWebPushCapability({
      hasPushManager: true,
      hasServiceWorker: true,
      hasNotification: true,
    });
    const b = decideWebPushCapability({
      hasPushManager: true,
      hasServiceWorker: true,
      hasNotification: true,
    });
    expect(a).toEqual(b);
  });

  it("never mutates the input object", () => {
    const input = Object.freeze({
      hasPushManager: false,
      hasServiceWorker: true,
      hasNotification: true,
    });
    expect(() => decideWebPushCapability(input)).not.toThrow();
  });

  it("exposes a discriminated union on `kind` (exhaustive switch)", () => {
    const all: ReadonlyArray<WebPushCapability> = [
      { kind: "supported" },
      { kind: "unsupported", reason: "no-push-manager" },
      { kind: "unsupported", reason: "no-service-worker" },
      { kind: "unsupported", reason: "no-notification" },
    ];
    for (const c of all) {
      expect(["supported", "unsupported"]).toContain(c.kind);
    }
  });
});
