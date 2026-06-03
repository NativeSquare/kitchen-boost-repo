import { api } from "@packages/backend/convex/_generated/api";
import * as Application from "expo-application";
import Constants from "expo-constants";
import * as Linking from "expo-linking";
import * as Updates from "expo-updates";
import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking as RNLinking,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { decideForceUpdate, type UpdateCheck } from "./decide-force-update";

/**
 * #394 — boot force-update gate (PRD 20 §13 + [ADR 0017](../../../../../docs/adr/0017-force-update-expo-pattern-deux-couches.md)).
 *
 * Mounted at the root of the native app, BEFORE any other provider that
 * depends on auth state, so the gate runs PRE-AUTH (a user who never signs in
 * still gets the blocking screen on a too-old binary).
 *
 * Two layers, in priority order — see `decideForceUpdate` for the pinned
 * truth table:
 *  - native (`Application.nativeBuildVersion` vs Convex `app.minBuildVersion()`)
 *  - OTA (`Constants.expoConfig.extra.criticalIndex` vs incoming bundle's
 *         `manifest.extra.expoClient.extra.criticalIndex` from
 *         `Updates.checkForUpdateAsync()`)
 *
 * Three things are deliberately kept thin here (the branching itself lives in
 * the pure `decideForceUpdate`):
 *  - we resolve the four inputs in effects (with a `cancelled` flag for
 *    unmount safety),
 *  - we pass them to `decideForceUpdate`,
 *  - we render: splash (`wait`), children (`allow`), the red blocking screen
 *    (`block-native-update`), or splash + side-effect (`download-and-reload`
 *    → `fetchUpdateAsync()` + `reloadAsync()`).
 */

const STORE_LINKS = {
  /** TODO #394-followup — pin the production URLs once the apps are published. */
  ios: "https://apps.apple.com/",
  android: "https://play.google.com/store/apps/",
} as const;

function openStore() {
  const url = Platform.OS === "ios" ? STORE_LINKS.ios : STORE_LINKS.android;
  // `RNLinking.openURL` is the cross-platform fallback when expo-linking can't
  // open a market scheme — it works on every dev build / sim.
  Linking.openURL(url).catch(() => RNLinking.openURL(url).catch(() => {}));
}

export function ForceUpdateGate({ children }: { children: React.ReactNode }) {
  const minBuildVersion = useQuery(api.lib.app.app.minBuildVersion, {});
  const [updateCheck, setUpdateCheck] = useState<UpdateCheck | undefined>(
    undefined,
  );

  // Resolve `Updates.checkForUpdateAsync()` ONCE on mount. The gate is at root
  // layout so it runs once per app launch — re-running mid-session would be
  // wrong (iOS App Store guideline: « do not interrupt a session », ADR 0017).
  useEffect(() => {
    if (__DEV__) {
      // Dev builds: skip the OTA check entirely (the channel doesn't exist,
      // `Updates.manifest` is undefined). The decision function also short-
      // circuits on `isDev`, but setting a resolved result here keeps the
      // verdict away from `wait` from the start.
      setUpdateCheck({ isAvailable: false });
      return;
    }
    if (!Updates.isEnabled) {
      setUpdateCheck({ isAvailable: false });
      return;
    }

    let cancelled = false;
    Updates.checkForUpdateAsync()
      .then((result) => {
        if (cancelled) return;
        if (result.isAvailable) {
          // The incoming bundle's user-defined `extra` lives nested under
          // `manifest.extra.expoClient.extra` (cf. expo-manifests types):
          // `manifest.extra` is the SDK-level `ManifestExtra`, the developer's
          // own `extra` from `app.config.ts` ends up under `.expoClient.extra`.
          const incoming = result.manifest as unknown as {
            extra?: {
              expoClient?: { extra?: { criticalIndex?: unknown } };
            };
          };
          const raw = incoming.extra?.expoClient?.extra?.criticalIndex;
          const incomingCriticalIndex =
            typeof raw === "number" ? raw : undefined;
          setUpdateCheck({ isAvailable: true, incomingCriticalIndex });
        } else {
          setUpdateCheck({ isAvailable: false });
        }
      })
      .catch(() => {
        // Network down / store unreachable — degrade to `isAvailable: false`
        // rather than wedge the splash forever. The native layer still runs.
        if (!cancelled) setUpdateCheck({ isAvailable: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The running bundle's criticalIndex sits in the LOCAL Expo config, which
  // `Constants.expoConfig.extra` exposes at runtime in every environment.
  const runningRaw = Constants.expoConfig?.extra?.criticalIndex;
  const runningCriticalIndex =
    typeof runningRaw === "number" ? runningRaw : undefined;

  // `expo-application` returns a string for iOS `buildNumber` / Android
  // `versionCode` — parse to int. `null` / non-numeric → undefined, the
  // decision function treats that as « unknown, do not block ».
  const rawBuild = Application.nativeBuildVersion;
  const nativeBuildVersion =
    rawBuild === null
      ? undefined
      : Number.isFinite(Number(rawBuild))
        ? Number(rawBuild)
        : undefined;

  const decision = decideForceUpdate({
    env: { isDev: __DEV__, updatesEnabled: Updates.isEnabled },
    runningCriticalIndex,
    nativeBuildVersion,
    minBuildVersion:
      minBuildVersion === undefined ? undefined : minBuildVersion,
    updateCheck,
  });

  // Side effect: trigger the fetch + reload when the verdict says so. Wrapped
  // in `useEffect` so it fires once per resolved verdict, not on every render.
  useEffect(() => {
    if (decision.kind !== "download-and-reload") return;
    if (__DEV__) return; // belt + suspenders — never reload in dev.
    let cancelled = false;
    (async () => {
      try {
        await Updates.fetchUpdateAsync();
        if (cancelled) return;
        await Updates.reloadAsync();
      } catch {
        // If fetch/reload fails, fall back to allowing the app to render
        // anyway — better a degraded UX than a wedged splash. Sentry would
        // surface the error path here when the observability slice lands.
        if (!cancelled) setUpdateCheck({ isAvailable: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [decision.kind]);

  if (decision.kind === "allow") {
    return <>{children}</>;
  }

  if (decision.kind === "block-native-update") {
    return <BlockingNativeUpdateScreen />;
  }

  // `wait` or `download-and-reload` — keep the splash spinner up. For
  // `download-and-reload`, the effect above is running in parallel; the user
  // sees a spinner, then the app reloads on the new bundle.
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#ffffff",
      }}
    >
      <ActivityIndicator />
    </View>
  );
}

/**
 * Red blocking screen — couche native, ADR 0017. Mounted whenever the device's
 * `nativeBuildVersion` is strictly below the Convex-served `minBuildVersion`.
 * No way out: no back button, no skip — only « Mettre à jour » which opens
 * the App Store / Play Store. The text + colour scheme match the KitchenBoost
 * art-direction (red on white) and stay deliberately stark (the message must
 * register in 1 second on a too-old kitchen tablet).
 */
function BlockingNativeUpdateScreen() {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "#B91C1C",
        padding: 24,
      }}
    >
      <Text
        style={{
          color: "#ffffff",
          fontSize: 24,
          fontWeight: "700",
          textAlign: "center",
          marginBottom: 12,
        }}
      >
        Mise à jour requise
      </Text>
      <Text
        style={{
          color: "#ffffff",
          fontSize: 16,
          textAlign: "center",
          marginBottom: 32,
          opacity: 0.9,
        }}
      >
        Cette version de l&apos;application n&apos;est plus prise en charge.
        Mettez à jour KitchenBoost pour continuer.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={openStore}
        style={{
          backgroundColor: "#ffffff",
          paddingHorizontal: 24,
          paddingVertical: 12,
          borderRadius: 8,
        }}
      >
        <Text style={{ color: "#B91C1C", fontWeight: "700", fontSize: 16 }}>
          Mettre à jour
        </Text>
      </Pressable>
    </View>
  );
}
