import { useFormFactorShell } from "@/lib/form-factor";
import { Ionicons } from "@expo/vector-icons";
import { DrawerToggleButton } from "@react-navigation/drawer";
import { Drawer } from "expo-router/drawer";
import { NativeTabs } from "expo-router/unstable-native-tabs";

/**
 * KB Orders top-level shell — drawer-on-tablet OR bottom-tabs-on-phone.
 *
 * The hook `useFormFactorShell` composes `useWindowDimensions()` +
 * `getMyDevice` and the pure `decideFormFactorShell` to pick between two
 * navigators that BOTH expose the SAME 4 routes (`index`, `history`,
 * `stats`, `account`). The file system is unique ; only the chrome
 * (drawer vs tabs) differs.
 *
 *  - **Drawer** (tablet kiosque + ≥ 768px viewports) — drawer rétractable
 *    standard (`drawerType: "front"`). Fermé par défaut, ouvrable via
 *    bouton hamburger en header (gauche) ET via swipe depuis le bord
 *    gauche (geste natif Material 3 / iOS). Overlay sur le contenu avec
 *    scrim. Choix `front` plutôt que `slide` ou `permanent` : pattern le
 *    plus standard react-navigation, identique à 99% des apps Android/iOS
 *    avec drawer, n'amputaire pas la largeur utile du contenu sur tablette
 *    portrait.
 *  - **NativeTabs** (téléphone, KB Manager en mobilité) — bottom tabs
 *    natives via `expo-router/unstable-native-tabs` (déjà câblé par
 *    #393, on étend de 2 à 4 entries alignées avec le drawer).
 *
 * Pourquoi un layout conditionnel plutôt que 2 dossiers `(drawer)` /
 * `(tabs)` séparés :
 *  - Les 4 routes (Accueil, Historique, Stats, Paramètres) sont
 *    identiques entre les deux shells — un fichier par route × 2
 *    shells = 8 routes dupliquées, dette de maintenance immédiate.
 *  - Expo Router supporte le pattern « layout React conditionnel »
 *    parfaitement : les deux navigators consomment le même file system,
 *    seule la chrome diffère.
 *  - Le hook `useFormFactorShell` flippe le shell live à chaque
 *    rotation (la valeur de `useWindowDimensions().width` re-renderise),
 *    sans navigation perdue parce que la route active est résolue par
 *    le segment, pas par l'identité du navigator.
 *
 * Les écrans-modaux PRE-app (#393 device-setup, #394 force update, #400
 * session revoked, #405 connection lost, #411 critical tenant status)
 * sont montés AU-DESSUS de cette layout dans `_layout.tsx` racine, donc
 * ils continuent de masquer le shell quand ils sont actifs.
 */
export default function TabsLayout() {
  const shell = useFormFactorShell();
  if (shell === "drawer") {
    return <DrawerShell />;
  }
  return <TabsShell />;
}

// ---------------------------------------------------------------------------
// Drawer shell (tablet kiosque / large viewport) — 4 entries
// ---------------------------------------------------------------------------

function DrawerShell() {
  return (
    <Drawer
      screenOptions={{
        // Header minimal natif avec bouton hamburger à gauche (pattern
        // react-navigation standard via `DrawerToggleButton`). Le titre
        // de chaque section est défini par `options.title` sur chaque
        // `Drawer.Screen` ci-dessous.
        headerShown: true,
        headerLeft: () => <DrawerToggleButton tintColor="#1B7A3D" />,
        headerTitleStyle: {
          fontSize: 18,
          fontWeight: "600",
          color: "#111111",
        },
        headerStyle: {
          backgroundColor: "#ffffff",
        },
        headerTintColor: "#1B7A3D",
        // `front` = drawer rétractable standard : fermé par défaut,
        // overlay le contenu avec scrim, ouvrable via hamburger button
        // OU swipe depuis le bord gauche (geste natif).
        drawerType: "front",
        drawerStyle: {
          width: 240,
        },
        // Active item color = KB green (PRD 00_master, palette
        // « vert foncé #1B7A3D »). Keeps the cuisine drawer readable
        // at arm's length on the Lenovo Tab M8.
        drawerActiveTintColor: "#1B7A3D",
        drawerInactiveTintColor: "#666666",
        drawerLabelStyle: {
          fontSize: 16,
          fontWeight: "600",
        },
      }}
    >
      <Drawer.Screen
        name="index"
        options={{
          title: "Accueil",
          drawerLabel: "Accueil",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="home-outline" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="history"
        options={{
          title: "Historique",
          drawerLabel: "Historique",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="time-outline" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="stats"
        options={{
          title: "Stats",
          drawerLabel: "Stats",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="stats-chart-outline" size={size} color={color} />
          ),
        }}
      />
      <Drawer.Screen
        name="account"
        options={{
          title: "Paramètres",
          drawerLabel: "Paramètres",
          drawerIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Tabs shell (phone) — same 4 entries, bottom-tabs chrome
// ---------------------------------------------------------------------------

function TabsShell() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Accueil</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={"house.fill"}
          drawable={"ic_menu_mylocation"}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>Historique</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={"clock.fill"}
          drawable={"ic_menu_recent_history"}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="stats">
        <NativeTabs.Trigger.Label>Stats</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={"chart.bar.fill"}
          drawable={"ic_menu_sort_by_size"}
        />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Paramètres</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon
          sf={"gearshape.fill"}
          drawable={"ic_menu_preferences"}
        />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
