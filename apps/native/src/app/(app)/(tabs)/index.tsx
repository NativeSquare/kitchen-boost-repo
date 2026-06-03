import { Text } from "@/components/ui/text";
import { ClosureControl } from "@/lib/closure";
import { ItemAvailabilityEntry } from "@/lib/item-availability";
import { OrderCard } from "@/lib/orders";
import { PauseControl } from "@/lib/pause";
import { PrinterEntry } from "@/lib/printing";
import { QuickStats } from "@/lib/quick-stats";
import { ServiceHoursEntry } from "@/lib/service-hours";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { api } from "@packages/backend/convex/_generated/api";
import { useQuery } from "convex/react";
import { useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";

/**
 * #401 — KB Orders home (PRD 20 §2 « Écran d'accueil cmds en cours »).
 *
 * Live queue of the active tenant's in-flight orders, newest first. The
 * backend `tenantOrders` query (chantier 2.3-D) excludes `en attente de
 * paiement` (invisible until paid) and every terminal state (those live in
 * the history) — the home only shows orders the kitchen is actively working.
 *
 * Transport (PRD 20 §13) — the Convex subscription IS the source of truth.
 * The push APNs/FCM wakeup (not implemented here, lives in the notifications
 * chantier) only reactivates the app; the cmd itself arrives via this
 * `useQuery` sub in < 5s p95 (PRD 20 AC9 transverse).
 *
 * Pull-to-refresh (PRD 20 §2) — kept as a « geste rassurant même si Convex
 * sub temps réel ». The Convex client doesn't expose a manual `refetch` for
 * a subscribed query (it always serves the latest server state), so the
 * pull-to-refresh is mostly a UX affordance; we toggle a short spinner to
 * acknowledge the gesture.
 *
 * Tenant scoping (#399 + ADR 0010) — `useActiveTenantId` resolves the active
 * tenant from the device row + the session attachment list (kiosque pin
 * wins, else lastSelected, else first attached). `null` while loading or
 * when no tenant is resolvable; in that case we show a discreet empty
 * state instead of running the query.
 *
 * The `useQuery` itself is auto-scoped backend-side: `tenantQuery` keys on
 * `ctx.tenantId` resolved from the args, so a foreign tenantId would throw
 * Forbidden — but the Convex client wouldn't crash; we keep the input gated
 * on `useActiveTenantId !== null` for the cleaner "no tenant attached"
 * empty state.
 */
export default function Home() {
  const activeTenantId = useActiveTenantId();
  const orders = useQuery(
    api.lib.orders.workflow.tenantOrders,
    activeTenantId !== null ? { tenantId: activeTenantId } : "skip",
  );

  // Pull-to-refresh — purely cosmetic since the Convex sub already serves
  // live state; we flip a short window so the spinner appears responsive.
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 400);
  };

  // No tenant resolved yet (loading session/device OR kb_admin OR no
  // attachment) — show a discreet placeholder rather than a stale "0 cmds".
  if (activeTenantId === null) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <ActivityIndicator />
        <Text className="text-muted-foreground mt-4 text-center">
          Chargement du restaurant…
        </Text>
      </View>
    );
  }

  // Convex query still in flight (first render of this tenant).
  if (orders === undefined) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <ActivityIndicator />
        <Text className="text-muted-foreground mt-4 text-center">
          Réception des commandes…
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="p-4 sm:p-6"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }
    >
      {/*
       * #406 — Pause exceptionnelle (PRD 20 §7a + ADR 0018).
       * Renders an entry-point pill in idle, or a « En pause jusqu'à HH:MM »
       * badge + « Reprendre » button when a pause is active. The cmds en cours
       * (the queue below) keep their workflow untouched — the pause only gates
       * NEW checkouts server-side via `acceptsOrderNow`.
       */}
      <PauseControl />

      {/*
       * #407 — Fermeture exceptionnelle (PRD 20 §7b + ADR 0018).
       * Sibling of `<PauseControl />` for the DURABLE 1+ day absence
       * (vacances, panne frigo, intempéries). Idle = entry-point pill that
       * opens a bottom sheet with quick presets (Aujourd'hui / J+1 / J+7) +
       * custom YYYY-MM-DD. Live = rose badge « Fermé jusqu'au JJ/MM » with
       * « Rouvrir » button. Same backend gate path as the pause — the
       * cmds en cours queue below stays untouched, the closure only blocks
       * NEW checkouts via `acceptsOrderNow`.
       */}
      <ClosureControl />

      {/*
       * #408 — Disponibilité des items (PRD 20 §7c + ADR 0018).
       * Entry pill that navigates to `/disponibilite-items`. The list
       * surfaces the first-usage tooltip (`ITEM_TOGGLE_TOOLTIP_TEXT`) before
       * firing `setItemAvailability`, per the PRD-frozen pédagogie. The
       * cmds en cours queue below stays untouched — toggling an item dispo
       * only gates NEW cart additions / checkouts (the backend
       * `createOrderFromCart` already rejects unavailable items at
       * `freezeCartItem`, cart.ts §145-147).
       */}
      <ItemAvailabilityEntry />

      {/*
       * #409 — Horaires d'ouverture (PRD 20 §7d + ADR 0018).
       * Entry pill that navigates to `/service-hours`. The screen exposes
       * a toggle « Aujourd'hui » / « Cette semaine » + per-day slot editor
       * wired to the SAME backend mutation (`serviceHours.set`) the KB
       * Admin mirror uses (#236 / #397). Édition complète des horaires
       * permanents (jours fériés annuels) reste KB Admin seul (ADR 0018).
       * Les cmds en cours sur la home ne sont PAS impactées — la modif
       * horaires ne gate que les NEW checkouts via `isOpenNow` côté PWA
       * client (même discipline que pause / fermeture exceptionnelle).
       */}
      <ServiceHoursEntry />

      {/*
       * #412 — Imprimante cuisine Star WebPRNT (PRD 20 §14 + §10).
       * Entry pill that navigates to `/printer`. The screen exposes the
       * Star WebPRNT URL field + « Tester l'impression » + « Retirer
       * l'imprimante » buttons wired to `api.lib.printing.printing.*`.
       * Same state Convex partagé that KB Admin (#416) will write to
       * (PRD 20 §14), so a change on the web admin flips the kitchen
       * tablet live through the Convex sub.
       */}
      <PrinterEntry />

      {/*
       * #410 — Stats rapides V1 (PRD 20 §9).
       * 4 KPI minimaux (CA jour, nb cmds jour, CA semaine, comparatif S-1)
       * dans une grille 2×2 sous les entry pills de disponibilité commerciale.
       * Pas de graphes — les graphes Recharts vivent côté KB Admin
       * (F-STATS-DASHBOARD #252/#253/#257). Subscription Convex temps réel,
       * le delta % est dérivé client-side via `decideQuickStats`.
       * Les états terminaux `refusée` et `auto_expired` sont EXCLUS du CA
       * (PRD 20 §9 « c'est du CA réalisé »).
       */}
      <QuickStats />

      <View className="mb-4 flex-row items-center justify-between">
        <Text className="text-foreground text-xl font-semibold">
          Commandes en cours
        </Text>
        <Text className="text-muted-foreground text-sm">
          {orders.length} en cours
        </Text>
      </View>

      {orders.length === 0 ? (
        <View className="items-center gap-2 py-12">
          <View className="bg-muted h-16 w-16 items-center justify-center rounded-2xl">
            <Text className="text-3xl">🍳</Text>
          </View>
          <Text className="text-foreground text-base font-semibold">
            Aucune commande en cours
          </Text>
          <Text className="text-muted-foreground max-w-sm text-center text-sm">
            Les nouvelles commandes apparaissent ici dès qu&apos;elles sont
            payées.
          </Text>
        </View>
      ) : (
        orders.map((order) => <OrderCard key={order._id} order={order} />)
      )}
    </ScrollView>
  );
}
