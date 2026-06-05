import { ClosureControl } from "@/lib/closure";
import { ItemAvailabilityEntry } from "@/lib/item-availability";
import { PauseControl } from "@/lib/pause";
import { ServiceHoursEntry } from "@/lib/service-hours";
import { ScrollView, View } from "react-native";

/**
 * KB Orders « Paramètres › Ouverture & horaires » sub-route (PRD 20 §7a-d
 * + ADR 0018 frontière disponibilité commerciale / édition catalogue).
 *
 * Regroupe les 4 widgets qui pilotent la disponibilité COMMERCIALE du
 * restaurant — précédemment éparpillés sur le home, ils vivent maintenant
 * dans une section dédiée du Paramètres (drawer entry « Paramètres » →
 * « Ouverture & horaires »).
 *
 *  - `<PauseControl />` (#406) — pause exceptionnelle 30 min - 4h
 *    (rush surprise, panne). Idle = entry pill ; active = badge « En
 *    pause jusqu'à HH:MM » + « Reprendre ».
 *
 *  - `<ClosureControl />` (#407) — fermeture exceptionnelle 1+ jour
 *    (vacances, panne frigo, intempéries). Même style entry pill +
 *    badge « Fermé jusqu'au JJ/MM » + « Rouvrir ».
 *
 *  - `<ItemAvailabilityEntry />` (#408) — entry pill qui navigue vers
 *    `/disponibilite-items` (toggle dispo par item, ADR 0018 lecture
 *    + toggle uniquement, JAMAIS édition catalogue).
 *
 *  - `<ServiceHoursEntry />` (#409) — entry pill qui navigue vers
 *    `/service-hours` (modif Aujourd'hui / Cette semaine).
 *
 * Les 4 widgets gates côté backend NEW checkouts uniquement via
 * `acceptsOrderNow` / `isOpenNow` (ADR 0018 + chantier 2.2-E) — les cmds
 * EN COURS sur la home ne sont jamais impactées.
 */
export default function AvailabilitySettingsScreen() {
  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="p-4 sm:p-6"
    >
      <View>
        <PauseControl />
        <ClosureControl />
        <ItemAvailabilityEntry />
        <ServiceHoursEntry />
      </View>
    </ScrollView>
  );
}
