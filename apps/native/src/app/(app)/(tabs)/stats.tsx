import { Text } from "@/components/ui/text";
import { QuickStats } from "@/lib/quick-stats";
import { ScrollView, View } from "react-native";

/**
 * KB Orders « Stats » section (PRD 20 §9 « Stats rapides V1 »).
 *
 * Section dédiée du shell (drawer tablette OU bottom tab téléphone) qui
 * monte uniquement le composant `<QuickStats />` (#410) — les 4 KPIs
 * minimaux (CA jour, nb cmds jour, CA semaine, comparatif S-1). Pas de
 * graphes V1 ; les graphes Recharts vivent côté KB Admin
 * (F-STATS-DASHBOARD #252/#253/#257). Section dédiée pour donner de
 * l'espace visuel et que les cards puissent respirer (au lieu d'être
 * coincées entre 5 autres widgets comme avant la refonte).
 */
export default function StatsScreen() {
  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="p-4 sm:p-6 gap-4"
    >
      <Text className="text-foreground text-xl font-semibold">
        Stats rapides
      </Text>
      <View>
        <QuickStats />
      </View>
    </ScrollView>
  );
}
