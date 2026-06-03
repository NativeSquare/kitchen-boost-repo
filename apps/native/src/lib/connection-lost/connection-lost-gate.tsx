import { useConvexConnectionState } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import {
  CONNECTION_LOST_THRESHOLD_MS,
  decideConnectionLost,
} from "./decide-connection-lost";

/**
 * #405 — « Mode déconnecté » full-screen overlay gate (PRD 20 §13 +
 * `docs/contexts/kb-orders/CONTEXT.md` Mode déconnecté).
 *
 * Mounted at the root of the native app, INSIDE the `ConvexAuthProvider`
 * (it needs `useConvexConnectionState` from `convex/react`, which requires
 * a `ConvexProvider` ancestor) and OUTSIDE every auth-dependent screen so
 * the overlay surfaces ABOVE the whole tree the moment the WebSocket goes
 * down for ≥ 3 s.
 *
 * The gate itself is a thin adapter — every branching decision lives in the
 * pure `decideConnectionLost` function next door (pinned by the vitest
 * suite, see `decide-connection-lost.test.ts`). Same convention as #394
 * (ForceUpdateGate), #400 (SessionRevokedGate).
 *
 * Responsibilities:
 *
 *  1. Read `useConvexConnectionState()` — Convex's React hook that re-renders
 *     whenever any part of the connection state changes (WS up/down,
 *     reconnect retries, etc.).
 *
 *  2. Track the « when did we first go down? » timestamp in a `useRef` so a
 *     re-render does not lose it. Set on the first frame where
 *     `isWebSocketConnected` is `false` after `hasEverConnected` is `true`;
 *     cleared the moment it sees `true` again.
 *
 *  3. Once disconnected, schedule a `setTimeout` for the threshold so we
 *     force a re-render at the boundary (the Convex hook itself only fires
 *     on state changes, not on time elapsing). Cleared on reconnect / unmount.
 *
 *  4. Delegate to `decideConnectionLost(...)`, then render:
 *       - `allow` → `{children}`
 *       - `connection-lost` → the full-screen `<ConnectionLostScreen />`
 *
 * Distinct from #400 « Session révoquée » (auth invalide → redirect login)
 * and from #394 « Mise à jour requise » (binaire trop vieux → store) — this
 * is purely transient (réseau down, attendre), no CTA, no logout, no
 * navigation. The overlay disappears the moment the WS reconnects.
 */
export function ConnectionLostGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const connectionState = useConvexConnectionState();
  const { isWebSocketConnected, hasEverConnected } = connectionState;

  // Sticky « when did we first go down? ». A `useRef` so a transient re-render
  // (any Convex state change re-fires `useConvexConnectionState`, not just
  // up/down) does not reset the down-edge.
  const disconnectedSinceRef = useRef<number | null>(null);

  // Force a re-render at the threshold boundary. The Convex hook only fires
  // on state changes; without this, we would never re-evaluate the decision
  // « 3 s have elapsed since we went down » until the next WS event.
  const [, setTick] = useState(0);

  useEffect(() => {
    if (isWebSocketConnected || !hasEverConnected) {
      // Up or never-yet-up → clear the down-edge timestamp.
      if (disconnectedSinceRef.current !== null) {
        disconnectedSinceRef.current = null;
        // Force a re-render so `decideConnectionLost` sees the cleared ref.
        setTick((t) => t + 1);
      }
      return undefined;
    }
    // Down + we have connected at least once. Record the timestamp on the
    // first frame the WS goes down, then schedule a re-render at the
    // threshold boundary (so the gate can flip from `allow` to
    // `connection-lost` without waiting for the next WS event).
    if (disconnectedSinceRef.current === null) {
      disconnectedSinceRef.current = Date.now();
    }
    const elapsed = Date.now() - disconnectedSinceRef.current;
    const remaining = CONNECTION_LOST_THRESHOLD_MS - elapsed;
    if (remaining <= 0) {
      // Already past the threshold (e.g. app was backgrounded during the
      // down window). Re-render immediately so the verdict flips.
      setTick((t) => t + 1);
      return undefined;
    }
    const timer = setTimeout(() => setTick((t) => t + 1), remaining);
    return () => clearTimeout(timer);
  }, [isWebSocketConnected, hasEverConnected]);

  const decision = decideConnectionLost({
    isWebSocketConnected,
    hasEverConnected,
    disconnectedSinceMs: disconnectedSinceRef.current,
    nowMs: Date.now(),
  });

  if (decision.kind === "connection-lost") {
    // The overlay REPLACES the tree (vs sitting on top). PRD 20 §13 :
    // « écran rouge full screen bloquant », « aucun overlay possible
    // (modal/dialog masqué) — c'est full screen prioritaire ». Replacing
    // the children guarantees no `<Modal />` from a deeper screen can punch
    // through on top.
    return <ConnectionLostScreen />;
  }
  return <>{children}</>;
}

/**
 * Red blocking full-screen — couche transport, PRD 20 §13. Same colour
 * palette (`#B91C1C` on white) as `ForceUpdateGate`'s
 * `BlockingNativeUpdateScreen` (#394) and `SessionRevokedGate`'s
 * `SessionRevokedOverlay` (#400) so the « critical full-screen red »
 * art-direction stays coherent across the three blocking states.
 *
 * No CTA — the issue is explicit : « pas de bouton "retry" — la Convex sub
 * se reconnecte d'elle-même quand le réseau revient ». The user just needs
 * to read « vérifie le Wi-Fi / 4G » and act on the device's connectivity.
 */
function ConnectionLostScreen() {
  return (
    <View
      accessibilityRole="alert"
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#B91C1C",
        padding: 24,
      }}
    >
      <AlertTriangle
        // Large warning icon — must register in 1 s on a kitchen tablet
        // glanced from the cook station.
        size={96}
        color="#ffffff"
        strokeWidth={2.5}
        style={{ marginBottom: 24 }}
      />
      <Text
        style={{
          color: "#ffffff",
          fontSize: 28,
          fontWeight: "700",
          textAlign: "center",
          marginBottom: 16,
        }}
      >
        Connexion perdue
      </Text>
      <Text
        style={{
          color: "#ffffff",
          fontSize: 16,
          textAlign: "center",
          opacity: 0.9,
        }}
      >
        Les commandes ne sont plus reçues. Vérifie le Wi-Fi / 4G.
      </Text>
    </View>
  );
}
