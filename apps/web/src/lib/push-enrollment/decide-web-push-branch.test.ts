/**
 * PWA-S6b (#456) — `decideWebPushBranch` — the pure state machine driving the
 * `<WebPushSubscribeButton>` inside the modal (US 35 + decisions-log Q8 « Flow
 * Web Push permission »).
 *
 * Q8 flow (verbatim):
 *   1. Clic "Autoriser les notifs" → `Notification.requestPermission()` popup
 *      natif browser
 *   2. Si `granted` → `navigator.serviceWorker.ready.then(reg =>
 *      reg.pushManager.subscribe({applicationServerKey: VAPID_PUBLIC,
 *      userVisibleOnly: true}))` → reçoit `subscription`
 *   3. Mutation `customer.webPush.register({endpoint, p256dh, auth})` (déjà
 *      mergée 2.1-G)
 *   4. Backend flip `pushEnrollment.webPushStatus = "enrolled"` → Convex sub
 *      flip UI → close modal + proceed
 *   5. Si `denied` ou `default` (popup fermé sans choix) → display inline
 *      "Refusé — essaie une autre option" + compteur échecs incrémenté
 *
 * State machine:
 *   idle        -- ClickAuthorize        --> requesting-permission
 *   requesting  -- PermissionGranted     --> subscribing
 *   requesting  -- PermissionDenied      --> denied        (failureCount += 1)
 *   subscribing -- SubscribeSucceeded    --> registering
 *   subscribing -- SubscribeFailed       --> error         (failureCount += 1)
 *   registering -- RegisterSucceeded     --> registered
 *   registering -- RegisterFailed        --> error         (failureCount += 1)
 *   denied      -- ClickAuthorize        --> requesting    (retry — keep count)
 *   error       -- ClickAuthorize        --> requesting    (retry — keep count)
 *
 * The `registered` step is terminal here — the actual modal close happens via
 * the Convex sub on `customers.pushEnrollment.webPushStatus` flipping to
 * `"enrolled"`, which is the parent `<CheckoutForm>`'s responsibility (mirrors
 * the wallet path).
 *
 * `failureCount` is part of the state — Q8 (5) calls out the « compteur
 * échecs incrémenté ». S6c (#457) will read this counter to decide whether to
 * surface the fallback link. Keeping it in this reducer keeps the modal's
 * top-level reducer dumb.
 *
 * Every unknown (state, event) pair is a NO-OP (return same state) — same
 * convention as `decideModalStep`. A reducer that swallows stray events is
 * robust to component re-renders + double-clicks + race conditions during the
 * native permission popup.
 */
import { describe, expect, it } from "vitest";
import {
  type WebPushBranchEvent,
  type WebPushBranchState,
  decideWebPushBranch,
} from "./decide-web-push-branch";

const INITIAL: WebPushBranchState = { kind: "idle", failureCount: 0 };

describe("decideWebPushBranch — initial state", () => {
  it("starts at `idle` with 0 failures", () => {
    expect(INITIAL.kind).toBe("idle");
    expect(INITIAL.failureCount).toBe(0);
  });
});

describe("decideWebPushBranch — happy path (Android Chrome, granted)", () => {
  it("idle → requesting-permission on ClickAuthorize", () => {
    const next = decideWebPushBranch(INITIAL, { kind: "ClickAuthorize" });
    expect(next.kind).toBe("requesting-permission");
    expect(next.failureCount).toBe(0);
  });

  it("requesting-permission → subscribing on PermissionGranted", () => {
    const next = decideWebPushBranch(
      { kind: "requesting-permission", failureCount: 0 },
      { kind: "PermissionGranted" },
    );
    expect(next.kind).toBe("subscribing");
    expect(next.failureCount).toBe(0);
  });

  it("subscribing → registering on SubscribeSucceeded", () => {
    const next = decideWebPushBranch(
      { kind: "subscribing", failureCount: 0 },
      { kind: "SubscribeSucceeded" },
    );
    expect(next.kind).toBe("registering");
    expect(next.failureCount).toBe(0);
  });

  it("registering → registered on RegisterSucceeded", () => {
    const next = decideWebPushBranch(
      { kind: "registering", failureCount: 0 },
      { kind: "RegisterSucceeded" },
    );
    expect(next.kind).toBe("registered");
    expect(next.failureCount).toBe(0);
  });
});

describe("decideWebPushBranch — failure paths (compteur incrémenté — Q8 (5))", () => {
  it("requesting-permission → denied on PermissionDenied + failureCount += 1", () => {
    const next = decideWebPushBranch(
      { kind: "requesting-permission", failureCount: 0 },
      { kind: "PermissionDenied" },
    );
    expect(next.kind).toBe("denied");
    expect(next.failureCount).toBe(1);
  });

  it("subscribing → error on SubscribeFailed + failureCount += 1 (Convex / VAPID / network throw)", () => {
    const next = decideWebPushBranch(
      { kind: "subscribing", failureCount: 0 },
      { kind: "SubscribeFailed" },
    );
    expect(next.kind).toBe("error");
    expect(next.failureCount).toBe(1);
  });

  it("registering → error on RegisterFailed + failureCount += 1 (mutation throws)", () => {
    const next = decideWebPushBranch(
      { kind: "registering", failureCount: 0 },
      { kind: "RegisterFailed" },
    );
    expect(next.kind).toBe("error");
    expect(next.failureCount).toBe(1);
  });

  it("preserves existing failureCount when incrementing (e.g. denied after 1 previous failure → count = 2)", () => {
    const next = decideWebPushBranch(
      { kind: "requesting-permission", failureCount: 1 },
      { kind: "PermissionDenied" },
    );
    expect(next.failureCount).toBe(2);
  });
});

describe("decideWebPushBranch — retry from denied/error keeps the counter (Q8 — compteur ne se reset PAS au retry)", () => {
  it("denied → requesting-permission on ClickAuthorize WITHOUT resetting failureCount", () => {
    const next = decideWebPushBranch(
      { kind: "denied", failureCount: 1 },
      { kind: "ClickAuthorize" },
    );
    expect(next.kind).toBe("requesting-permission");
    expect(next.failureCount).toBe(1);
  });

  it("error → requesting-permission on ClickAuthorize WITHOUT resetting failureCount", () => {
    const next = decideWebPushBranch(
      { kind: "error", failureCount: 2 },
      { kind: "ClickAuthorize" },
    );
    expect(next.kind).toBe("requesting-permission");
    expect(next.failureCount).toBe(2);
  });
});

describe("decideWebPushBranch — robustness (every other event is a no-op)", () => {
  it("ignores PermissionGranted on idle (event arrived before ClickAuthorize)", () => {
    const next = decideWebPushBranch(INITIAL, { kind: "PermissionGranted" });
    expect(next).toEqual(INITIAL);
  });

  it("ignores double-ClickAuthorize while already requesting-permission (idempotent)", () => {
    const current: WebPushBranchState = {
      kind: "requesting-permission",
      failureCount: 0,
    };
    const next = decideWebPushBranch(current, { kind: "ClickAuthorize" });
    expect(next).toEqual(current);
  });

  it("ignores RegisterSucceeded on registered (terminal — Convex sub closes the modal)", () => {
    const current: WebPushBranchState = { kind: "registered", failureCount: 0 };
    const next = decideWebPushBranch(current, { kind: "RegisterSucceeded" });
    expect(next).toEqual(current);
  });
});

describe("decideWebPushBranch — purity", () => {
  it("never mutates the input state object", () => {
    const frozen = Object.freeze({
      ...INITIAL,
    }) as WebPushBranchState;
    expect(() =>
      decideWebPushBranch(frozen, { kind: "ClickAuthorize" }),
    ).not.toThrow();
  });

  it("returns equivalent results for the same input pair (referential transparency)", () => {
    const a = decideWebPushBranch(INITIAL, { kind: "ClickAuthorize" });
    const b = decideWebPushBranch(INITIAL, { kind: "ClickAuthorize" });
    expect(a).toEqual(b);
  });

  it("exposes discriminated unions on `kind` (callers can switch exhaustively)", () => {
    const events: ReadonlyArray<WebPushBranchEvent> = [
      { kind: "ClickAuthorize" },
      { kind: "PermissionGranted" },
      { kind: "PermissionDenied" },
      { kind: "SubscribeSucceeded" },
      { kind: "SubscribeFailed" },
      { kind: "RegisterSucceeded" },
      { kind: "RegisterFailed" },
    ];
    for (const ev of events) {
      expect(() => decideWebPushBranch(INITIAL, ev)).not.toThrow();
    }
  });
});
