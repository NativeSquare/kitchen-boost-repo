import { useActiveTenantId } from "@/lib/tenant-switcher";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  type AvailabilityBannerDecision,
  decideAvailabilityBanner,
  formatAvailabilityClosureUntilDate,
  formatAvailabilityPauseEta,
} from "./decide-availability-banner";

/**
 * KB Orders — bannière persistante de disponibilité commerciale, montée au
 * TOP du layout `(app)` à côté de `<TenantStatusBanner />` et de
 * `<PushPermissionBanner />`. PRD 20 §7 + ADR 0018.
 *
 * Pourquoi cette bannière existe :
 *
 * Aujourd'hui, `<PauseControl />` (#406) et `<ClosureControl />` (#407)
 * surfacent l'état pause / fermeture UNIQUEMENT sur l'écran
 * `/settings/availability`. Si le cuisinier est sur la home / l'historique /
 * les stats, il n'a aucun rappel visuel que le resto est en pause / fermé /
 * hors horaires de service. Cette bannière comble le trou : visible partout,
 * tap → deeplink direct vers l'écran de gestion.
 *
 * Quatre états « visibles » + un état hidden :
 *
 *  - `closure`          — rouge destructive, fermeture exceptionnelle ACTIVE
 *                         1+ jour.
 *  - `pause`            — amber, pause exceptionnelle 15-60 min.
 *  - `closureScheduled` — gris muted/info, fermeture exceptionnelle
 *                         PROGRAMMÉE (`from > now`). Preview persistante des
 *                         bornes saisies — feedback immédiat après la
 *                         soumission du bottom sheet (bug 2026-06-07 Alex).
 *  - `outsideHours`     — gris/muted, tenant hors plage de service.
 *  - `hidden`           — tout va bien (ou queries Convex en flight).
 *
 * Priorité — closure > pause > closureScheduled > outsideHours > hidden (cf.
 * `decideAvailabilityBanner`). Si deux états sont actifs en même temps, le
 * plus durable / impactant gagne l'attention du gérant.
 *
 * Tick local 30s : mirror de `<ClosureControl />` — la bannière flippe à
 * `hidden` à l'instant exact où la pause / fermeture expire, sans attendre
 * un re-render Convex. Cohérent avec le gate backend `acceptsOrderNow` qui
 * lit `Date.now()` à chaque appel.
 *
 * Pas de masquage sur `/settings/availability` : le contexte reste pertinent
 * même quand le gérant est sur l'écran de gestion (« je suis sur l'écran
 * pause donc je sais que c'est en pause »… non, en pratique il peut
 * tap-naviguer rapidement et garder la bannière comme rappel actif).
 */
export function AvailabilityBanner(): React.ReactElement | null {
  const router = useRouter();
  const tenantId = useActiveTenantId();

  const pause = useQuery(
    api.lib.orders.orders.getOperationalPause,
    tenantId !== null ? { tenantId } : "skip",
  );
  const closure = useQuery(
    api.lib.orders.orders.getExceptionalClosure,
    tenantId !== null ? { tenantId } : "skip",
  );
  const isOpenNow = useQuery(
    api.lib.menu.serviceHours.isOpenNow,
    tenantId !== null ? { tenantId } : "skip",
  );

  // Tick local 30s — mirror de ClosureControl (#407). Suffisant pour les
  // boundaries pause (minutes) et fermeture (jours). Le BACKEND gate reste la
  // source de vérité (acceptsOrderNow), c'est juste un mirror UX.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, 30 * 1000);
    return () => clearInterval(id);
  }, []);

  // Pas de tenant résolu (kb_admin / no attachment / loading session) →
  // render rien, même contrat que les autres composants tenant-scoped.
  if (tenantId === null) return null;

  const decision = decideAvailabilityBanner({
    pause,
    closure,
    isOpenNow,
    nowMs,
  });

  if (decision.kind === "hidden") return null;

  const tone = TONES[decision.kind];
  const message = describeMessage(decision);

  return (
    <View
      accessibilityRole="alert"
      accessibilityLabel={message}
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
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          flex: 1,
        }}
      >
        <Ionicons name={tone.icon} size={20} color={tone.fg} />
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
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ouvrir les paramètres de disponibilité"
        onPress={() => router.push("/settings/availability")}
        style={{
          backgroundColor: tone.fg,
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 6,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
        }}
      >
        <Text style={{ color: tone.bg, fontWeight: "700", fontSize: 13 }}>
          Paramètres
        </Text>
        <Ionicons name="arrow-forward-outline" size={14} color={tone.bg} />
      </Pressable>
    </View>
  );
}

type BannerTone = {
  bg: string;
  fg: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
};

const TONES: Record<
  Exclude<AvailabilityBannerDecision["kind"], "hidden">,
  BannerTone
> = {
  // Rouge destructive — fermeture exceptionnelle (vacances, panne frigo).
  // Même palette que `<ClosureControl />` live badge + `<PushPermissionBanner />`.
  closure: { bg: "#B91C1C", fg: "#ffffff", icon: "lock-closed-outline" },
  // Amber — pause exceptionnelle. Aligné sur `<PauseControl />` live badge
  // (`bg-amber-50`/`border-amber-300`) mais en version bannière dense
  // (#D97706 = amber-600, lisible sur fg blanc).
  pause: { bg: "#D97706", fg: "#ffffff", icon: "pause-circle" },
  // Gris muted info — fermeture programmée pas encore live. Plus discret
  // que le rouge ACTIVE pour ne pas crier au loup (la fermeture n'a pas
  // encore commencé). Icône calendar-outline = planifié, miroir de
  // l'entry-point pill du `<ClosureControl />` idle.
  closureScheduled: {
    bg: "#4B5563",
    fg: "#ffffff",
    icon: "calendar-outline",
  },
  // Gris — hors horaires, signal informatif non bloquant. Plus discret que
  // les deux précédents pour ne pas crier au loup à chaque fin de service.
  outsideHours: { bg: "#374151", fg: "#ffffff", icon: "time-outline" },
};

function describeMessage(
  decision: Exclude<AvailabilityBannerDecision, { kind: "hidden" }>,
): string {
  switch (decision.kind) {
    case "closure":
      return `Resto fermé jusqu'au ${formatAvailabilityClosureUntilDate(decision.until)}`;
    case "pause":
      return `Resto en pause jusqu'à ${formatAvailabilityPauseEta(decision.until)}`;
    case "closureScheduled":
      return `Fermeture programmée du ${formatAvailabilityClosureUntilDate(decision.from)} au ${formatAvailabilityClosureUntilDate(decision.until)}`;
    case "outsideHours":
      return "Resto hors des horaires d'ouverture";
  }
}
