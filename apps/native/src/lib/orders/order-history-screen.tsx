import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { cn } from "@/lib/utils";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, View } from "react-native";

import {
  DATE_RANGE_PRESETS,
  ORDER_HISTORY_TABS,
  applyHistoryTabFilter,
  decideHistoryStatusBadgeStyle,
  filterOrdersByDateRange,
  searchOrdersById,
  type DateRangeKey,
  type OrderHistoryTabKey,
} from "./decide-history";
import { decideModeTag, decideStatusLabel } from "./decide-order-card";

/**
 * #417 — Historique des commandes côté app native (PRD 20 §8).
 *
 * Équivalent natif de la page admin F-COMMANDES (#222/#227/#238/#239 +
 * #415 « 4 onglets »). Liste paginée infinie via FlatList des cmds
 * TERMINALES du tenant courant, triée DESC `createdAt` (le backend
 * `listOrders` retourne déjà NEWEST FIRST via `by_tenant.order('desc')`).
 *
 * Composition des 3 prédicats purs (`decide-history.ts`) :
 *
 *   listOrders → applyHistoryTabFilter → filterOrdersByDateRange → searchOrdersById
 *
 * L'ordre de composition est commutatif (intersection pure — pinned dans
 * le test suite) ; mémoïsé sur `(orders, tab, dateRange, search)` pour
 * éviter de re-filtrer à chaque render non-data.
 *
 * Réutilisation backend (issue body, mémoire `backend-embedded-in-
 * frontend-story`) : on consomme le `api.lib.orders.orders.listOrders`
 * EXISTANT (chantier 2.3-A, `OPERATIONAL_ALLOW = ["kb_manager", "staff"]`)
 * — aucun nouvel endpoint Convex pour cette story. Le filtrage vit côté
 * client ; pour V1 le volume par tenant reste petit (le PRD prévoit ≤
 * quelques dizaines de cmds/jour), une cursor-pagination Convex serait
 * over-engineered. Si le volume devient un problème (V2 multi-tenant
 * lourd), on revient ajouter un index/cursor — c'est purement additif.
 *
 * Tap sur une ligne → `/orders/[orderId]` (le detail screen #401/#402/
 * #403/#404 existant). Sur les états terminaux, le detail rend en lecture
 * seule via `decideWorkflowButton` qui retourne `{kind: "none"}` (déjà
 * câblé pour livrée/collectée/refusée, étendu pour auto_expired par cette
 * story).
 *
 * Tenant scoping (#399 + ADR 0010) — `useActiveTenantId` résout le tenant
 * actif depuis le device row + la session attachment list (kiosque pin
 * wins, else lastSelected, else first attached). `null` pendant le
 * loading ou si aucun tenant n'est résolvable ; dans ce cas on rend un
 * placeholder. La query Convex elle-même est auto-scopée backend-side via
 * `tenantQuery` — un tenantId étranger throw Forbidden upstream (le
 * wrapper, pas ce composant, est la source de vérité de l'isolation).
 *
 * MOAT (ADR 0010) — recherche par ID UNIQUEMENT, jamais par nom/tel/
 * email client. Le composant ne lit jamais le `customers` row.
 */
export function OrderHistoryScreen(): React.ReactElement {
  const router = useRouter();
  const activeTenantId = useActiveTenantId();
  const orders = useQuery(
    api.lib.orders.orders.listOrders,
    activeTenantId !== null ? { tenantId: activeTenantId } : "skip",
  );

  // Tab + dateRange + search — page-owned, controlled. Same discipline as
  // the admin sister `/commandes` page : the Convex sub serves the live
  // payload, the pure predicates re-filter on every push (no setState
  // round-trip, no stale snapshot — AC8 de F-COMMANDES-FILTERS).
  const [tab, setTab] = useState<OrderHistoryTabKey>("all");
  const [dateRange, setDateRange] = useState<DateRangeKey>("tout");
  const [search, setSearch] = useState("");

  // Mémoïsation : re-filtre uniquement quand orders / tab / dateRange /
  // search change. Le triple `applyHistoryTabFilter → filterOrdersByDateRange
  // → searchOrdersById` est pur et commutatif, mais on garde un ordre
  // déterministe pour la lisibilité.
  const filtered = useMemo<Doc<"orders">[] | undefined>(() => {
    if (orders === undefined) return undefined;
    let out = applyHistoryTabFilter(orders, tab);
    out = filterOrdersByDateRange(out, dateRange);
    out = searchOrdersById(out, search);
    return out;
  }, [orders, tab, dateRange, search]);

  // --- Branches de rendu --------------------------------------------------

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

  const isLoading = filtered === undefined;
  const list: Doc<"orders">[] = filtered ?? [];

  return (
    <View className="bg-background flex-1">
      <ListHeader
        tab={tab}
        onTabChange={setTab}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        search={search}
        onSearchChange={setSearch}
      />
      {isLoading ? (
        <View className="flex-1 items-center justify-center p-6">
          <ActivityIndicator />
          <Text className="text-muted-foreground mt-4 text-center">
            Chargement de l&apos;historique…
          </Text>
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(o) => o._id as unknown as string}
          contentContainerClassName="p-4 sm:p-6"
          ListEmptyComponent={EmptyState}
          renderItem={({ item }) => (
            <HistoryRow
              order={item}
              onPress={(orderId) =>
                router.push({
                  pathname: "/orders/[orderId]",
                  params: { orderId: orderId as unknown as string },
                })
              }
            />
          )}
          // FlatList ships a virtualised render window — that IS our
          // « infinite scroll » V1. PRD 20 §8 allows infinite scroll OR
          // numbered pages ; we picked infinite for simplicity, mirror du
          // pattern admin OrdersTable (#227) qui rend tout d'un coup mais
          // sur du HTML (le DOM mobile devient lourd au-delà de 100 lignes,
          // FlatList gère ça naturellement).
        />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// List header — tabs + search + date row
// ---------------------------------------------------------------------------

type ListHeaderProps = {
  tab: OrderHistoryTabKey;
  onTabChange: (next: OrderHistoryTabKey) => void;
  dateRange: DateRangeKey;
  onDateRangeChange: (next: DateRangeKey) => void;
  search: string;
  onSearchChange: (next: string) => void;
};

function ListHeader({
  tab,
  onTabChange,
  dateRange,
  onDateRangeChange,
  search,
  onSearchChange,
}: ListHeaderProps) {
  return (
    <View className="border-border bg-background border-b px-4 pb-3 pt-2 sm:px-6">
      {/* Tabs row — 4 pills, horizontally scrollable thanks to FlatList
        horizontal. On a kitchen tablet (large viewport) they all fit on
        one line; on a phone in mobility the gérant scrolls right to reach
        « Manquées ». */}
      <FlatList
        data={
          ORDER_HISTORY_TABS as unknown as {
            key: OrderHistoryTabKey;
            label: string;
          }[]
        }
        horizontal
        keyExtractor={(t) => t.key}
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
        className="mb-3"
        renderItem={({ item }) => {
          const isActive = tab === item.key;
          return (
            <Button
              size="sm"
              variant={isActive ? "default" : "outline"}
              accessibilityLabel={`Filtrer par ${item.label}`}
              onPress={() => onTabChange(item.key)}
              className="px-3"
            >
              <Text className={cn(isActive && "text-primary-foreground")}>
                {item.label}
              </Text>
            </Button>
          );
        }}
      />
      {/* Search input — ID only (MOAT, ADR 0010). Placeholder reminds the
        gérant of the workflow (« cherche par identifiant cmd »). */}
      <Input
        value={search}
        onChangeText={onSearchChange}
        placeholder="Rechercher par ID de commande…"
        accessibilityLabel="Rechercher par ID de commande"
        autoCapitalize="none"
        autoCorrect={false}
        className="mb-3"
      />
      {/* Date range presets — 4 pills. Same horizontal scroll pattern. */}
      <FlatList
        data={DATE_RANGE_PRESETS as unknown as DateRangeKey[]}
        horizontal
        keyExtractor={(p) => p}
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-2"
        renderItem={({ item }) => {
          const isActive = dateRange === item;
          const label = DATE_RANGE_LABELS[item];
          return (
            <Button
              size="sm"
              variant={isActive ? "default" : "outline"}
              accessibilityLabel={`Période ${label}`}
              onPress={() => onDateRangeChange(item)}
              className="px-3"
            >
              <Text className={cn(isActive && "text-primary-foreground")}>
                {label}
              </Text>
            </Button>
          );
        }}
      />
    </View>
  );
}

/** FR labels for the date-range presets — gérant vocabulary. The PRD §8
 * wrote « aujourd'hui / 7j / 30j / tout », we mirror that exactly. */
const DATE_RANGE_LABELS: Record<DateRangeKey, string> = {
  today: "Aujourd'hui",
  "7d": "7 jours",
  "30d": "30 jours",
  tout: "Tout",
};

// ---------------------------------------------------------------------------
// History row
// ---------------------------------------------------------------------------

function HistoryRow({
  order,
  onPress,
}: {
  order: Doc<"orders">;
  onPress: (orderId: Id<"orders">) => void;
}) {
  // Color-coded badge (sémantique : terminaux POSITIFS = vert KB, NÉGATIFS
  // = rouge destructive). `decideHistoryStatusBadgeStyle` renvoie `null`
  // pour les statuts non-terminaux ; l'historique filtre déjà ces statuts
  // upstream (`applyHistoryTabFilter` → `HISTORY_TERMINAL_STATUSES`), mais
  // on garde un fallback gris-neutre par défense en profondeur (au cas où
  // un statut in-flight leak via une race / un futur ajout de schema).
  const badgeStyle = decideHistoryStatusBadgeStyle(order.status);
  const modeTag = decideModeTag(order.mode);
  const totalEuros =
    order.pricingSnapshot !== undefined
      ? (order.pricingSnapshot.total / 100).toFixed(2)
      : null;
  const idTail = (order._id as unknown as string).slice(-4).toUpperCase();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir la commande ${idTail}`}
      onPress={() => onPress(order._id)}
      className="border-border bg-card mb-3 rounded-2xl border p-4 active:opacity-70"
    >
      <View className="flex-row items-center justify-between">
        <Text className="text-foreground text-base font-semibold">
          Cmd #{idTail}
        </Text>
        {modeTag !== null ? (
          <View
            className={cn(
              "flex-row items-center gap-1 rounded-md px-2 py-1",
              order.mode === "delivery" ? "bg-secondary" : "bg-muted",
            )}
            accessibilityLabel={`Mode ${modeTag.label}`}
          >
            <Text className="text-sm">{modeTag.emoji}</Text>
            <Text className="text-foreground text-xs font-semibold">
              {modeTag.label}
            </Text>
          </View>
        ) : null}
      </View>
      <View className="mt-1 flex-row items-center justify-between">
        <HistoryStatusBadge status={order.status} badgeStyle={badgeStyle} />
        {totalEuros !== null ? (
          <Text className="text-foreground text-base font-semibold">
            {totalEuros} €
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// HistoryStatusBadge — small reusable badge (icon + colored label)
// ---------------------------------------------------------------------------

/**
 * Badge status historique (icône + label colorisé). Texte coloré + icône
 * SANS background coloré — on garde le bg du card neutre (le row reste
 * discret dans une FlatList scrollable). Le color-coding sémantique vit
 * dans `decideHistoryStatusBadgeStyle` (pure, testable).
 *
 * Fallback : si `badgeStyle === null` (statut non-terminal, défense en
 * profondeur), on rend le label gris-neutre via `decideStatusLabel`. Ce
 * cas ne devrait jamais arriver dans l'historique mais protège un detail
 * screen ouvert sur un état in-flight.
 */
function HistoryStatusBadge({
  status,
  badgeStyle,
}: {
  status: Doc<"orders">["status"];
  badgeStyle: ReturnType<typeof decideHistoryStatusBadgeStyle>;
}) {
  if (badgeStyle === null) {
    return (
      <Text className="text-muted-foreground text-sm">
        {decideStatusLabel(status)}
      </Text>
    );
  }
  return (
    <View className="flex-row items-center gap-1">
      <Ionicons
        name={badgeStyle.iconName}
        size={14}
        className={badgeStyle.toneClass}
      />
      <Text className={cn("text-sm font-medium", badgeStyle.toneClass)}>
        {badgeStyle.label}
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <View className="items-center gap-2 py-12">
      <View className="bg-muted h-16 w-16 items-center justify-center rounded-2xl">
        <Ionicons name="time-outline" size={28} color="#666" />
      </View>
      <Text className="text-foreground text-base font-semibold">
        Aucune commande dans cette vue
      </Text>
      <Text className="text-muted-foreground max-w-sm text-center text-sm">
        Affine la période, change d&apos;onglet ou efface ta recherche pour voir
        d&apos;autres commandes.
      </Text>
    </View>
  );
}
