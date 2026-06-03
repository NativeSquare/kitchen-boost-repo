import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { View } from "react-native";
import {
  type Comparison,
  decideQuickStats,
  formatCentsEur,
  formatSignedPercent,
} from "./decide-quick-stats";

/**
 * #410 — Home « Stats rapides V1 » bloc (PRD 20 §9).
 *
 * Thin React adapter over the pure `decideQuickStats` decision. The bloc sits
 * above the order queue on the KB Orders home, alongside the pause / closure
 * / availability / service-hours controls. PRD 20 §9 freezes the V1 surface:
 * 4 minimal cards (big numbers, no charts — graphs are KB Admin only,
 * F-STATS-DASHBOARD), real-time refresh via Convex sub (« pas de refresh
 * manuel »).
 *
 *  - resolves the active tenant via `useActiveTenantId` (#399) so the bloc is
 *    scoped to the right resto for a multi-tenant manager (Walid case);
 *  - subscribes to `quickStats({ tenantId })` so the cards live-flip whenever
 *    an order reaches `livrée` / `collectée` on this device OR another
 *    (kiosque tablette + téléphone gérant coexist V1, PRD 20 §13);
 *  - the delta % vs S-1 is derived CLIENT-side in `decideQuickStats` — a
 *    cheap pure transform we don't push down to Convex (keeps the backend
 *    contract trivial and the comparison testable without convex-test).
 *
 * Layout: 2 × 2 grid of cards. Same gap rhythm as the entry pills above
 * (`mb-4`, `gap-3`, rounded-2xl). PRD says « pas de graphes » — we render
 * Ionicons + numerals + a small badge for the comparison direction.
 *
 * `loading` (Convex sub in flight) → skeleton cards (a discreet pulse). We
 * never flash « 0 € » before the data lands — the gérant would read it as
 * « pas de cmds aujourd'hui » when in fact the query just hasn't resolved.
 */
export function QuickStats(): React.ReactElement | null {
  const tenantId = useActiveTenantId();
  const stats = useQuery(
    api.lib.stats.quickStats.quickStats,
    tenantId !== null ? { tenantId } : "skip",
  );

  // No tenant resolved yet (loading session/device OR kb_admin OR no
  // attachment). Render nothing — the home already shows its own placeholder
  // for the same condition.
  if (tenantId === null) return null;

  const decision = decideQuickStats(stats);

  return (
    <View className="mb-4 gap-3">
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground text-lg font-semibold">
          Stats rapides
        </Text>
        <Text className="text-muted-foreground text-xs">
          Mise à jour temps réel
        </Text>
      </View>

      <View className="flex-row flex-wrap gap-3">
        <StatCard
          label="CA aujourd'hui"
          value={
            decision.kind === "loading"
              ? null
              : formatCentsEur(decision.caToday)
          }
          icon="cash-outline"
          accessibilityLabel="Chiffre d'affaires aujourd'hui"
        />
        <StatCard
          label="Cmds aujourd'hui"
          value={
            decision.kind === "loading" ? null : String(decision.ordersToday)
          }
          icon="receipt-outline"
          accessibilityLabel="Nombre de commandes aujourd'hui"
        />
        <StatCard
          label="CA cette semaine"
          value={
            decision.kind === "loading" ? null : formatCentsEur(decision.caWeek)
          }
          icon="calendar-outline"
          accessibilityLabel="Chiffre d'affaires cette semaine"
        />
        <ComparisonCard
          label="vs semaine dernière"
          comparison={decision.kind === "ready" ? decision.comparison : null}
        />
      </View>
    </View>
  );
}

/**
 * One KPI card — number, label and icon. Width set so two cards fit per row
 * with the parent's `gap-3` (`flex-1 min-w-[45%]`). The skeleton flavour
 * shows a `—` instead of the value while the Convex sub is loading; we keep
 * the layout identical so the cards don't jump when data lands.
 */
function StatCard({
  label,
  value,
  icon,
  accessibilityLabel,
}: {
  label: string;
  value: string | null;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  accessibilityLabel: string;
}): React.ReactElement {
  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
      className="min-w-[45%] flex-1 gap-2 rounded-2xl border border-border bg-card p-4"
    >
      <View className="flex-row items-center gap-2">
        <View className="bg-muted h-8 w-8 items-center justify-center rounded-full">
          <Ionicons name={icon} size={16} color="#444" />
        </View>
        <Text className="text-muted-foreground text-xs">{label}</Text>
      </View>
      <Text className="text-foreground text-2xl font-semibold">
        {value ?? "—"}
      </Text>
    </View>
  );
}

/**
 * Comparison badge card. Renders an inline arrow + signed percent (« +12 % »)
 * when `comparison.kind === "comparable"`, or « Nouvelle semaine » when the
 * previous week has no realized CA baseline (`noBaseline`). The color follows
 * the direction:
 *  - `up`   → vert (positive trend)
 *  - `down` → rouge (negative trend)
 *  - `flat` → gris (no change — neutral)
 *
 * Loading skeleton mirrors `StatCard` — `—` placeholder.
 */
function ComparisonCard({
  label,
  comparison,
}: {
  label: string;
  comparison: Comparison | null;
}): React.ReactElement {
  const palette = comparisonPalette(comparison);

  return (
    <View
      accessibilityRole="summary"
      accessibilityLabel="Comparatif vs semaine dernière"
      className={`min-w-[45%] flex-1 gap-2 rounded-2xl border p-4 ${palette.container}`}
    >
      <View className="flex-row items-center gap-2">
        <View
          className={`h-8 w-8 items-center justify-center rounded-full ${palette.iconBg}`}
        >
          <Ionicons name={palette.icon} size={16} color={palette.iconColor} />
        </View>
        <Text className="text-muted-foreground text-xs">{label}</Text>
      </View>
      <Text className={`text-2xl font-semibold ${palette.text}`}>
        {renderComparisonValue(comparison)}
      </Text>
    </View>
  );
}

/** What to show as the big text of the comparison card. */
function renderComparisonValue(comparison: Comparison | null): string {
  if (comparison === null) return "—";
  if (comparison.kind === "noBaseline") return "Nouveau";
  return formatSignedPercent(comparison.percent);
}

/** Palette derived from the comparison direction (vert / rouge / gris). */
function comparisonPalette(comparison: Comparison | null): {
  container: string;
  iconBg: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  iconColor: string;
  text: string;
} {
  const direction = comparison?.direction ?? "flat";
  switch (direction) {
    case "up":
      return {
        container:
          "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950/30",
        iconBg: "bg-emerald-200/60 dark:bg-emerald-800/40",
        icon: "trending-up",
        iconColor: "#047857",
        text: "text-emerald-700 dark:text-emerald-300",
      };
    case "down":
      return {
        container:
          "border-rose-300 bg-rose-50 dark:border-rose-700 dark:bg-rose-950/30",
        iconBg: "bg-rose-200/60 dark:bg-rose-800/40",
        icon: "trending-down",
        iconColor: "#BE123C",
        text: "text-rose-700 dark:text-rose-300",
      };
    case "flat":
    default:
      return {
        container: "border-border bg-card",
        iconBg: "bg-muted",
        icon: "remove",
        iconColor: "#444",
        text: "text-foreground",
      };
  }
}
