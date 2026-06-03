import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import {
  decideModeTag,
  decideStatusLabel,
  decideWorkflowButton,
} from "@/lib/orders";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  View,
} from "react-native";

/**
 * #401 — Order detail screen (PRD 20 §4 + §5).
 *
 * Reads one order via `getOrder` (tenant-scoped, `tenantQuery`, ADR 0010):
 * récap items + modifiers + restaurantNote + adresse livraison + status
 * label + mode tag. Surfaces ONE workflow button per state on the happy
 * path (decideWorkflowButton):
 *
 *   nouvelle       → Accepter / Préparer   (acknowledge)
 *   en préparation → Prête                  (markPrepared)
 *   prête          → Remise au coursier     (markHandedOff, delivery)
 *                  OR Remise au client      (markHandedOff, pickup)
 *
 * Terminal states (remise / livrée / collectée / refusée) render no button —
 * the order is in fade-out + archive territory (PRD 20 §5). Pre-payment
 * `en attente de paiement` is unreachable via the home (the live query
 * filters it out) but tolerated here as a discreet read-only view.
 *
 * Tap-to-reveal phone numbers (PRD 20 §4 + AC9) — client + courier numbers
 * are hidden by default and surfaced via a Pressable that flips a local
 * flag. NO CTA "Appeler" (PRD 20 Q4.2 — pas de dialer fiable, gain UX nul,
 * source de bugs cross-OS). For #401 V1: courier number out of scope (the
 * `deliveries` row landing is chantier 2.6); the schema today carries only
 * `address` on the order, so the client phone is exposed via the global
 * customers fiche which a `kb_manager` cannot reach directly per ADR 0010
 * (the MOAT). V1 sticks to address tap-to-reveal as the privacy-bounded
 * surface — phones come in via #403 when the refusal email flow needs
 * them (later slice).
 *
 * Source badge (PRD 20 §2 + Q3.3) — V1 has NO direct badge displayed (all
 * orders are direct in V1 since marketplace ingestion is ADR 0009 V2).
 *
 * Refusal (#403), auto_expired (#404) — out of scope here; the happy path
 * does not surface a "Refuser" button (PRD 20 §6 is its own slice).
 */
export default function OrderDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ orderId: string }>();
  const activeTenantId = useActiveTenantId();
  const orderId = params.orderId as Id<"orders">;

  const detail = useQuery(
    api.lib.orders.orders.getOrder,
    activeTenantId !== null && orderId
      ? { tenantId: activeTenantId, orderId }
      : "skip",
  );

  const acknowledge = useMutation(api.lib.orders.workflow.acknowledge);
  const markPrepared = useMutation(api.lib.orders.workflow.markPrepared);
  const markHandedOff = useMutation(api.lib.orders.workflow.markHandedOff);

  // Tap-to-reveal the delivery address (PRD 20 §4 — same UX rationale as the
  // tap-to-reveal phones the schema doesn't yet expose at the order level).
  const [addressRevealed, setAddressRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  if (activeTenantId === null || detail === undefined) {
    return (
      <View className="bg-background flex-1 items-center justify-center p-6">
        <ActivityIndicator />
      </View>
    );
  }

  if (detail === null) {
    return (
      <View className="bg-background flex-1 items-center justify-center gap-3 p-6">
        <Text className="text-foreground text-base font-semibold">
          Commande introuvable
        </Text>
        <Text className="text-muted-foreground text-center text-sm">
          Cette commande n&apos;existe pas ou n&apos;est plus accessible.
        </Text>
        <Button variant="outline" onPress={() => router.back()}>
          <Text>Retour</Text>
        </Button>
      </View>
    );
  }

  // `getOrder` returns `OrderWithDetail = Doc<"orders"> & { items, events }`
  // (a flat join, not a nested `{ order, items }`). Destructure once for
  // readability.
  const order = detail;
  const items = detail.items;
  const modeTag = decideModeTag(order.mode);
  const statusLabel = decideStatusLabel(order.status);
  const buttonDecision = decideWorkflowButton(order.status, order.mode);
  const totalEuros =
    order.pricingSnapshot !== undefined
      ? (order.pricingSnapshot.total / 100).toFixed(2)
      : null;
  const idTail = (order._id as unknown as string).slice(-4).toUpperCase();

  const onWorkflowPress = async () => {
    if (buttonDecision.kind !== "show" || busy) return;
    setBusy(true);
    try {
      if (buttonDecision.action === "acknowledge") {
        await acknowledge({
          tenantId: activeTenantId,
          orderId: order._id,
        });
      } else if (buttonDecision.action === "markPrepared") {
        await markPrepared({
          tenantId: activeTenantId,
          orderId: order._id,
        });
      } else if (buttonDecision.action === "markHandedOff") {
        await markHandedOff({
          tenantId: activeTenantId,
          orderId: order._id,
        });
      }
    } catch (err) {
      Alert.alert("Erreur", getConvexErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      className="bg-background flex-1"
      contentContainerClassName="p-4 sm:p-6"
    >
      {/* Back nav */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retour"
        onPress={() => router.back()}
        className="mb-3 flex-row items-center gap-1"
      >
        <ChevronLeft size={20} className="text-foreground" />
        <Text className="text-foreground">Retour</Text>
      </Pressable>

      {/* Header */}
      <View className="mb-4 flex-row items-center justify-between">
        <View className="flex-row items-center gap-2">
          <Text className="text-foreground text-xl font-semibold">
            Cmd #{idTail}
          </Text>
        </View>
        {modeTag !== null ? (
          <View
            className="flex-row items-center gap-1 rounded-md bg-secondary px-2 py-1"
            accessibilityLabel={`Mode ${modeTag.label}`}
          >
            <Text className="text-sm">{modeTag.emoji}</Text>
            <Text className="text-foreground text-xs font-semibold">
              {modeTag.label}
            </Text>
          </View>
        ) : null}
      </View>

      <Text className="text-muted-foreground mb-4 text-sm">{statusLabel}</Text>

      {/* Items récap (PRD 20 §4) */}
      <Card className="mb-3">
        <CardHeader>
          <Text className="text-foreground text-base font-semibold">
            Articles
          </Text>
        </CardHeader>
        <CardContent className="gap-3">
          {items.length === 0 ? (
            <Text className="text-muted-foreground text-sm">
              Aucun article.
            </Text>
          ) : (
            items.map((item) => (
              <View key={item._id} className="gap-1">
                <View className="flex-row items-center justify-between">
                  <Text className="text-foreground font-medium">
                    {item.quantity}× {item.itemName}
                  </Text>
                  <Text className="text-foreground text-sm">
                    {((item.unitPrice * item.quantity) / 100).toFixed(2)} €
                  </Text>
                </View>
                {item.modifiers.length > 0 ? (
                  <View className="gap-0.5 pl-3">
                    {item.modifiers.map((m, idx) => (
                      <Text
                        key={`${m.groupName}-${m.optionName}-${idx}`}
                        className="text-muted-foreground text-xs"
                      >
                        • {m.groupName} : {m.optionName}
                        {m.priceDelta !== 0
                          ? ` (${m.priceDelta > 0 ? "+" : ""}${(m.priceDelta / 100).toFixed(2)} €)`
                          : ""}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {item.allergens.length > 0 ? (
                  <Text className="text-muted-foreground pl-3 text-xs italic">
                    Allergènes : {item.allergens.join(", ")}
                  </Text>
                ) : null}
              </View>
            ))
          )}
          {totalEuros !== null ? (
            <View className="flex-row items-center justify-between border-t border-border pt-3">
              <Text className="text-foreground font-semibold">Total</Text>
              <Text className="text-foreground font-semibold">
                {totalEuros} €
              </Text>
            </View>
          ) : null}
        </CardContent>
      </Card>

      {/* Note client (PRD 20 §4) */}
      {order.restaurantNote !== undefined && order.restaurantNote !== "" ? (
        <Card className="mb-3">
          <CardHeader>
            <Text className="text-foreground text-base font-semibold">
              Note du client
            </Text>
          </CardHeader>
          <CardContent>
            <Text className="text-foreground text-sm">
              {order.restaurantNote}
            </Text>
          </CardContent>
        </Card>
      ) : null}

      {/* Adresse livraison — tap-to-reveal (PRD 20 §4) */}
      {order.mode === "delivery" && order.address !== undefined ? (
        <Card className="mb-3">
          <CardHeader>
            <Text className="text-foreground text-base font-semibold">
              Adresse livraison
            </Text>
          </CardHeader>
          <CardContent>
            {addressRevealed ? (
              <Text className="text-foreground text-sm">{order.address}</Text>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Afficher l'adresse de livraison"
                onPress={() => setAddressRevealed(true)}
                className="flex-row items-center gap-2"
              >
                <Ionicons
                  name="eye-outline"
                  size={16}
                  className="text-muted-foreground"
                />
                <Text className="text-muted-foreground text-sm underline">
                  Toucher pour afficher
                </Text>
              </Pressable>
            )}
          </CardContent>
        </Card>
      ) : null}

      {/* Workflow button */}
      {buttonDecision.kind === "show" ? (
        <Button
          size="lg"
          onPress={onWorkflowPress}
          disabled={busy}
          accessibilityLabel={buttonDecision.label}
        >
          {busy ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-primary-foreground font-semibold">
              {buttonDecision.label}
            </Text>
          )}
        </Button>
      ) : (
        <View className="items-center gap-1 py-4">
          <Text className="text-muted-foreground text-center text-sm">
            Cette commande est terminée.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
