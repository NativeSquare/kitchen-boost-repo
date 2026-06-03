/**
 * #405 — pure decision function for the « Mode déconnecté » full-screen
 * overlay (PRD 20 §13 + `docs/contexts/kb-orders/CONTEXT.md` Mode déconnecté).
 *
 * The Convex subscription is the source of vérité for orders reception (PRD
 * 20 §13, post-grilling 2026-06-03). When the WebSocket is broken (Wi-Fi
 * down, backend unreachable) for longer than a short threshold (3 s — the
 * floor of the « 3-5 s » band the PRD specifies), the native app must
 * surface a full-screen red blocking screen so the restaurateur understands
 * « tu es aveugle » plutôt que « c'est calme ce soir ». As soon as the
 * WebSocket reconnects, the overlay disappears instantly.
 *
 * Same split convention as `decideForceUpdate` (#394),
 * `decideSessionRevoked` (#400), `decideOnboardingStep` (#398),
 * `decideTenantSwitcher` (#399) — keep React, `convex/react`, and Expo out
 * of the function so the matrix is pinned by a fast deterministic vitest
 * suite (Node env, no jsdom, no native mocks).
 *
 * Truth table:
 *
 *  | hasEverConnected | isWSConnected | disconnectedSince | now - since | verdict           |
 *  | ---------------- | ------------- | ----------------- | ----------- | ----------------- |
 *  | false            | *             | *                 | *           | allow (boot)      |
 *  | true             | true          | *                 | *           | allow (healthy)   |
 *  | true             | false         | null              | *           | allow (no ts yet) |
 *  | true             | false         | <number>          | < threshold | allow (blip)      |
 *  | true             | false         | <number>          | >= threshold| connection-lost   |
 */

/**
 * Threshold (ms) before surfacing the « Mode déconnecté » overlay. Pinned at
 * 3 s — the floor of PRD 20 §13's « 3-5 s » band. Convex auto-retries on a
 * healthy network in < 1 s, so anything under this is a blip we don't want
 * to flash a red screen on. Above this, the restaurateur is functionally
 * blind to incoming orders and must know.
 */
export const CONNECTION_LOST_THRESHOLD_MS = 3000;

/** Inputs the decision needs to reach a verdict. */
export type ConnectionLostInputs = {
  /** `ConvexReactClient.connectionState().isWebSocketConnected`. */
  isWebSocketConnected: boolean;
  /** `ConvexReactClient.connectionState().hasEverConnected`. False during
   *  the very first boot / auth handshake — we MUST NOT surface the overlay
   *  in that window (the boot splash + `useConvexAuth` loading already
   *  handle it). */
  hasEverConnected: boolean;
  /** Timestamp (ms since epoch) at which the adapter first observed the WS
   *  go down (or `null` while connected / not yet recorded). The adapter
   *  sets this in a `useRef` on the first render where `isWebSocketConnected`
   *  flips to `false`, and clears it the moment it sees `true` again. */
  disconnectedSinceMs: number | null;
  /** `Date.now()` at the time of this render. Injected so the function stays
   *  pure / deterministic for the vitest suite. */
  nowMs: number;
};

/** The two mutually-exclusive verdicts the gate acts on. */
export type ConnectionLostDecision =
  /** No overlay — render the rest of the tree (auth / app / etc.). */
  | { kind: "allow" }
  /** Full-screen red « Connexion perdue » overlay. The adapter renders the
   *  blocking screen ABOVE everything else; it disappears the moment the WS
   *  reconnects (no debounce — the user already paid the visual cost). */
  | { kind: "connection-lost" };

/**
 * Decide whether the « Mode déconnecté » overlay should be shown this frame.
 * Pure: same inputs ⇒ same output, no `Date.now()`, no side effects.
 */
export function decideConnectionLost(
  inputs: ConnectionLostInputs,
): ConnectionLostDecision {
  // 1. Never seen a connection yet — the boot splash / auth handshake is
  //    still in flight. The overlay would lie to the user.
  if (!inputs.hasEverConnected) {
    return { kind: "allow" };
  }

  // 2. Currently connected — healthy state, render children.
  if (inputs.isWebSocketConnected) {
    return { kind: "allow" };
  }

  // 3. Disconnected but no timestamp recorded yet (the adapter has not had
  //    a frame to record the down-edge). Be conservative — wait for the
  //    next render.
  if (inputs.disconnectedSinceMs === null) {
    return { kind: "allow" };
  }

  // 4. Disconnected long enough? Threshold check on the elapsed window.
  const elapsed = inputs.nowMs - inputs.disconnectedSinceMs;
  if (elapsed >= CONNECTION_LOST_THRESHOLD_MS) {
    return { kind: "connection-lost" };
  }

  // 5. Disconnected but under the threshold — Convex is likely auto-
  //    retrying. Don't flash the overlay on a blip.
  return { kind: "allow" };
}
