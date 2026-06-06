import { AvailabilityBanner } from "@/lib/availability";
import { PushPermissionBanner } from "@/lib/push-permission";
import { TenantSwitcher } from "@/lib/tenant-switcher";
import {
  TenantStatusBanner,
  TenantStatusCriticalGate,
} from "@/lib/tenant-status";
import { Stack } from "expo-router";
import { View } from "react-native";

export default function AppLayout() {
  return (
    /*
     * #411 — « Alertes statut tenant » critical gate (PRD 20 §13).
     * Mounted at the TOP of the `(app)` layout so a critical tenant backend
     * status (Stripe disabled, OR Uber Direct KO + livraison seule = mode
     * actif) REPLACES the whole authenticated tree with a full-screen red
     * overlay (same art-direction as #394/#400/#405). The outer chain
     * already handles transport / auth :
     *   #400 auth invalide > #405 Convex sub down > #411 critical (HERE)
     *   > #411 warning banner (below).
     * If the tenant is healthy or the user has no resolved tenant
     * (kb_admin / no attachment / loading), the gate returns children
     * untouched and the rest of `(app)` renders normally.
     */
    <TenantStatusCriticalGate>
      <View className="flex-1 bg-background">
        {/*
         * #411 — non-critical banner (sibling of the gate above). Surfaces
         * when the verdict is `warning` (Stripe KYC pending, Uber Direct
         * dégradé avec C&C en fallback, statut tenant pas encore `active`).
         * Mounted FIRST among the in-layout banners so the gérant la voit
         * tout de suite en haut de page. Dismissible le temps de la session.
         */}
        <TenantStatusBanner />
        {/*
         * KB Orders — bannière de disponibilité commerciale persistante (PRD
         * 20 §7 + ADR 0018). Surfacée APRÈS `<TenantStatusBanner />` (statut
         * tenant = priorité absolue) et AVANT `<PushPermissionBanner />`
         * (push OS = signal infra, important mais moins immédiat qu'« mon
         * resto est en pause »). Rend rouge / amber / gris selon que la
         * fermeture exceptionnelle / la pause / le hors-horaires de service
         * est actif, avec un CTA « Paramètres » qui deeplink direct
         * `/settings/availability`. Rend null (kind `hidden`) quand tout va
         * bien — pas de pollution sur la home.
         */}
        <AvailabilityBanner />
        {/*
         * #395 — OS push permission banner (PRD 20 §3 + §13 + §15 edge case
         * « push refusé au niveau OS »). Mounted ABOVE the <Stack> so the red
         * sticky banner overlays every authenticated route whenever the
         * OS-level push permission is `denied`. Re-renders nothing
         * (decidePushPermissionBanner → "hidden") when the permission is
         * `granted` / `undetermined` / still loading.
         */}
        <PushPermissionBanner />
        {/*
         * #399 — Header tenant switcher (PRD 20 §1b + §12 + AC7). Mounted ABOVE
         * the <Stack> so the chip lives in a thin strip on top of every (tabs)
         * route in phone mode. Returns null and renders nothing in kiosque mode
         * (tenant pinné, switcher masqué), for kb_admin, for mono-tenant users,
         * and while inputs are still loading — defense in depth on top of the
         * root layout's splash gate.
         */}
        <TenantSwitcher />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: "transparent" },
          }}
        >
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* #401 — KB Orders detail screen pushed from the home card (PRD 20 §4
           « détail cmd »). Modal-like sheet animation keeps the home queue
           one tap away during the cuisinier's workflow. */}
          <Stack.Screen
            name="orders/[orderId]"
            options={{
              headerShown: false,
              presentation: "card",
            }}
          />
          {/* #417 — KB Orders Historique des commandes (PRD 20 §8). Pushed
           depuis la home `<OrderHistoryEntry />` pill. Affiche les cmds
           terminales (livrée / collectée / refusée / auto_expired) du
           tenant courant avec 4 onglets + filtre période + recherche ID.
           Card presentation = même back-nav UX que les autres routes
           dédiées. */}
          <Stack.Screen
            name="orders/history"
            options={{
              headerShown: true,
              headerTitle: "Historique des commandes",
              presentation: "card",
            }}
          />
          {/* #408 — KB Orders « Disponibilité des items » screen (PRD 20 §7c +
           ADR 0018). Pushed from the home `<ItemAvailabilityEntry />` pill.
           Card presentation = same back-nav UX as the order detail screen. */}
          <Stack.Screen
            name="disponibilite-items"
            options={{
              headerShown: true,
              headerTitle: "Disponibilité des items",
              presentation: "card",
            }}
          />
          {/* #409 — KB Orders « Modif horaires d'ouverture » screen (PRD 20
           §7d + ADR 0018). Pushed from the home `<ServiceHoursEntry />`
           pill. Toggle Aujourd'hui / Cette semaine + per-day slot editor
           wired to the SAME backend mutation `api.lib.menu.serviceHours.set`
           the KB Admin mirror uses. Card presentation = same back-nav UX
           as the other dedicated screens. */}
          <Stack.Screen
            name="service-hours"
            options={{
              headerShown: true,
              headerTitle: "Horaires d'ouverture",
              presentation: "card",
            }}
          />
          {/* #412 — KB Orders « Imprimante cuisine » screen (PRD 20 §14 +
           §10). Pushed from the home `<PrinterEntry />` pill. Champ
           « Adresse imprimante » + boutons « Enregistrer » / « Tester
           l'impression » / « Retirer l'imprimante » wirés à
           `api.lib.printing.printing.*`. Le full Settings (#418) montera
           le même composant depuis sa propre route plus tard. */}
          <Stack.Screen
            name="printer"
            options={{
              headerShown: true,
              headerTitle: "Imprimante cuisine",
              presentation: "card",
            }}
          />
          {/* Drawer / bottom-tabs refonte — sous-écran « Ouverture &
           horaires » du Paramètres (PRD 20 §7 + §10). Regroupe les 4
           widgets de disponibilité commerciale (pause, fermeture, dispo
           items, horaires) précédemment empilés sur le home. Pushed
           depuis la section Settings « Ouverture & horaires ». */}
          <Stack.Screen
            name="settings/availability"
            options={{
              headerShown: true,
              headerTitle: "Ouverture & horaires",
              presentation: "card",
            }}
          />
        </Stack>
      </View>
    </TenantStatusCriticalGate>
  );
}
