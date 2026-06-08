import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
// V1 — Notifications widget commenté (KBO terrain 2026-06-07, le gérant
// n'a pas de choix donné côté DNT/sons/vibration en V1). Import laissés
// commentés, prêts à être ré-activés en V2 sans drift.
// import { Input } from "@/components/ui/input";
// import { Switch } from "@/components/ui/switch";
import { Text } from "@/components/ui/text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ConfirmationSheet } from "@/components/shared/confirmation-sheet";
import { SettingsGroup } from "@/components/app/account/settings-group";
import { SettingsRow } from "@/components/app/account/settings-row";
import { useDeviceId } from "@/hooks/use-device-id";
import { markIntentionalSignOut } from "@/lib/session-revoked";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { useAuthActions } from "@convex-dev/auth/react";
import { Ionicons } from "@expo/vector-icons";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import * as Updates from "expo-updates";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Linking as RNLinking,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
// import { isValidHHMM } from "./decide-notif-preferences"; // V1 — widget Notifs commenté
import {
  decideRebasculeMode,
  decideSettingsVisibility,
  decideStripeBadge,
  decideUberBadge,
  type IntegrationBadge,
} from "./decide-settings";
// import { useNotifPreferences } from "./use-notif-preferences"; // V1 — widget Notifs commenté

/**
 * #418 — KB Orders « Settings complète » (PRD 20 §10).
 *
 * The Settings page is principally an INTEGRATION story (cf. issue body):
 * every section reuses primitives shipped by the upstream KB Orders stories
 * (#393, #394, #395, #396, #398, #399, #400, #411, #412). This screen
 * stitches them together into the unified Settings home the gérant lands
 * on from the bottom-tab « Account » trigger.
 *
 *  1. **Profile** (#398/#413 baseline) — name + email read-only via
 *     `currentUser`, link to the existing `/account/edit` route (the
 *     starter template already pins photo + name editing). NB: password
 *     management is handled exclusively from KB Admin web — the native
 *     app intentionally does NOT surface a « Changer le mot de passe »
 *     entry (KBO terrain 2026-06-07).
 *
 *  2. **Notifs** (PRD 20 §3 + §10) — DNT start/end HH:MM, sounds on/off,
 *     vibration on/off. Persisted locally in SecureStore via
 *     `useNotifPreferences` (V1 leg — Convex twin is a follow-up open
 *     question, cf. the hook's docstring).
 *
 *  3. **Compte rattaché** — tenant list (from `getSession`) + Stripe +
 *     Uber Direct badges (reused from #411 `getTenantHealth`) + a deep
 *     link to KB Admin web. The badges use the same three-state semantics
 *     as the runtime #411 gate so Settings + home agree.
 *
 *  4. **Imprimante cuisine** (#412 plug) — entry row that navigates to
 *     `/printer` (the existing `PrinterSettingsScreen` from
 *     `lib/printing`). Replaces the placeholder pill the home strip used
 *     during the #412 launch — cf. PRD 20 §10 « La section Imprimante
 *     mise dans Settings ici remplace si nécessaire l'ajout placeholder
 *     posé par #412 ». We keep the home pill (gérant convenience) AND
 *     surface the section in Settings (PRD).
 *
 *  5. **Switcher tenant** (#399 plug) — only visible in mode téléphone
 *     for N≥2 tenants. The header `<TenantSwitcher />` (in
 *     `(app)/_layout.tsx`) is the actual picker; this row presents
 *     « Restaurant actif » + a tap-to-open hint pointing at the chip.
 *
 *  6. **Mode kiosque/téléphone toggle** (#393 plug) — re-modifiable from
 *     here (PRD 20 §12). Rebascule fires `setMyDeviceMode` then
 *     `Updates.reloadAsync()` so the `(app)` shell re-arms with the new
 *     mode (the layout hides/surfaces the TenantSwitcher above the Stack
 *     based on `device.mode`). The confirmation prompts use the pure
 *     `decideRebasculeMode` to drive the right branch (mono, multi-pick,
 *     no tenant).
 *
 *  7. **Logout** (#396/#400 reuse) — `markIntentionalSignOut()` BEFORE
 *     `signOut()` so the « Session révoquée » overlay (#400) doesn't
 *     misfire on a voluntary path. Same pattern as the existing tabs
 *     account screen and the banned-user alert.
 *
 *  8. **Version app + check update** — `Application.nativeBuildVersion` +
 *     OTA `runtimeVersion` for diagnostic context. The « Mettre à jour »
 *     CTA opens the App Store / Play Store directly (same URLs the
 *     #394 `ForceUpdateGate` uses on `block-native-update`).
 *
 *  9. **Lien support KB** — `mailto:support@kitchen-boost.com` with a
 *     diagnostic-friendly subject (device + tenant id), so support can
 *     triage the message without back-and-forth.
 */

const SUPPORT_EMAIL = "support@kitchen-boost.com";
const KB_ADMIN_URL = "https://admin.kitchen-boost.com";
const STORE_LINKS = {
  ios: "https://apps.apple.com/",
  android: "https://play.google.com/store/apps/",
} as const;

export function SettingsScreen(): React.ReactElement {
  const router = useRouter();
  const { signOut } = useAuthActions();
  const deviceId = useDeviceId();

  const user = useQuery(api.table.users.currentUser);
  const session = useQuery(api.lib.auth.getSession.getSession);
  const device = useQuery(
    api.lib.devices.devices.getMyDevice,
    deviceId !== null ? { deviceId } : "skip",
  );
  const activeTenantId = useActiveTenantId();
  // `getTenantHealth` is OPERATIONAL_ALLOW (kb_manager + staff), the same
  // query the home `<TenantStatusBanner />` (#411) consumes. We only call it
  // when a tenant is resolved (avoids a Forbidden flash for kb_admin).
  const tenantHealth = useQuery(
    api.lib.orders.orders.getTenantHealth,
    activeTenantId !== null ? { tenantId: activeTenantId } : "skip",
  );
  const setMode = useMutation(api.lib.devices.devices.setMyDeviceMode);

  // Pure visibility verdict — drives which sections render this frame.
  const visibility = decideSettingsVisibility({
    deviceMode: device?.mode ?? null,
    session:
      session === undefined
        ? null
        : { isAdmin: session.isAdmin, tenantCount: session.tenants.length },
  });

  // V1 — Notifications widget retiré (KBO terrain 2026-06-07). Pas de choix
  // donné au cuisinier sur DNT/sons/vibration en V1. Le hook + le widget
  // restent en mémoire prêts à être ré-activés en V2.
  // const notifs = useNotifPreferences();

  // Sheets — re-used the ConfirmationSheet pattern from the existing
  // tabs/account.tsx for logout / delete / mode rebascule confirmation.
  const logoutSheetRef = React.useRef<BottomSheetModal>(null);
  const rebasculeSheetRef = React.useRef<BottomSheetModal>(null);
  const tenantPickerSheetRef = React.useRef<BottomSheetModal>(null);

  // Local pending rebascule action — populated when the user taps the toggle
  // row, then executed when they confirm in the sheet. Null when no rebascule
  // is pending. The `pinnedTenantId` is null for the téléphone path.
  const [pendingRebascule, setPendingRebascule] = React.useState<null | {
    mode: "kiosque" | "telephone";
    pinnedTenantId: Id<"tenants"> | null;
  }>(null);
  const [isRebasculing, setIsRebasculing] = React.useState(false);

  const displayName = user?.name ?? user?.email ?? "Compte";
  const displayEmail = user?.email ?? "—";
  const avatarInitial = React.useMemo(() => {
    const fromName = user?.name?.trim()?.[0];
    const fromEmail = user?.email?.trim()?.[0];
    return (fromName || fromEmail || "?").toUpperCase();
  }, [user?.name, user?.email]);

  const handleLogout = () => {
    logoutSheetRef.current?.dismiss();
    // #400 — voluntary logout: mark intent BEFORE signOut so the
    // « Session révoquée » overlay does NOT surface on the way out.
    markIntentionalSignOut();
    signOut();
  };

  const handleConfirmRebascule = async () => {
    if (pendingRebascule === null || deviceId === null) return;
    setIsRebasculing(true);
    try {
      if (pendingRebascule.mode === "kiosque") {
        if (pendingRebascule.pinnedTenantId === null) {
          throw new Error("Internal — kiosque rebascule without pin");
        }
        await setMode({
          deviceId,
          mode: "kiosque",
          pinnedTenantId: pendingRebascule.pinnedTenantId,
        });
      } else {
        await setMode({ deviceId, mode: "telephone" });
      }
      // PRD 20 §10 point 6 — « L'app va redémarrer pour appliquer le
      // changement ». In dev (Updates.manifest undefined) the reload is a
      // no-op; we surface a confirmation instead so the gérant knows the
      // mutation landed.
      if (__DEV__ || !Updates.isEnabled) {
        Alert.alert(
          "Mode mis à jour",
          "Redémarre l'app manuellement pour appliquer le changement.",
        );
        rebasculeSheetRef.current?.dismiss();
        setPendingRebascule(null);
      } else {
        await Updates.reloadAsync();
      }
    } catch (err) {
      Alert.alert("Erreur", getConvexErrorMessage(err));
    } finally {
      setIsRebasculing(false);
    }
  };

  const handleTapKiosqueToggle = () => {
    if (device?.mode === undefined) return;
    if (session === undefined) return;
    const tenantIds = session.tenants.map((t) => t.tenantId);
    const verdict = decideRebasculeMode({
      currentMode: device.mode,
      attachedTenantIds: tenantIds,
    });
    switch (verdict.kind) {
      case "noop":
        return;
      case "unavailable-kiosque-no-tenant":
        Alert.alert(
          "Mode cuisine indisponible",
          "Tu n'es pas encore rattaché à un restaurant — la bascule en mode cuisine n'est possible qu'avec un restaurant pinné.",
        );
        return;
      case "confirm-telephone":
        setPendingRebascule({ mode: "telephone", pinnedTenantId: null });
        rebasculeSheetRef.current?.present();
        return;
      case "confirm-kiosque-mono":
        setPendingRebascule({
          mode: "kiosque",
          pinnedTenantId: verdict.pinnedTenantId,
        });
        rebasculeSheetRef.current?.present();
        return;
      case "confirm-kiosque-pick":
        // Multi-tenant kiosque — ask which tenant to pin first.
        tenantPickerSheetRef.current?.present();
        return;
    }
  };

  const onPickTenantForKiosque = (tenantId: Id<"tenants">) => {
    setPendingRebascule({ mode: "kiosque", pinnedTenantId: tenantId });
    tenantPickerSheetRef.current?.dismiss();
    // Defer to next tick so the picker sheet finishes dismissing before the
    // rebascule sheet presents on top of it.
    setTimeout(() => {
      rebasculeSheetRef.current?.present();
    }, 200);
  };

  const handleOpenSupport = () => {
    const subject = encodeURIComponent("Support KB Orders");
    const body = encodeURIComponent(
      [
        "Bonjour,",
        "",
        "Décris ici ton problème — l'équipe KB répond en moins d'un jour ouvré.",
        "",
        "---",
        "Diagnostic (laisse tel quel):",
        `Device: ${Platform.OS} ${Platform.Version}`,
        `App: ${Application.nativeApplicationVersion ?? "?"} (build ${Application.nativeBuildVersion ?? "?"})`,
        `User: ${user?.email ?? "?"}`,
        `Tenant: ${activeTenantId ?? "—"}`,
      ].join("\n"),
    );
    const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
    Linking.openURL(url).catch(() => RNLinking.openURL(url).catch(() => {}));
  };

  const handleOpenStore = () => {
    const url = Platform.OS === "ios" ? STORE_LINKS.ios : STORE_LINKS.android;
    Linking.openURL(url).catch(() => RNLinking.openURL(url).catch(() => {}));
  };

  const handleOpenKbAdmin = () => {
    Linking.openURL(KB_ADMIN_URL).catch(() =>
      RNLinking.openURL(KB_ADMIN_URL).catch(() => {}),
    );
  };

  // Render guard — wait for the bare-minimum (currentUser) to resolve. The
  // visibility decision already gates sub-sections; this guard avoids a
  // flash of « Compte / — » initials at first frame.
  if (user === undefined || session === undefined) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        className="bg-background flex-1"
        contentContainerClassName="p-4 pb-10 sm:p-6 gap-5"
        contentInsetAdjustmentBehavior="automatic"
      >
        <View className="gap-6">
          <Text variant="h3" className="text-left">
            Réglages
          </Text>

          {/* Profile header (visible always — point 1) */}
          {visibility.showProfile ? (
            <View className="flex-row items-center gap-4 rounded-2xl">
              <Avatar alt={displayName} className="size-14">
                {user?.image ? (
                  <AvatarImage source={{ uri: user.image }} />
                ) : (
                  <AvatarFallback>
                    <Text className="text-lg font-semibold">
                      {avatarInitial}
                    </Text>
                  </AvatarFallback>
                )}
              </Avatar>
              <View className="flex-1">
                <Text className="text-lg font-semibold">{displayName}</Text>
                <Text className="text-muted-foreground text-sm">
                  {displayEmail}
                </Text>
              </View>
            </View>
          ) : null}

          {/* Ouverture & horaires (drawer / bottom-tabs refonte) — entry
           qui navigue vers `/settings/availability`, le sous-écran qui
           regroupe les 4 widgets de disponibilité commerciale (pause,
           fermeture, dispo items, horaires) précédemment empilés sur
           le home. Visible uniquement pour les utilisateurs rattachés
           à au moins un tenant (PRD 20 §7 + §10 — disponibilité par
           tenant). */}
          {visibility.showAccountTenant ? (
            <SettingsGroup
              title="Ouverture & horaires"
              items={[
                {
                  label: "Pause, fermeture, items, horaires",
                  icon: "time-outline",
                  onPress: () => router.push("/settings/availability"),
                },
              ]}
            />
          ) : null}

          {/* Profile (point 1) */}
          {visibility.showProfile ? (
            <SettingsGroup
              title="Profil"
              items={[
                {
                  label: "Modifier le profil",
                  icon: "person-outline",
                  onPress: () => router.push("/account/edit"),
                },
              ]}
            />
          ) : null}

          {/* Notifs (point 3) — V1 commenté (KBO terrain 2026-06-07).
           *  Le gérant n'a pas le choix sur DNT/sons/vibration en V1.
           *  Décommenter le bloc ci-dessous + ses imports pour ré-activer
           *  en V2 (aucun drift backend — le hook persiste en SecureStore).
           *
           *  {visibility.showNotifs ? (
           *    <NotifsSection
           *      prefs={notifs.prefs}
           *      setDntStart={notifs.setDntStart}
           *      setDntEnd={notifs.setDntEnd}
           *      setSoundEnabled={notifs.setSoundEnabled}
           *      setVibrationEnabled={notifs.setVibrationEnabled}
           *    />
           *  ) : null}
           */}

          {/* Compte rattaché (point 4) */}
          {visibility.showAccountTenant ? (
            <AccountTenantSection
              tenants={session.tenants}
              activeTenantId={activeTenantId}
              tenantHealth={tenantHealth}
              onOpenKbAdmin={handleOpenKbAdmin}
            />
          ) : null}

          {/* Imprimante cuisine (point 5) */}
          {visibility.showPrinter ? (
            <SettingsGroup
              title="Imprimante cuisine"
              items={[
                {
                  label: "Configurer l'imprimante Star WebPRNT",
                  icon: "print-outline",
                  onPress: () => router.push("/printer"),
                },
              ]}
            />
          ) : null}

          {/* Mode + switcher (point 5 + 6 + 7) */}
          {visibility.showKiosqueToggle ? (
            <SettingsGroup
              title="Mode de l'app"
              items={[
                {
                  label:
                    device?.mode === "kiosque"
                      ? "Passer en mode téléphone"
                      : "Passer en mode cuisine (kiosque)",
                  icon:
                    device?.mode === "kiosque"
                      ? "phone-portrait-outline"
                      : "tablet-landscape-outline",
                  onPress: handleTapKiosqueToggle,
                },
                ...(visibility.showSwitcher
                  ? [
                      {
                        label:
                          "Changer de restaurant (utilise le chip en haut)",
                        icon: "storefront-outline" as const,
                        onPress: () => {
                          Alert.alert(
                            "Changer de restaurant",
                            "Utilise le bouton en haut de la page d'accueil pour sélectionner un autre restaurant.",
                          );
                        },
                      },
                    ]
                  : []),
              ]}
            />
          ) : null}

          {/* Version + support + logout (points 8 + 9 + 10) */}
          {visibility.showVersion ? (
            <VersionSection onOpenStore={handleOpenStore} />
          ) : null}

          {visibility.showSupport ? (
            <SettingsGroup
              title="Support"
              items={[
                {
                  label: "Contacter le support KB",
                  icon: "chatbubbles-outline",
                  onPress: handleOpenSupport,
                },
              ]}
            />
          ) : null}

          {/* Logout (point 8) — last, destructive, isolated card */}
          {visibility.showLogout ? (
            <View className="overflow-hidden rounded-2xl border border-border/60 bg-secondary/60">
              <View className="divide-y divide-border/60">
                <SettingsRow
                  label="Se déconnecter"
                  icon="log-out-outline"
                  showChevron={false}
                  onPress={() => logoutSheetRef.current?.present()}
                />
              </View>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <ConfirmationSheet
        sheetRef={logoutSheetRef}
        icon="log-out-outline"
        title="Se déconnecter"
        description="Tu devras te reconnecter pour accéder à ton compte."
        confirmLabel="Se déconnecter"
        destructive
        onConfirm={handleLogout}
      />

      <ConfirmationSheet
        sheetRef={rebasculeSheetRef}
        icon="refresh-outline"
        title={
          pendingRebascule?.mode === "kiosque"
            ? "Passer en mode cuisine ?"
            : "Passer en mode téléphone ?"
        }
        description="L'app va redémarrer pour appliquer le changement."
        confirmLabel="Redémarrer"
        loading={isRebasculing}
        onConfirm={() => void handleConfirmRebascule()}
      />

      {/* Multi-tenant kiosque picker — surfaced when the verdict is
       * `confirm-kiosque-pick`. After picking, defers to the rebascule
       * confirmation sheet (same UX as `(device-setup)` for first-login). */}
      <ConfirmationSheet
        sheetRef={tenantPickerSheetRef}
        icon="storefront-outline"
        title="Pour quel restaurant ?"
        description={
          session.tenants.map((t) => t.name).join(" · ") ||
          "Aucun restaurant disponible"
        }
        confirmLabel={session.tenants[0]?.name ?? "—"}
        onConfirm={() => {
          const first = session.tenants[0];
          if (first === undefined) return;
          onPickTenantForKiosque(first.tenantId);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-sections (split for readability)
// ---------------------------------------------------------------------------

// V1 — `NotifsSection` commenté (KBO terrain 2026-06-07). Pas de choix donné
// au cuisinier sur DNT/sons/vibration en V1. Le widget reste prêt à être
// ré-activé en V2 — dépend de `Input`, `Switch`, `Ionicons`, `isValidHHMM`,
// `useNotifPreferences` (tous laissés disponibles, imports commentés).
//
// function NotifsSection({
//   prefs,
//   setDntStart,
//   setDntEnd,
//   setSoundEnabled,
//   setVibrationEnabled,
// }: {
//   prefs: ReturnType<typeof useNotifPreferences>["prefs"];
//   setDntStart: (v: string) => Promise<void>;
//   setDntEnd: (v: string) => Promise<void>;
//   setSoundEnabled: (v: boolean) => Promise<void>;
//   setVibrationEnabled: (v: boolean) => Promise<void>;
// }) {
//   // Local mirror so the user can type without each setState shipping a
//   // SecureStore write on every keystroke. We persist `onBlur` or on each
//   // valid `HH:MM` shape (the validator pinned by the vitest suite).
//   const [dntStartInput, setDntStartInput] = React.useState<string | null>(null);
//   const [dntEndInput, setDntEndInput] = React.useState<string | null>(null);
//
//   React.useEffect(() => {
//     if (prefs !== null && dntStartInput === null)
//       setDntStartInput(prefs.dntStart);
//   }, [prefs, dntStartInput]);
//   React.useEffect(() => {
//     if (prefs !== null && dntEndInput === null) setDntEndInput(prefs.dntEnd);
//   }, [prefs, dntEndInput]);
//
//   if (prefs === null) {
//     return (
//       <Card>
//         <CardHeader>
//           <Text className="text-foreground text-base font-semibold">
//             Notifications
//           </Text>
//         </CardHeader>
//         <CardContent>
//           <ActivityIndicator />
//         </CardContent>
//       </Card>
//     );
//   }
//
//   return (
//     <Card>
//       <CardHeader>
//         <View className="flex-row items-center gap-2">
//           <Ionicons name="notifications-outline" size={18} color="#444" />
//           <Text className="text-foreground text-base font-semibold">
//             Notifications
//           </Text>
//         </View>
//       </CardHeader>
//       <CardContent className="gap-4">
//         <View className="gap-2">
//           <Text className="text-foreground text-sm font-medium">
//             Heures de silence (do not disturb)
//           </Text>
//           <Text className="text-muted-foreground text-xs">
//             Format 24h HH:MM — pas de son pendant la fenêtre.
//           </Text>
//           <View className="flex-row gap-2">
//             <View className="flex-1 gap-1">
//               <Text className="text-muted-foreground text-xs">Début</Text>
//               <Input
//                 accessibilityLabel="Début des heures de silence"
//                 value={dntStartInput ?? ""}
//                 onChangeText={(v) => setDntStartInput(v)}
//                 onBlur={() => {
//                   if (dntStartInput !== null && isValidHHMM(dntStartInput)) {
//                     void setDntStart(dntStartInput);
//                   } else if (prefs !== null) {
//                     // revert on invalid blur
//                     setDntStartInput(prefs.dntStart);
//                   }
//                 }}
//                 placeholder="22:00"
//                 keyboardType="numbers-and-punctuation"
//                 maxLength={5}
//               />
//             </View>
//             <View className="flex-1 gap-1">
//               <Text className="text-muted-foreground text-xs">Fin</Text>
//               <Input
//                 accessibilityLabel="Fin des heures de silence"
//                 value={dntEndInput ?? ""}
//                 onChangeText={(v) => setDntEndInput(v)}
//                 onBlur={() => {
//                   if (dntEndInput !== null && isValidHHMM(dntEndInput)) {
//                     void setDntEnd(dntEndInput);
//                   } else if (prefs !== null) {
//                     setDntEndInput(prefs.dntEnd);
//                   }
//                 }}
//                 placeholder="08:00"
//                 keyboardType="numbers-and-punctuation"
//                 maxLength={5}
//               />
//             </View>
//           </View>
//         </View>
//
//         <View className="flex-row items-center justify-between">
//           <View className="flex-1 pr-3">
//             <Text className="text-foreground text-sm font-medium">Sons</Text>
//             <Text className="text-muted-foreground text-xs">
//               Joue le son à chaque nouvelle commande.
//             </Text>
//           </View>
//           <Switch
//             accessibilityLabel="Activer les sons"
//             checked={prefs.soundEnabled}
//             onCheckedChange={(v) => void setSoundEnabled(v)}
//           />
//         </View>
//
//         <View className="flex-row items-center justify-between">
//           <View className="flex-1 pr-3">
//             <Text className="text-foreground text-sm font-medium">
//               Vibration
//             </Text>
//             <Text className="text-muted-foreground text-xs">
//               Vibre à chaque nouvelle commande.
//             </Text>
//           </View>
//           <Switch
//             accessibilityLabel="Activer les vibrations"
//             checked={prefs.vibrationEnabled}
//             onCheckedChange={(v) => void setVibrationEnabled(v)}
//           />
//         </View>
//       </CardContent>
//     </Card>
//   );
// }

function AccountTenantSection({
  tenants,
  activeTenantId,
  tenantHealth,
  onOpenKbAdmin,
}: {
  tenants: readonly {
    tenantId: Id<"tenants">;
    name: string;
    slug: string;
    role: "kb_manager" | "staff";
  }[];
  activeTenantId: Id<"tenants"> | null;
  tenantHealth:
    | {
        stripeStatus: "pending" | "ready" | "disabled" | null;
        uberDirectConfigured: boolean;
        acceptedModes: { delivery: boolean; clickAndCollect: boolean } | null;
        tenantStatus: "active" | "pending" | "suspended" | "disabled" | null;
      }
    | null
    | undefined;
  onOpenKbAdmin: () => void;
}) {
  const stripeBadge =
    tenantHealth === undefined || tenantHealth === null
      ? "idle"
      : decideStripeBadge({ stripeStatus: tenantHealth.stripeStatus });
  const uberBadge =
    tenantHealth === undefined || tenantHealth === null
      ? "idle"
      : decideUberBadge({
          uberDirectConfigured: tenantHealth.uberDirectConfigured,
          acceptedModes: tenantHealth.acceptedModes,
        });

  return (
    <Card>
      <CardHeader>
        <View className="flex-row items-center gap-2">
          <Ionicons name="business-outline" size={18} color="#444" />
          <Text className="text-foreground text-base font-semibold">
            Compte rattaché
          </Text>
        </View>
      </CardHeader>
      <CardContent className="gap-3">
        {tenants.length === 0 ? (
          <Text className="text-muted-foreground text-sm">
            Aucun restaurant rattaché — contacte KB pour t&apos;attacher.
          </Text>
        ) : (
          tenants.map((t) => {
            const isActive = t.tenantId === activeTenantId;
            return (
              <View key={t.tenantId} className="gap-1">
                <View className="flex-row items-center gap-2">
                  <Text className="text-foreground text-sm font-medium">
                    {t.name}
                  </Text>
                  {isActive ? (
                    <View className="rounded-full bg-emerald-100 px-2 py-0.5">
                      <Text className="text-xs font-semibold text-emerald-800">
                        Actif
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text className="text-muted-foreground text-xs">
                  {t.role === "kb_manager" ? "Gérant" : "Staff"}
                </Text>
              </View>
            );
          })
        )}

        <View className="border-border/60 mt-2 gap-2 border-t pt-3">
          <IntegrationRow label="Stripe Connect" badge={stripeBadge} />
          <IntegrationRow label="Uber Direct (livraison)" badge={uberBadge} />
        </View>

        <Button
          variant="outline"
          onPress={onOpenKbAdmin}
          accessibilityLabel="Ouvrir KB Admin web"
        >
          <Text>Ouvrir KB Admin web</Text>
        </Button>
      </CardContent>
    </Card>
  );
}

function IntegrationRow({
  label,
  badge,
}: {
  label: string;
  badge: IntegrationBadge;
}) {
  const styles = badgeStyles(badge);
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-foreground text-sm">{label}</Text>
      <View className={`rounded-full px-2 py-0.5 ${styles.bg}`}>
        <Text className={`text-xs font-semibold ${styles.fg}`}>
          {styles.label}
        </Text>
      </View>
    </View>
  );
}

function badgeStyles(badge: IntegrationBadge): {
  bg: string;
  fg: string;
  label: string;
} {
  switch (badge) {
    case "ok":
      return { bg: "bg-emerald-100", fg: "text-emerald-800", label: "OK" };
    case "warning":
      return { bg: "bg-amber-100", fg: "text-amber-800", label: "En attente" };
    case "error":
      return { bg: "bg-rose-100", fg: "text-rose-800", label: "À corriger" };
    case "idle":
    default:
      return {
        bg: "bg-muted",
        fg: "text-muted-foreground",
        label: "Non configuré",
      };
  }
}

function VersionSection({ onOpenStore }: { onOpenStore: () => void }) {
  const appVersion = Application.nativeApplicationVersion ?? "?";
  const buildVersion = Application.nativeBuildVersion ?? "?";
  const runtimeVersion =
    Constants.expoConfig?.runtimeVersion === undefined
      ? "?"
      : typeof Constants.expoConfig.runtimeVersion === "string"
        ? Constants.expoConfig.runtimeVersion
        : "policy";

  return (
    <Card>
      <CardHeader>
        <View className="flex-row items-center gap-2">
          <Ionicons name="information-circle-outline" size={18} color="#444" />
          <Text className="text-foreground text-base font-semibold">
            À propos
          </Text>
        </View>
      </CardHeader>
      <CardContent className="gap-3">
        <View className="gap-1">
          <Text className="text-muted-foreground text-xs">Version</Text>
          <Text className="text-foreground text-sm">
            KitchenBoost {appVersion} (build {buildVersion})
          </Text>
          <Text className="text-muted-foreground text-xs">
            Runtime {runtimeVersion}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Vérifier les mises à jour"
          onPress={onOpenStore}
          className="border-border bg-secondary/60 flex-row items-center justify-between rounded-lg border px-3 py-2 active:opacity-70"
        >
          <Text className="text-foreground text-sm font-medium">
            Vérifier les mises à jour
          </Text>
          <Ionicons name="open-outline" size={16} color="#666" />
        </Pressable>
      </CardContent>
    </Card>
  );
}
