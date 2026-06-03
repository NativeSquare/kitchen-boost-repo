import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useDeviceId } from "@/hooks/use-device-id";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation } from "convex/react";
import * as Linking from "expo-linking";
import { PermissionStatus } from "expo-modules-core";
import * as Notifications from "expo-notifications";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  View,
} from "react-native";
import {
  decideOnboardingStep,
  type OnboardingPushStatus,
} from "./decide-onboarding-step";

/**
 * #398 — Post-login onboarding sequence (PRD 20 §1a steps 2 → 4 → 5).
 *
 * Mounted by `(onboarding)/index.tsx` AFTER `(device-setup)` (#393, step 3)
 * has set `device.mode` and BEFORE `(app)` (step 5). The thin adapter is
 * responsible for THREE things only — the branching itself lives in the
 * pure `decideOnboardingStep`:
 *
 *  - **Resolve the OS push permission status** at mount + on every foreground
 *    return via `AppState`-style refresh after the rationale CTA (same idiom
 *    as `PushPermissionBanner` #395), then pass it to the decision function.
 *
 *  - **Persist the per-item « J'ai fait » acknowledgements** in `useState`.
 *    These are NOT programmatically validated (PRD 20 §1a step 4 acceptance:
 *    « non-validation programmatique, juste guide UX »).
 *
 *  - **Fire `markOnboardingCompleted`** once the verdict flips to
 *    `completing`. Convex `getMyDevice` then refreshes with
 *    `onboardingCompleted: true` and the root layout `_layout.tsx` rebases
 *    onto `(app)` automatically (no `router.replace` needed — the gate
 *    re-evaluates on every Convex query refresh).
 *
 * The function deliberately does NOT block the user when the OS push is
 * denied. The persistent red banner (#395) already surfaces that failure on
 * every `(app)` route, and Alex acted in PRD 20 §1a step 4 that the checklist
 * is « plus important que les push ».
 */
export function OnboardingFlow() {
  const deviceId = useDeviceId();
  const markCompleted = useMutation(
    api.lib.devices.devices.markOnboardingCompleted,
  );

  // OS-level push permission status. `undefined` while
  // `Notifications.getPermissionsAsync()` is in flight; the decision function
  // maps that to `loading` (splash).
  const [pushStatus, setPushStatus] = useState<
    OnboardingPushStatus | undefined
  >(undefined);

  // Soft latch: have we already called `requestPermissionsAsync()` once in this
  // onboarding run? Necessary because on iOS a dismissed prompt leaves status
  // as `undetermined`, which would otherwise loop us on the rationale screen.
  const [pushAsked, setPushAsked] = useState(false);

  // « J'ai fait » per-item acks (PRD 20 §1a step 4).
  const [volumeAck, setVolumeAck] = useState(false);
  const [sleepAck, setSleepAck] = useState(false);

  // Resolve the OS permission status once at mount. The rationale CTA path
  // updates the status synchronously after `requestPermissionsAsync()` so we
  // don't need an `AppState` listener here (unlike the banner #395 which has
  // to react to settings-app flips).
  useEffect(() => {
    let cancelled = false;
    Notifications.getPermissionsAsync()
      .then((result) => {
        if (cancelled) return;
        setPushStatus(mapStatus(result.status));
      })
      .catch(() => {
        // Native module unavailable — degrade to `undetermined` so the prompt
        // step still shows (better than wedging on `loading`).
        if (!cancelled) setPushStatus("undetermined");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const step = decideOnboardingStep({
    pushStatus,
    pushAsked,
    volumeAck,
    sleepAck,
  });

  // Fire-and-forget the Convex mutation when we land on `completing`. Wrapped
  // in `useEffect` so it fires once per resolved verdict, not on every render.
  // The native splash spinner stays up until the root layout `_layout.tsx`
  // re-evaluates the gate from the new `device.onboardingCompleted`.
  useEffect(() => {
    if (step !== "completing") return;
    if (deviceId === null) return;
    let cancelled = false;
    void markCompleted({ deviceId }).catch((err) => {
      if (cancelled) return;
      // Surface the error but DO NOT block — re-render the checklist with
      // both acks intact; the user can tap again. Same idempotency contract
      // as `setMyDeviceMode` (upsert).
      Alert.alert("Erreur", getConvexErrorMessage(err));
    });
    return () => {
      cancelled = true;
    };
  }, [step, deviceId, markCompleted]);

  if (step === "loading" || step === "completing") {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator />
      </View>
    );
  }

  if (step === "push-prompt") {
    return (
      <PushPromptScreen
        onAsk={async () => {
          try {
            const result = await Notifications.requestPermissionsAsync();
            setPushStatus(mapStatus(result.status));
          } catch {
            // Same degraded fallback as the getter: pretend we asked, let the
            // checklist surface. The persistent banner #395 will nag from the
            // (app) shell.
            setPushStatus("undetermined");
          } finally {
            // Latch flips REGARDLESS of the OS response — if the user dismissed,
            // the next render must NOT loop the rationale.
            setPushAsked(true);
          }
        }}
        onSkip={() => {
          // « Plus tard » — flip the latch and let the checklist take over.
          // The banner #395 will resurface the prompt CTA from (app).
          setPushAsked(true);
        }}
      />
    );
  }

  // `checklist`
  return (
    <ChecklistScreen
      volumeAck={volumeAck}
      sleepAck={sleepAck}
      onAckVolume={() => setVolumeAck(true)}
      onAckSleep={() => setSleepAck(true)}
    />
  );
}

function mapStatus(raw: PermissionStatus | string): OnboardingPushStatus {
  // Same mapper as `push-permission-banner` but returns a guaranteed value
  // (never `undefined` — once `getPermissionsAsync()` resolves we have a
  // status, and unknown vendor strings fall through to `undetermined` so the
  // rationale still surfaces).
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
      return "undetermined";
  }
}

/**
 * Step 2 — push permission rationale (PRD 20 §1a step 2).
 *
 * The rationale itself is the key UX bet: we ONLY surface the OS prompt after
 * the user has read « KB Orders a besoin des notifs pour ne pas rater une
 * commande » and tapped « Activer ». An immediate iOS prompt at splash would
 * push too many users to refuse (and a refusal is permanent without a trip to
 * Settings).
 */
function PushPromptScreen({
  onAsk,
  onSkip,
}: {
  onAsk: () => void | Promise<void>;
  onSkip: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1 }}
      contentContainerClassName="my-safe px-4 pb-8"
    >
      <View className="w-full max-w-md self-center flex-1 gap-8 pt-8">
        <View className="gap-3">
          <Text variant="h2" className="text-foreground">
            Active les notifications
          </Text>
          <Text className="text-muted-foreground">
            KB Orders a besoin des notifs pour ne pas rater une commande —
            active-les.
          </Text>
        </View>

        <View className="flex-1" />

        <View className="gap-3">
          <Button
            onPress={async () => {
              if (busy) return;
              setBusy(true);
              try {
                await onAsk();
              } finally {
                setBusy(false);
              }
            }}
            disabled={busy}
            className="py-6"
          >
            <Text className="text-primary-foreground text-base">
              {busy ? "Demande en cours…" : "Activer les notifications"}
            </Text>
          </Button>
          <Button
            variant="ghost"
            onPress={onSkip}
            disabled={busy}
            className="py-6"
          >
            <Text className="text-foreground">Plus tard</Text>
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}

/**
 * Step 4 — checklist réglages device (PRD 20 §1a step 4).
 *
 * Two manual items, one « J'ai fait » button each. The « Ouvrir réglages »
 * link below the sleep item deeplinks to the OS settings (best-effort —
 * `Linking.openSettings()` opens the app-scoped settings page; deeper paths
 * to Display / Auto-Lock are not deeplinkable on iOS, the user has to scroll
 * manually). On Android the same call lands in app info.
 */
function ChecklistScreen({
  volumeAck,
  sleepAck,
  onAckVolume,
  onAckSleep,
}: {
  volumeAck: boolean;
  sleepAck: boolean;
  onAckVolume: () => void;
  onAckSleep: () => void;
}) {
  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1 }}
      contentContainerClassName="my-safe px-4 pb-8"
    >
      <View className="w-full max-w-md self-center flex-1 gap-8 pt-8">
        <View className="gap-3">
          <Text variant="h2" className="text-foreground">
            Deux réglages essentiels
          </Text>
          <Text className="text-muted-foreground">
            On ne peut pas les régler à ta place — fais-les maintenant pour ne
            jamais rater une commande.
          </Text>
        </View>

        <View className="gap-4">
          <ChecklistItem
            title="Mets le volume à fond"
            description="Les boutons physiques du device, jusqu'à la sonnerie max — c'est le bip qui prévient en cuisine."
            done={volumeAck}
            onDone={onAckVolume}
          />
          <ChecklistItem
            title="Désactive la mise en veille"
            description={sleepInstruction()}
            done={sleepAck}
            onDone={onAckSleep}
            extraCta={
              <Button
                variant="outline"
                onPress={() => {
                  Linking.openSettings().catch(() => {});
                }}
              >
                <Text className="text-foreground">Ouvrir les réglages</Text>
              </Button>
            }
          />
        </View>

        <View className="flex-1" />
      </View>
    </ScrollView>
  );
}

function ChecklistItem({
  title,
  description,
  done,
  onDone,
  extraCta,
}: {
  title: string;
  description: string;
  done: boolean;
  onDone: () => void;
  extraCta?: React.ReactNode;
}) {
  return (
    <View className="rounded-lg border border-border bg-card p-4 gap-3">
      <View className="gap-1">
        <Text className="text-foreground text-base font-semibold">
          {done ? "✓ " : ""}
          {title}
        </Text>
        <Text className="text-muted-foreground text-sm">{description}</Text>
      </View>
      {extraCta}
      <Button
        onPress={onDone}
        disabled={done}
        variant={done ? "outline" : "default"}
      >
        <Text className={done ? "text-foreground" : "text-primary-foreground"}>
          {done ? "Fait" : "J'ai fait"}
        </Text>
      </Button>
    </View>
  );
}

/**
 * OS-specific instruction for « Écran toujours allumé ». No programmatic
 * deeplink to the exact toggle exists on either platform (iOS Auto-Lock lives
 * under Settings → Display & Brightness → Auto-Lock; Android Sleep under
 * Settings → Display → Screen timeout, vendor-skinned), so we describe the
 * path and surface the generic "Open Settings" CTA above.
 */
function sleepInstruction(): string {
  if (Platform.OS === "ios") {
    return "Réglages → Luminosité et affichage → Verrouillage auto → Jamais.";
  }
  if (Platform.OS === "android") {
    return "Paramètres → Affichage → Délai de mise en veille → Maximum.";
  }
  return "Désactive la mise en veille de l'écran dans les réglages système.";
}
