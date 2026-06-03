import { useActiveTenantId } from "@/lib/tenant-switcher";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { AlertOctagon } from "lucide-react-native";
import { Text, View } from "react-native";
import {
  decideTenantStatus,
  type TenantStatusDecision,
} from "./decide-tenant-status";

/**
 * #411 — « Alertes statut tenant » critical full-screen gate (PRD 20 §13 +
 * `docs/contexts/kb-orders/CONTEXT.md` « Alerte statut critique »).
 *
 * Mounted in `(app)/_layout.tsx` ABOVE the route stack so the full-screen red
 * overlay REPLACES the tree when the tenant backend status is critical (Stripe
 * Connect KO blocking paiements, OR Uber Direct KO + livraison seule = mode
 * actif). Same art-direction as #394 / #400 / #405 — the four red screens stay
 * coherent in tone.
 *
 * Priority chain (orchestrator prompt for #411):
 *   auth (#400) > Convex sub (#405) > tenant status critical (#411 — THIS)
 *   > banner non-critical (#411 sister component, mounted next).
 * The outer gates at the root layout already replace the tree first, so by
 * the time we get here we KNOW the user is authenticated AND the Convex sub
 * is alive. The remaining decision (critical vs warning vs none) is delegated
 * to the pure `decideTenantStatus` function — same convention as the other
 * gates in this app.
 *
 * Non-resolution paths (returns children as-is, no overlay):
 *  - `useActiveTenantId()` is `null`        — kb_admin, no attached tenant,
 *                                              or session/device still loading
 *  - `getTenantHealth` not yet resolved      — Convex sub in flight on this
 *                                              tenant. The pure decision will
 *                                              also return `none` on a null
 *                                              field, but skipping the query
 *                                              keeps the boot path quiet.
 *  - `decideTenantStatus` returns `none`    — nothing critical happening.
 *
 * Distinct from #405 (Convex sub broken) — when the WS is DOWN the
 * `ConnectionLostGate` at root already replaces the tree, so we never reach
 * here with a broken sub. Distinct from #400 (auth invalide) — `SessionRevokedGate`
 * sits above us too. This gate handles BACKEND tenant posture, NOT transport
 * health and NOT auth.
 */
export function TenantStatusCriticalGate({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenantId = useActiveTenantId();
  // Skip the query when no tenant is resolved — kb_admin / no attachment /
  // session loading. No alert can be raised against a non-existent tenant.
  const health = useQuery(
    api.lib.orders.orders.getTenantHealth,
    tenantId !== null ? { tenantId } : "skip",
  );

  // Sub still loading OR no tenant ⇒ render the tree as-is. The pure decision
  // would also return `none` on null fields, but skipping the gate entirely
  // keeps the boot quiet and matches the connection-lost convention.
  if (tenantId === null || health === undefined) {
    return <>{children}</>;
  }

  const decision = decideTenantStatus(health);

  if (decision.kind === "critical") {
    // REPLACE the tree (vs sitting on top) — same as #405 « écran rouge full
    // screen bloquant », « aucun overlay possible (modal/dialog masqué) ».
    // Replacing the children guarantees no Modal from a deeper screen can
    // punch through on top of the alert.
    return <TenantStatusCriticalScreen decision={decision} />;
  }
  // `warning` or `none` ⇒ let the children render; the `<TenantStatusBanner />`
  // sibling handles the warning visual.
  return <>{children}</>;
}

/**
 * Red blocking full-screen — couche statut tenant, PRD 20 §13. Same colour
 * palette (`#B91C1C` on white) as `ForceUpdateGate`'s `BlockingNativeUpdateScreen`
 * (#394), `SessionRevokedGate`'s `SessionRevokedOverlay` (#400) and
 * `ConnectionLostGate`'s `ConnectionLostScreen` (#405) so the « critical
 * full-screen red » art-direction stays coherent across the four blocking
 * states.
 *
 * The CTA is documentation-only (« contacte ton CSM » / « bascule en click &
 * collect ») — the resto can't fix Stripe Connect KYC or re-link Uber Direct
 * from inside KB Orders, the FIX lives in KB Admin (« règle dans KB Admin »
 * was the PRD wording). The native app surfaces the BLOCKING fact and lets
 * the human escalate.
 */
function TenantStatusCriticalScreen({
  decision,
}: {
  decision: Extract<TenantStatusDecision, { kind: "critical" }>;
}) {
  const { title, body } = criticalCopy(decision.reason);
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
      <AlertOctagon
        // Large warning icon — must register in 1s on a kitchen tablet glanced
        // from the cook station.
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
        {title}
      </Text>
      <Text
        style={{
          color: "#ffffff",
          fontSize: 16,
          textAlign: "center",
          opacity: 0.9,
        }}
      >
        {body}
      </Text>
    </View>
  );
}

/**
 * Frozen copy for the two CRITICAL reasons. Centralised here so a wording
 * change is one diff (and so the banner companion below can re-use the same
 * pattern for its three WARNING reasons).
 *
 * Wording follows the issue body verbatim :
 *  - Stripe   : « Stripe non opérationnel — contacte ton CSM »
 *  - Uber-only: « Uber Direct non opérationnel — bascule en click & collect »
 */
function criticalCopy(reason: "stripe" | "uber-direct-only"): {
  title: string;
  body: string;
} {
  if (reason === "stripe") {
    return {
      title: "Stripe non opérationnel",
      body: "Les paiements sont refusés. Contacte ton CSM KitchenBoost pour débloquer ton compte Stripe.",
    };
  }
  return {
    title: "Uber Direct non opérationnel",
    body: "La livraison est indisponible. Bascule en click & collect dans KB Admin pour continuer à prendre des commandes.",
  };
}
