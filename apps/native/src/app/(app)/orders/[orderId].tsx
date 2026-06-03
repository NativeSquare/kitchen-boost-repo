import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { cn } from "@/lib/utils";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import {
  RefuseDialog,
  decideModeTag,
  decidePickupHandoffNote,
  decideRefuseButton,
  decideStatusLabel,
  decideWorkflowButton,
  type RefusalReason,
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
  const refuse = useMutation(api.lib.orders.workflow.refuse);

  // Tap-to-reveal the delivery address (PRD 20 §4 — same UX rationale as the
  // tap-to-reveal phones the schema doesn't yet expose at the order level).
  const [addressRevealed, setAddressRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  // #403 — local visibility flag for the 2-step Refuser dialog. The dialog's
  // internal 2-step state (motif → confirm) is owned by `RefuseDialog` via
  // its own `refuseFlowReducer`; this screen only toggles the dialog's
  // mount/visibility and surfaces the busy state of the refuse mutation.
  const [refuseDialogOpen, setRefuseDialogOpen] = useState(false);
  const [refusing, setRefusing] = useState(false);

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
  const refuseButton = decideRefuseButton(order.status);
  const pickupNote = decidePickupHandoffNote(order.mode);
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

  // #403 — fire the refuse mutation after the dialog's Step 2 confirmation.
  // The dialog closes itself BEFORE this resolves (so a double-tap can't
  // queue a second refund); we only flip `refusing` so the Confirm button
  // shows a spinner if the network is slow. The backend handles atomicity
  // (transition `nouvelle → refusée` + queue `refund_issued` notif + schedule
  // the Stripe refund action — all in one Convex transaction), so on success
  // the order falls out of the live `tenantOrders` query and the home archives
  // it immediately. On error we surface the Convex message; the order stays
  // `nouvelle` so the cuisinier can retry.
  const onRefuseConfirm = async (reason: RefusalReason) => {
    if (refusing) return;
    setRefusing(true);
    try {
      await refuse({
        tenantId: activeTenantId,
        orderId: order._id,
        reason,
      });
      // The order is now `refusée` — pop the screen so the kiosque returns to
      // the home (the refused order is filtered out of the live queue and
      // surfaces in the history #417, not on the home).
      router.back();
    } catch (err) {
      Alert.alert("Erreur", getConvexErrorMessage(err));
    } finally {
      setRefusing(false);
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
            className={cn(
              "flex-row items-center gap-1 rounded-md px-2 py-1",
              // #402 — discriminate the tag chip color by mode, mirroring the
              // home card (`order-card.tsx`). Click & collect = `bg-muted` so
              // the tablet glance distinguishes a mixed-mode home from the
              // detail at a glance.
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

      {/* À emporter — handoff note for click & collect (PRD 20 §4 « note "à
          emporter" (si click & collect) »). Mirror placement of the delivery
          address card so the cuisinier reads the handoff target at the same
          spot regardless of mode. No customer name (MOAT, ADR 0010) and no
          pickup time (not in schema today, not asked by PRD 20 §4). */}
      {pickupNote.kind === "show" ? (
        <Card className="mb-3" testID="pickup-handoff-note">
          <CardHeader>
            <Text className="text-foreground text-base font-semibold">
              {pickupNote.heading}
            </Text>
          </CardHeader>
          <CardContent>
            <Text className="text-foreground text-sm">{pickupNote.body}</Text>
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

      {/* Workflow buttons — primary (Accepter / Prête / Remise) + the #403
          secondary "Refuser" button when applicable (PRD 20 §6a: only from
          `nouvelle`). Both buttons live side by side on `nouvelle` so the
          cuisinier reads the binary choice (accept vs refuse) at a glance;
          on later states the Refuser button is hidden and only the primary
          workflow button is rendered. */}
      {buttonDecision.kind === "show" ? (
        <View className="flex-row items-center gap-2">
          {refuseButton.kind === "show" ? (
            <Button
              size="lg"
              variant="outline"
              onPress={() => setRefuseDialogOpen(true)}
              disabled={busy || refusing}
              accessibilityLabel={refuseButton.label}
              className="flex-1"
            >
              <Text className="font-semibold">{refuseButton.label}</Text>
            </Button>
          ) : null}
          <Button
            size="lg"
            onPress={onWorkflowPress}
            disabled={busy || refusing}
            accessibilityLabel={buttonDecision.label}
            className="flex-1"
          >
            {busy ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text className="text-primary-foreground font-semibold">
                {buttonDecision.label}
              </Text>
            )}
          </Button>
        </View>
      ) : (
        <View className="items-center gap-1 py-4">
          <Text className="text-muted-foreground text-center text-sm">
            Cette commande est terminée.
          </Text>
        </View>
      )}

      {/* #403 — 2-step Refusal dialog (PRD 20 §6a). The dialog's internal
          2-step state machine lives in `refuse-dialog.tsx`; this screen owns
          the mutation + the busy state + the navigation after success. */}
      <RefuseDialog
        open={refuseDialogOpen}
        busy={refusing}
        onClose={() => setRefuseDialogOpen(false)}
        onConfirm={onRefuseConfirm}
      />
    </ScrollView>
  );
}
