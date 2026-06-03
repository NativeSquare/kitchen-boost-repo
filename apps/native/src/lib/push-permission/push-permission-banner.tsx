import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { PermissionStatus } from "expo-modules-core";
import { useEffect, useState } from "react";
import { AppState, Pressable, Text, View } from "react-native";
import {
  decidePushPermissionBanner,
  type PushPermissionStatus,
} from "./decide-push-permission-banner";

/**
 * #395 — OS push permission banner (PRD 20 §3 « Notifications push système » +
 * §13 « Fiabilité réception » + §15 edge case « push refusé au niveau OS »).
 *
 * Mounted INSIDE the `(app)` layout so it overlays every authenticated route
 * (acceptance criteria: « banner rouge sticky en haut de toutes les routes
 * (app) »). Persists until the user accepts the permission — the disappearance
 * is automatic when the user returns to the app after granting the OS-level
 * switch.
 *
 * Three things kept deliberately thin (the branching itself lives in the pure
 * `decidePushPermissionBanner`):
 *  - we resolve the OS permission status in a mount effect (+ refresh on
 *    foreground return via `AppState`, so flipping the switch in Settings and
 *    coming back makes the banner vanish without a manual reload),
 *  - we pass it to `decidePushPermissionBanner`,
 *  - we render the red sticky banner or nothing.
 *
 * The deeplink to the system Settings uses `Linking.openSettings()` from
 * `expo-linking`, which forwards to `RNLinking.openSettings()` on iOS and
 * Android (pinned to the app's own settings page on both platforms).
 *
 * `undetermined` deliberately does NOT show the banner — that is the job of
 * the onboarding sequence TB-2 (#398, PRD 20 §1a step 2) which asks for the
 * permission with custom rationale. Surfacing a red "Notifs désactivées"
 * banner to a user who has not been prompted yet would mis-signal denial.
 */

export function PushPermissionBanner() {
  const [status, setStatus] = useState<PushPermissionStatus | undefined>(
    undefined,
  );

  // Resolve the OS permission status at mount, and re-resolve every time the
  // app returns to foreground — that is the canonical pattern to detect a
  // settings flip ("Ouvrir réglages" → toggle → swipe back to the app).
  useEffect(() => {
    let cancelled = false;

    const refresh = () => {
      Notifications.getPermissionsAsync()
        .then((result) => {
          if (cancelled) return;
          setStatus(mapStatus(result.status));
        })
        .catch(() => {
          // Native module unavailable (e.g. in a stripped-down Expo Go build
          // before the dev client lands) — degrade silently, never wedge the
          // UI. The banner stays hidden, which is the safer fallback than a
          // permanent red banner on top of every route.
          if (!cancelled) setStatus(undefined);
        });
    };

    refresh();
    const sub = AppState.addEventListener("change", (next) => {
      // Only refresh on the transition back to `active` — refreshing while
      // backgrounding fires a redundant getter just before the OS pauses the
      // app, with no benefit.
      if (next === "active") refresh();
    });

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  const decision = decidePushPermissionBanner({ status });

  if (decision === "hidden") return null;

  return (
    <View
      // Sticky red banner above ALL `(app)` routes — the layout positions
      // `<Stack>` BELOW this component, so the banner does not scroll.
      accessibilityRole="alert"
      style={{
        backgroundColor: "#B91C1C",
        paddingHorizontal: 16,
        paddingVertical: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <Text
        // PRD 20 §3 « Notifs désactivées — tu vas rater des commandes » — exact
        // wording from the issue body.
        style={{
          color: "#ffffff",
          fontSize: 14,
          fontWeight: "600",
          flex: 1,
        }}
      >
        Notifs désactivées — tu vas rater des commandes
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ouvrir les réglages de notifications"
        onPress={openSettings}
        style={{
          backgroundColor: "#ffffff",
          paddingHorizontal: 12,
          paddingVertical: 6,
          borderRadius: 6,
        }}
      >
        <Text style={{ color: "#B91C1C", fontWeight: "700", fontSize: 13 }}>
          Ouvrir réglages
        </Text>
      </Pressable>
    </View>
  );
}

function mapStatus(
  raw: PermissionStatus | string,
): PushPermissionStatus | undefined {
  // `expo-notifications` returns the `PermissionStatus` enum; map it to the
  // pure decision-function string union. Anything we don't recognise becomes
  // `undefined` (treated as "pending" by the decision function — hidden).
  switch (raw) {
    case PermissionStatus.GRANTED:
    case "granted":
      return "granted";
    case PermissionStatus.DENIED:
    case "denied":
      return "denied";
    case PermissionStatus.UNDETERMINED:
    case "undetermined":
      return "undetermined";
    default:
      return undefined;
  }
}

function openSettings() {
  // `expo-linking` `openSettings` opens the app-scoped settings page on iOS
  // and Android. If it ever throws (older OS, native module unavailable), we
  // swallow — the banner remains, the user can still flip the switch via the
  // Settings app manually.
  Linking.openSettings().catch(() => {});
}
