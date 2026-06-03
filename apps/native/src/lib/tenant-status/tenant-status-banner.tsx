import { useActiveTenantId } from "@/lib/tenant-switcher";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { decideTenantStatus } from "./decide-tenant-status";

/**
 * #411 — « Alertes statut tenant » NON-CRITICAL banner (PRD 20 §13 +
 * `docs/contexts/kb-orders/CONTEXT.md` « Alerte statut critique » section
 * "Non-critiques").
 *
 * Sibling of `TenantStatusCriticalGate` — same Convex sub on
 * `getTenantHealth`, same pure decision function, but renders ONLY when the
 * verdict is `{ kind: "warning", ... }`. Mounted in `(app)/_layout.tsx` above
 * the route stack like the push-permission banner so it overlays every
 * authenticated route.
 *
 * Three warning reasons mapped to three tones :
 *
 *  - `stripe-kyc-pending`     — orange. KYC en attente mais paiements OK pour
 *                               l'instant. CTA « Compléter dans KB Admin »
 *                               (issue body verbatim).
 *  - `uber-direct-degraded`   — red banner (mais NON full-screen). Uber Direct
 *                               disconnected mais click & collect aussi actif
 *                               → mode dégradé livraison, l'app reste utilisable
 *                               pour les commandes à emporter.
 *  - `tenant-incomplete`      — gray. Statut tenant lifecycle pas encore
 *                               `active`. Signal opérationnel KB Ops.
 *
 * Dismissible le temps de la session (memoryStorage useState — pas de
 * persistance device-side). À chaque cold launch / fresh foreground the
 * banner re-apparaît s'il n'a pas été résolu côté backend — c'est voulu :
 * le restaurateur doit re-voir l'alerte tant que la cause n'est pas réglée.
 *
 * No CTA wiring for "Ouvrir KB Admin" — KB Admin est un produit web séparé,
 * le restaurateur change de device pour le régler. La banner sert à alerter,
 * pas à corriger.
 */

type BannerTone = {
  bg: string;
  fg: string;
};

const TONES: Record<
  "stripe-kyc-pending" | "uber-direct-degraded" | "tenant-incomplete",
  BannerTone
> = {
  // Orange — KYC pending, paiements OK pour l'instant mais à régler.
  "stripe-kyc-pending": { bg: "#D97706", fg: "#ffffff" },
  // Red — Uber down, mode dégradé. Pas full-screen mais visuellement saillant.
  "uber-direct-degraded": { bg: "#B91C1C", fg: "#ffffff" },
  // Gray — signal opérationnel sourd (tenant pas encore active).
  "tenant-incomplete": { bg: "#374151", fg: "#ffffff" },
};

function copy(
  reason: "stripe-kyc-pending" | "uber-direct-degraded" | "tenant-incomplete",
): string {
  switch (reason) {
    case "stripe-kyc-pending":
      return "Vérification KYC Stripe en attente — complète dans KB Admin.";
    case "uber-direct-degraded":
      return "Uber Direct déconnecté — seul le click & collect est disponible.";
    case "tenant-incomplete":
      return "Statut du restaurant incomplet — règle dans KB Admin.";
  }
}

export function TenantStatusBanner() {
  const tenantId = useActiveTenantId();
  const health = useQuery(
    api.lib.orders.orders.getTenantHealth,
    tenantId !== null ? { tenantId } : "skip",
  );
  // Session-scoped dismissal. Re-mount (cold launch) re-shows the banner —
  // intentional: the alert must re-surface until the backend status is fixed.
  const [dismissed, setDismissed] = useState<string | null>(null);

  if (tenantId === null || health === undefined) return null;

  const decision = decideTenantStatus(health);
  if (decision.kind !== "warning") return null;

  // Dismissal is per-reason: if Stripe KYC was dismissed and Uber suddenly
  // degrades, the new (more severe) banner must surface — comparing the
  // current reason against the dismissed one guarantees that.
  if (dismissed === decision.reason) return null;

  const tone = TONES[decision.reason];
  const message = copy(decision.reason);

  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: tone.bg,
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <Text
        style={{
          color: tone.fg,
          fontSize: 14,
          fontWeight: "600",
          flex: 1,
        }}
      >
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Masquer cette alerte pour la session"
        onPress={() => setDismissed(decision.reason)}
        style={{
          backgroundColor: tone.fg,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 6,
        }}
      >
        <Text style={{ color: tone.bg, fontWeight: "700", fontSize: 13 }}>
          Masquer
        </Text>
      </Pressable>
    </View>
  );
}
