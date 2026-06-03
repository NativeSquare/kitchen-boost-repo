import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useDeviceId } from "@/hooks/use-device-id";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import React from "react";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";

/**
 * #393 — Mode kiosque toggle au premier login (PRD 20 §1a step 3, §12).
 *
 * « Cette tablette sera dédiée à la cuisine ? Oui / Non ». La décision est
 * persistante côté device (`device.mode`) ET côté Convex (la mutation
 * `setMyDeviceMode` enregistre `mode + pinnedTenantId` pour la paire
 * `(userId, deviceId)`). Pas d'auto-détection par form factor — Khan peut
 * vouloir un grand téléphone en cuisine ou une tablette en mobilité
 * (PRD 20 §12).
 *
 * Branches :
 *
 *  - **Téléphone** : `setMyDeviceMode({ mode: "telephone" })`. Pas de pin,
 *    switcher tenant visible plus tard (#399 lira ce champ).
 *  - **Kiosque** : on demande quel tenant pinner via la liste `getSession`
 *    (les tenants attachés à l'utilisateur). Si un seul tenant accessible, on
 *    pin automatiquement sans demander. Si l'utilisateur est `kb_admin`
 *    (root, pas de `userTenants` exposé via getSession), on bascule en mode
 *    téléphone par défaut — l'admin règle ses pins via KB Admin web.
 *
 * Le re-routage est géré par le gate dans `_layout.tsx` racine : une fois la
 * mutation passée, `useQuery(getMyDevice)` se rafraîchit en temps réel et le
 * stack rebascule vers `(onboarding)` ou `(app)`.
 */
export default function DeviceSetupScreen() {
  const deviceId = useDeviceId();
  const session = useQuery(api.lib.auth.getSession.getSession);
  const setMode = useMutation(api.lib.devices.devices.setMyDeviceMode);
  const [submitting, setSubmitting] = React.useState<
    "telephone" | "kiosque" | null
  >(null);
  const [chosenTenantId, setChosenTenantId] =
    React.useState<Id<"tenants"> | null>(null);
  const [stage, setStage] = React.useState<"choose-mode" | "pick-tenant">(
    "choose-mode",
  );

  const tenants = session?.tenants ?? [];
  const isAdmin = session?.isAdmin ?? false;
  const ready = deviceId !== null && session !== undefined;

  const handleTelephone = async () => {
    if (!deviceId) return;
    setSubmitting("telephone");
    try {
      await setMode({ deviceId, mode: "telephone" });
    } catch (err) {
      Alert.alert("Erreur", getConvexErrorMessage(err));
      setSubmitting(null);
    }
  };

  const handleKiosque = async (pinnedTenantId: Id<"tenants">) => {
    if (!deviceId) return;
    setSubmitting("kiosque");
    try {
      await setMode({ deviceId, mode: "kiosque", pinnedTenantId });
    } catch (err) {
      Alert.alert("Erreur", getConvexErrorMessage(err));
      setSubmitting(null);
    }
  };

  const onPressKiosque = () => {
    if (isAdmin) {
      // kb_admin (root) n'a pas de userTenants — pas de pin V1 depuis l'app.
      // L'admin règle ses pins côté KB Admin web.
      Alert.alert(
        "Mode kiosque indisponible pour KB Admin",
        "L'admin règle son pin de cuisine depuis KB Admin web. La tablette repasse en mode téléphone.",
        [{ text: "OK", onPress: () => void handleTelephone() }],
      );
      return;
    }
    if (tenants.length === 0) {
      // Aucun tenant rattaché — mode kiosque non-sens. Forcer téléphone.
      Alert.alert(
        "Aucun restaurant rattaché",
        "Tu n'es pas encore rattaché à un restaurant — bascule en mode téléphone le temps que KB t'attache.",
        [{ text: "OK", onPress: () => void handleTelephone() }],
      );
      return;
    }
    if (tenants.length === 1) {
      void handleKiosque(tenants[0].tenantId);
      return;
    }
    // N tenants : on demande lequel pinner.
    setChosenTenantId(tenants[0].tenantId);
    setStage("pick-tenant");
  };

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    );
  }

  if (stage === "pick-tenant") {
    return (
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1 }}
        contentContainerClassName="my-safe px-4 pb-8"
      >
        <View className="w-full max-w-md self-center flex-1 gap-8 pt-8">
          <View className="gap-3">
            <Text variant="h2" className="text-foreground">
              Pour quel restaurant ?
            </Text>
            <Text className="text-muted-foreground">
              Cette tablette restera dédiée à ce restaurant. Le sélecteur sera
              masqué pour éviter les confusions en cuisine.
            </Text>
          </View>

          <View className="gap-3">
            {tenants.map((t) => {
              const isChosen = t.tenantId === chosenTenantId;
              return (
                <Button
                  key={t.tenantId}
                  variant={isChosen ? "default" : "outline"}
                  onPress={() => setChosenTenantId(t.tenantId)}
                  className="justify-start py-6"
                >
                  <Text
                    className={
                      isChosen ? "text-primary-foreground" : "text-foreground"
                    }
                  >
                    {t.name}
                  </Text>
                </Button>
              );
            })}
          </View>

          <View className="flex-1" />

          <View className="gap-3">
            <Button
              onPress={() => {
                if (chosenTenantId !== null) void handleKiosque(chosenTenantId);
              }}
              disabled={submitting !== null || chosenTenantId === null}
            >
              <Text className="text-primary-foreground">
                {submitting === "kiosque"
                  ? "Enregistrement…"
                  : "Pinner ce restaurant"}
              </Text>
            </Button>
            <Button
              variant="ghost"
              onPress={() => setStage("choose-mode")}
              disabled={submitting !== null}
            >
              <Text>Retour</Text>
            </Button>
          </View>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={{ flexGrow: 1 }}
      contentContainerClassName="my-safe px-4 pb-8"
    >
      <View className="w-full max-w-md self-center flex-1 gap-8 pt-8">
        <View className="gap-3">
          <Text variant="h2" className="text-foreground">
            Cette tablette sera dédiée à la cuisine ?
          </Text>
          <Text className="text-muted-foreground">
            En mode cuisine, le sélecteur de restaurant est masqué et
            l&apos;écran reste allumé pour que tu ne rates pas une commande.
          </Text>
        </View>

        <View className="flex-1" />

        <View className="gap-3">
          <Button
            onPress={onPressKiosque}
            disabled={submitting !== null}
            className="py-6"
          >
            <Text className="text-primary-foreground text-base">
              {submitting === "kiosque"
                ? "Enregistrement…"
                : "Oui — mode cuisine"}
            </Text>
          </Button>
          <Button
            variant="outline"
            onPress={handleTelephone}
            disabled={submitting !== null}
            className="py-6"
          >
            <Text className="text-foreground text-base">
              {submitting === "telephone"
                ? "Enregistrement…"
                : "Non — mode téléphone"}
            </Text>
          </Button>
        </View>
      </View>
    </ScrollView>
  );
}
