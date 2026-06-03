import { describe, expect, it } from "vitest";
import {
  CONNECTION_LOST_THRESHOLD_MS,
  decideConnectionLost,
} from "./decide-connection-lost";

/**
 * #405 — `decideConnectionLost` pure decision (PRD 20 §13 « Mode déconnecté »
 * + `docs/contexts/kb-orders/CONTEXT.md` Mode déconnecté).
 *
 * The Convex subscription is the source of vérité for orders reception (PRD 20
 * §13, post-grilling 2026-06-03). When the WebSocket is broken (Wi-Fi down,
 * backend unreachable) for longer than a short threshold (3 s — the floor of
 * the « 3-5 s » band the issue + PRD specify), the native app must surface a
 * full-screen red blocking screen so the restaurateur understands « tu es
 * aveugle » plutôt que « c'est calme ce soir ». As soon as the WebSocket
 * reconnects, the overlay disappears instantly (no grace period: the user
 * already paid the visual cost of the down state).
 *
 * Three issue-acceptance scenarios pinned (the « 1-3 tests E2E » expressed as
 * scenario-level decisions):
 *
 *  (a) « Wi-Fi off → écran rouge < 5 s » — when WS has been down for ≥ 3 s,
 *      decide `connection-lost`. Below the threshold, stay on `allow` so a
 *      transient blip (Convex reconnect in < 1 s on a healthy network) does
 *      not flash the red screen.
 *
 *  (b) « Wi-Fi back → écran disparaît automatiquement » — as soon as the WS
 *      reports `isWebSocketConnected: true` again, the decision flips back
 *      to `allow` immediately (no debounce).
 *
 *  (c) « Cold boot, jamais connecté » — `hasEverConnected: false` means the
 *      app is still establishing its very first connection (auth handshake,
 *      slow first WS open). Surface NOTHING — the boot splash / auth flow
 *      handles that state. Showing « Connexion perdue » before the user has
 *      ever been connected would be a lie.
 *
 * Same split convention as `decideForceUpdate` (#394),
 * `decideSessionRevoked` (#400), `decideOnboardingStep` (#398): keep React,
 * `convex/react`, and Expo out of the function so the matrix is pinned by a
 * fast deterministic vitest suite (Node env, no jsdom, no native mocks). The
 * adapter (`ConnectionLostGate`) is the thin glue around `useConvexConnectionState`,
 * a `useRef` that tracks the first-disconnect timestamp, and a `setTimeout`
 * that re-renders at the threshold boundary.
 */

describe("#405 decideConnectionLost — scenario (a) « Wi-Fi off → écran rouge »", () => {
  it("WS down for >= 3 s after having connected once → connection-lost", () => {
    expect(
      decideConnectionLost({
        isWebSocketConnected: false,
        hasEverConnected: true,
        disconnectedSinceMs: 1_000_000,
        nowMs: 1_000_000 + CONNECTION_LOST_THRESHOLD_MS,
      }),
    ).toEqual({ kind: "connection-lost" });
  });

  it("WS down for STRICTLY more than 3 s → connection-lost", () => {
    expect(
      decideConnectionLost({
        isWebSocketConnected: false,
        hasEverConnected: true,
        disconnectedSinceMs: 1_000_000,
        nowMs: 1_000_000 + CONNECTION_LOST_THRESHOLD_MS + 5_000,
      }),
    ).toEqual({ kind: "connection-lost" });
  });

  it("WS down for STRICTLY less than 3 s → allow (transient blip, do not flash the red screen)", () => {
    // Convex auto-retries on a healthy network in < 1 s; only sustained
    // disconnects (the « tu es aveugle » case the restaurateur cares about)
    // should surface the overlay.
    expect(
      decideConnectionLost({
        isWebSocketConnected: false,
        hasEverConnected: true,
        disconnectedSinceMs: 1_000_000,
        nowMs: 1_000_000 + 2_999,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("WS down for exactly 0 ms (just disconnected this frame) → allow", () => {
    expect(
      decideConnectionLost({
        isWebSocketConnected: false,
        hasEverConnected: true,
        disconnectedSinceMs: 1_000_000,
        nowMs: 1_000_000,
      }),
    ).toEqual({ kind: "allow" });
  });
});

describe("#405 decideConnectionLost — scenario (b) « Wi-Fi back → écran disparaît »", () => {
  it("WS reconnected (isWebSocketConnected: true) → allow instantly, regardless of how long down was", () => {
    // Reconnect is the SoT: the moment Convex reports the WS up, the
    // restaurateur is no longer blind. No grace period — the overlay has
    // already served its purpose (« réseau down, attends »), keeping it
    // around would block legitimate work.
    expect(
      decideConnectionLost({
        isWebSocketConnected: true,
        hasEverConnected: true,
        disconnectedSinceMs: null,
        nowMs: 2_000_000,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("WS just reconnected with disconnectedSinceMs not yet cleared by adapter → still allow", () => {
    // Defensive: the adapter clears `disconnectedSinceMs` on the same render
    // it sees `isWebSocketConnected: true`, but if there's any ordering race,
    // the connected flag wins. Pure function reflects that priority.
    expect(
      decideConnectionLost({
        isWebSocketConnected: true,
        hasEverConnected: true,
        disconnectedSinceMs: 1_000_000,
        nowMs: 1_000_000 + 10_000,
      }),
    ).toEqual({ kind: "allow" });
  });
});

describe("#405 decideConnectionLost — scenario (c) « cold boot, jamais connecté »", () => {
  it("hasEverConnected: false → allow (boot / auth handshake still in flight, splash handles it)", () => {
    // Showing « Connexion perdue » before the user has ever been connected
    // would be a lie. The boot splash + `useConvexAuth` loading already
    // handle this window; this gate is for steady-state losses only.
    expect(
      decideConnectionLost({
        isWebSocketConnected: false,
        hasEverConnected: false,
        disconnectedSinceMs: 1_000_000,
        nowMs: 1_000_000 + 60_000,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("hasEverConnected: false but WS connected (first successful boot) → allow", () => {
    expect(
      decideConnectionLost({
        isWebSocketConnected: true,
        hasEverConnected: false,
        disconnectedSinceMs: null,
        nowMs: 1_000_000,
      }),
    ).toEqual({ kind: "allow" });
  });
});

describe("#405 decideConnectionLost — edge cases", () => {
  it("WS down but disconnectedSinceMs is null (adapter hasn't recorded a timestamp yet) → allow", () => {
    // The adapter sets `disconnectedSinceMs` on the FIRST render where WS
    // goes from connected → disconnected. Until then, we cannot know how
    // long we have been down, so be conservative and don't surface the
    // overlay.
    expect(
      decideConnectionLost({
        isWebSocketConnected: false,
        hasEverConnected: true,
        disconnectedSinceMs: null,
        nowMs: 1_000_000,
      }),
    ).toEqual({ kind: "allow" });
  });

  it("CONNECTION_LOST_THRESHOLD_MS is exposed as 3 s (the floor of PRD 20 §13's « 3-5 s » band)", () => {
    // Pinning the constant in the test so a sneaky bump (which would change
    // the UX SLA the restaurateur signed up for) is caught immediately.
    expect(CONNECTION_LOST_THRESHOLD_MS).toBe(3000);
  });
});
