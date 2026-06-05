import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";
import {
  buildStarWebPrntTestTicket,
  decidePrinterConfigForm,
  normaliseStarWebPrntUrl,
} from "./decide-star-printer";
import { sendStarWebPrntTicket } from "./print-order";

/**
 * #412 — « Imprimante cuisine » Settings screen (PRD 20 §14 + §10).
 *
 * The Settings page #418 is its own larger story; this screen pins the
 * IMPRIMANTE section the PRD demands as part of #412. The gérant:
 *
 *  1. types / pastes the Star WebPRNT URL (the printer's web UI advertises
 *     it, often `http://<dhcp-assigned-ip>/StarWebPRNT/SendMessage`);
 *  2. taps « Enregistrer » to persist via `setPrinterConfig`;
 *  3. taps « Tester l'impression » to POST a test ticket via
 *     `sendStarWebPrntTicket` against the LAN — verifies the URL works
 *     BEFORE waiting for a real cmd;
 *  4. optionally taps « Retirer l'imprimante » to clear the URL (auto-
 *     print becomes a no-op).
 *
 * The active tenant's `name` powers the test ticket header so the gérant
 * sees their own resto name on the printout. The decision matrix (canSubmit
 * / canTest / displayUrl / error) lives PURE in `decidePrinterConfigForm`
 * — pinned by `decide-star-printer.test.ts`.
 */
export function PrinterSettingsScreen(): React.ReactElement {
  const router = useRouter();
  const tenantId = useActiveTenantId();

  const config = useQuery(
    api.lib.printing.printing.getPrinterConfig,
    tenantId !== null ? { tenantId } : "skip",
  );
  // The active tenant's name is sourced from the same #411 health probe the
  // banner / gate consume — it is OPERATIONAL_ALLOW, so the kitchen tablet
  // under audit monolithique V1 reads it. We only need the name for the test
  // ticket header; failing back to a neutral "Restaurant" if it ever fails.
  const tenantHealth = useQuery(
    api.lib.orders.orders.getTenantHealth,
    tenantId !== null ? { tenantId } : "skip",
  );
  // The tenant name doesn't live on `getTenantHealth` (which exposes only the
  // Stripe / Uber / lifecycle slice). For the test ticket header we resolve
  // it via `currentUser` joined with the active tenant attachment — but to
  // keep this screen minimal V1, we fall back to a neutral label and let the
  // gérant see « TEST IMPRESSION » + their printer's URL = enough signal.
  void tenantHealth;

  const setMutation = useMutation(api.lib.printing.printing.setPrinterConfig);
  const clearMutation = useMutation(
    api.lib.printing.printing.clearPrinterConfig,
  );

  const [input, setInput] = useState("");
  const [savingState, setSavingState] = useState<
    "idle" | "saving" | "testing" | "clearing"
  >("idle");
  const [feedback, setFeedback] = useState<
    { kind: "ok"; message: string } | { kind: "error"; message: string } | null
  >(null);

  // Hydrate the input from the loaded config once. We do this in an effect
  // (rather than as a derived value) so the gérant can edit the field
  // without each Convex sub tick overwriting their typing.
  useEffect(() => {
    if (config === undefined) return;
    if (config === null) return;
    setInput((prev) => (prev === "" ? config.starWebPrntUrl : prev));
  }, [config]);

  if (tenantId === null || config === undefined) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <ActivityIndicator />
      </View>
    );
  }

  const decision = decidePrinterConfigForm({
    input,
    currentUrl: config?.starWebPrntUrl ?? null,
  });

  const onSave = async () => {
    if (!decision.canSubmit || savingState !== "idle") return;
    setSavingState("saving");
    setFeedback(null);
    try {
      await setMutation({ tenantId, starWebPrntUrl: decision.displayUrl });
      setFeedback({
        kind: "ok",
        message: "URL imprimante enregistrée.",
      });
    } catch (err) {
      setFeedback({ kind: "error", message: getConvexErrorMessage(err) });
    } finally {
      setSavingState("idle");
    }
  };

  const onTest = async () => {
    if (!decision.canTest || savingState !== "idle") return;
    setSavingState("testing");
    setFeedback(null);
    try {
      const ticket = buildStarWebPrntTestTicket("Restaurant");
      const verdict = await sendStarWebPrntTicket({
        url: decision.displayUrl,
        ticket,
        timeoutMs: 5_000,
      });
      if (verdict.kind === "ok") {
        setFeedback({
          kind: "ok",
          message: "Ticket de test envoyé — vérifie l'imprimante.",
        });
      } else {
        setFeedback({
          kind: "error",
          message:
            "Impression échouée — vérifie l'imprimante (alimentation, réseau, IP).",
        });
      }
    } catch (err) {
      setFeedback({
        kind: "error",
        message: err instanceof Error ? err.message : "Erreur inconnue.",
      });
    } finally {
      setSavingState("idle");
    }
  };

  const onClear = () => {
    if (config === null || savingState !== "idle") return;
    Alert.alert(
      "Retirer l'imprimante",
      "Plus aucune impression ne sera envoyée — l'app reste fonctionnelle.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Retirer",
          style: "destructive",
          onPress: async () => {
            setSavingState("clearing");
            try {
              await clearMutation({ tenantId });
              setInput("");
              setFeedback({
                kind: "ok",
                message: "Imprimante retirée.",
              });
            } catch (err) {
              setFeedback({
                kind: "error",
                message: getConvexErrorMessage(err),
              });
            } finally {
              setSavingState("idle");
            }
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="p-4 sm:p-6 gap-4"
      keyboardShouldPersistTaps="handled"
    >
      <Card>
        <CardHeader>
          <View className="flex-row items-center gap-2">
            <Ionicons name="print-outline" size={20} color="#444" />
            <Text className="text-foreground text-base font-semibold">
              Imprimante cuisine Star WebPRNT
            </Text>
          </View>
        </CardHeader>
        <CardContent className="gap-4">
          <Text className="text-muted-foreground text-sm">
            Adresse HTTP de l&apos;imprimante sur ton réseau cuisine. Format
            attendu : http://192.168.1.42/StarWebPRNT/SendMessage. Visible dans
            la page web de l&apos;imprimante.
          </Text>

          <View className="gap-2">
            <Text className="text-foreground text-sm font-medium">
              Adresse imprimante
            </Text>
            <Input
              accessibilityLabel="Adresse de l'imprimante"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="http://192.168.1.42/StarWebPRNT/SendMessage"
              value={input}
              onChangeText={(v) => {
                setInput(v);
                setFeedback(null);
              }}
              onBlur={() => setInput(normaliseStarWebPrntUrl(input))}
              editable={savingState === "idle"}
            />
            {decision.error !== null ? (
              <Text className="text-destructive text-xs">{decision.error}</Text>
            ) : (
              <Text className="text-muted-foreground text-xs">
                Vérifié côté client ET côté serveur (PRD 20 §14).
              </Text>
            )}
          </View>

          <View className="gap-2">
            <Button
              onPress={onSave}
              disabled={!decision.canSubmit || savingState !== "idle"}
              accessibilityLabel="Enregistrer l'adresse de l'imprimante"
            >
              {savingState === "saving" ? (
                <ActivityIndicator />
              ) : (
                <>
                  <Ionicons name="save-outline" size={18} color="white" />
                  <Text className="text-primary-foreground font-semibold">
                    Enregistrer
                  </Text>
                </>
              )}
            </Button>
            <Button
              variant="outline"
              onPress={onTest}
              disabled={!decision.canTest || savingState !== "idle"}
              accessibilityLabel="Tester l'impression"
            >
              {savingState === "testing" ? (
                <ActivityIndicator />
              ) : (
                <>
                  <Ionicons name="print-outline" size={18} color="#111111" />
                  <Text>Tester l&apos;impression</Text>
                </>
              )}
            </Button>
            {config !== null ? (
              // Action NÉGATIVE — retrait config imprimante = rouge destructive.
              // Icône poubelle = suppression / retrait, reconnaissable.
              <Button
                variant="destructive"
                onPress={onClear}
                disabled={savingState !== "idle"}
                accessibilityLabel="Retirer l'imprimante"
              >
                {savingState === "clearing" ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={18} color="white" />
                    <Text className="text-destructive-foreground font-semibold">
                      Retirer l&apos;imprimante
                    </Text>
                  </>
                )}
              </Button>
            ) : null}
          </View>

          {feedback !== null ? (
            <View
              className={
                feedback.kind === "ok"
                  ? "rounded-lg border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-700 dark:bg-emerald-950/30"
                  : "rounded-lg border border-rose-300 bg-rose-50 p-3 dark:border-rose-700 dark:bg-rose-950/30"
              }
              accessibilityLiveRegion="polite"
            >
              <Text
                className={
                  feedback.kind === "ok"
                    ? "text-emerald-800 dark:text-emerald-200"
                    : "text-rose-800 dark:text-rose-200"
                }
              >
                {feedback.message}
              </Text>
            </View>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Text className="text-foreground text-base font-semibold">
            Comment ça marche
          </Text>
        </CardHeader>
        <CardContent className="gap-2">
          <Text className="text-muted-foreground text-sm">
            • Auto-impression dès qu&apos;une cmd est acceptée (nouvelle → en
            préparation).
          </Text>
          <Text className="text-muted-foreground text-sm">
            • Bouton « Réimprimer » sur le détail d&apos;une cmd si le ticket
            est mal sorti ou tombé.
          </Text>
          <Text className="text-muted-foreground text-sm">
            • Si l&apos;imprimante est hors ligne, l&apos;app reste
            fonctionnelle — tu peux lire la cmd à l&apos;écran et réimprimer
            plus tard.
          </Text>
        </CardContent>
      </Card>

      <Button
        variant="outline"
        onPress={() => router.back()}
        accessibilityLabel="Retour"
      >
        <Ionicons name="arrow-back-outline" size={18} color="#111111" />
        <Text>Retour</Text>
      </Button>
    </ScrollView>
  );
}
