import "@/lib/nativewind-interop";
import { ThemeStatusBar } from "@/lib/theme-status-bar";
import { useDeviceId } from "@/hooks/use-device-id";
import { ForceUpdateGate } from "@/lib/force-update";
import {
  markIntentionalSignOut,
  SessionRevokedGate,
} from "@/lib/session-revoked";
import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { api } from "@packages/backend/convex/_generated/api";
import { BottomSheetModalProvider } from "@gorhom/bottom-sheet";
import { PortalHost } from "@rn-primitives/portal";
import { ConvexReactClient, useConvexAuth, useQuery } from "convex/react";
import { Stack } from "expo-router";
import * as KeepAwake from "expo-keep-awake";
import * as SecureStore from "expo-secure-store";
import { useColorScheme } from "nativewind";
import { useEffect } from "react";
import { ActivityIndicator, Alert, Platform, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import "./global.css";

if (!process.env.EXPO_PUBLIC_CONVEX_URL) {
  throw new Error("EXPO_PUBLIC_CONVEX_URL is not set");
}

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL, {
  unsavedChangesWarning: false,
});

const secureStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <ConvexAuthProvider
        client={convex}
        storage={
          Platform.OS === "android" || Platform.OS === "ios"
            ? secureStorage
            : undefined
        }
      >
        {/*
         * #394 — boot force-update gate (PRD 20 §13 + ADR 0017).
         * Mounted INSIDE the Convex provider (it calls `useQuery` against the
         * PUBLIC `app.minBuildVersion()` — no auth required) but OUTSIDE
         * every auth-dependent provider so the gate runs PRE-AUTH and the
         * red "Mise à jour requise" screen surfaces even for signed-out
         * users on a too-old binary. The OTA layer + native layer are both
         * resolved inside the gate; children never render until the verdict
         * is `allow`.
         */}
        <ForceUpdateGate>
          {/*
           * #400 — « Session révoquée » gate (PRD 20 §13 + AC8).
           * Mounted INSIDE ConvexAuthProvider (uses `useConvexAuth` +
           * `useAuthActions`) and ABOVE every screen so the full-screen
           * overlay surfaces no matter where in `(app)` or `(auth)` the
           * user is when the remote revocation lands. Delegates the
           * verdict to the pure `decideSessionRevoked` (#400 test suite).
           */}
          <SessionRevokedGate>
            <GestureHandlerRootView>
              <BottomSheetModalProvider>
                <SafeAreaProvider>
                  <ThemeStatusBar />
                  <RootStack />
                  <PortalHost />
                </SafeAreaProvider>
              </BottomSheetModalProvider>
            </GestureHandlerRootView>
          </SessionRevokedGate>
        </ForceUpdateGate>
      </ConvexAuthProvider>
    </KeyboardProvider>
  );
}

function RootStack() {
  const { colorScheme } = useColorScheme();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const user = useQuery(api.table.users.currentUser);

  // #393 — per-(user, device) preference row. Drives the kiosque/téléphone
  // gate at first login (PRD 20 §1a) + `expo-keep-awake` activation in
  // kiosque mode (PRD 20 §12). `null` while the SecureStore read is in flight
  // or while Convex Auth resolves; `undefined` from Convex = query loading;
  // `null` value = no row yet (= show device-setup, AC1).
  const deviceId = useDeviceId();
  const device = useQuery(
    api.lib.devices.devices.getMyDevice,
    isAuthenticated && deviceId !== null ? { deviceId } : "skip",
  );
  const hasDeviceMode = device !== null && device !== undefined;
  const isKiosqueMode = hasDeviceMode && device.mode === "kiosque";
  // #398 — per-(user, device) skip flag for the post-login onboarding
  // sequence (push prompt + checklist réglages volume/veille). Set to true at
  // the end of `OnboardingFlow.markOnboardingCompleted`; subsequent launches
  // see `true` here and skip straight to `(app)` (PRD 20 §1a « séquence skip
  // aux re-launches »).
  const hasOnboardingCompleted =
    hasDeviceMode && device.onboardingCompleted === true;

  // PRD 20 §12 — kiosque ⇒ écran toujours allumé tant que l'app est foreground.
  // L'effet est idempotent : un tag déjà activé reste activé, un tag manquant
  // est désactivé silencieusement par expo-keep-awake.
  useEffect(() => {
    if (isKiosqueMode) {
      KeepAwake.activateKeepAwakeAsync("kb-kiosque").catch(() => {
        /* expo-keep-awake n'a pas de side-effect critique si la perm tombe */
      });
      return () => {
        KeepAwake.deactivateKeepAwake("kb-kiosque").catch(() => {});
      };
    }
    return undefined;
  }, [isKiosqueMode]);

  // Detect banned users and show alert before signing them out
  const isBanned =
    user?.banned && (!user.banExpires || user.banExpires > Date.now());

  useEffect(() => {
    if (isAuthenticated && isBanned) {
      Alert.alert(
        "Account Suspended",
        user?.banReason
          ? `Your account has been suspended: ${user.banReason}. Contact support if you believe this is an error.`
          : "Your account has been suspended. Contact support if you believe this is an error.",
        [
          {
            text: "OK",
            onPress: () => {
              // #400 — this is a voluntary sign-out path (ban → auto logout),
              // mark it so the « Session révoquée » gate doesn't mistakenly
              // surface an error overlay on the way out.
              markIntentionalSignOut();
              signOut();
            },
          },
        ],
      );
    }
  }, [isAuthenticated, isBanned, signOut, user?.banReason]);

  // While auth is loading, OR while we're authenticated but still resolving
  // the device row (SecureStore + Convex query), keep the splash spinner —
  // a flash to (device-setup) for a row that actually exists would be a
  // first-launch / re-launch UX bug.
  const isResolvingDevice =
    isAuthenticated &&
    (deviceId === null || (deviceId !== null && device === undefined));
  if (isLoading || isResolvingDevice) {
    return (
      <View className="flex-1 justify-center items-center bg-background">
        <ActivityIndicator color={colorScheme === "dark" ? "white" : "black"} />
      </View>
    );
  }
  return (
    <View className="flex-1 bg-background">
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade_from_bottom",
          contentStyle: { backgroundColor: "transparent" },
        }}
      >
        <Stack.Protected guard={!isAuthenticated}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>

        {/* #393 — au premier login sur un device sans préférence enregistrée,
           affiche le toggle « Mode kiosque ? Oui / Non » (PRD 20 §1a step 3,
           §12). Une fois la mutation passée, `device` se rafraîchit en temps
           réel et le stack rebascule sur (onboarding) ou (app). */}
        <Stack.Protected guard={isAuthenticated && !hasDeviceMode}>
          <Stack.Screen name="(device-setup)" />
        </Stack.Protected>

        {/* #398 — post-login sequence (push prompt + checklist réglages device,
            PRD 20 §1a steps 2 + 4). Mounted between `(device-setup)` and
            `(app)` while `device.onboardingCompleted` is not yet true. The
            flow flips it to true via `markOnboardingCompleted`, the Convex
            sub refreshes, and the gate below rebases onto `(app)`. */}
        <Stack.Protected
          guard={isAuthenticated && hasDeviceMode && !hasOnboardingCompleted}
        >
          <Stack.Screen name="(onboarding)" />
        </Stack.Protected>

        <Stack.Protected
          guard={isAuthenticated && hasDeviceMode && hasOnboardingCompleted}
        >
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </View>
  );
}
