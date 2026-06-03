import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import { Ionicons } from "@expo/vector-icons";
import type { Doc } from "@packages/backend/convex/_generated/dataModel";
import { useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import {
  decideModeTag,
  decideOrderBadgeNew,
  decideStatusLabel,
} from "./decide-order-card";

/**
 * #401 — Home card for one tenant order (PRD 20 §2). Renders ID prefix, items
 * summary, total, ETA placeholder, status label, mode tag (🚴 LIVRAISON /
 * 🛍️ À EMPORTER) and the "nouvelle" badge if applicable. Tapping the card
 * navigates to the detail screen `/orders/<id>` so the cuisinier can read the
 * full récap + drive the workflow buttons.
 *
 * Pure rendering — every decision (mode tag, status label, badge) is
 * delegated to `decideOrderCard` so the truth table is pinned by the vitest
 * suite next door.
 */
export function OrderCard({ order }: { order: Doc<"orders"> }) {
  const router = useRouter();
  const modeTag = decideModeTag(order.mode);
  const statusLabel = decideStatusLabel(order.status);
  const showBadge = decideOrderBadgeNew(order.status);
  const totalEuros =
    order.pricingSnapshot !== undefined
      ? (order.pricingSnapshot.total / 100).toFixed(2)
      : null;
  // Last 4 hex chars of the Convex id — readable handle without leaking the
  // full id on the card (the cuisinier reads "Cmd #a3f1", not a 32-char hash).
  const idTail = (order._id as unknown as string).slice(-4).toUpperCase();
  return (
    <Pressable
      onPress={() => {
        router.push({
          pathname: "/orders/[orderId]",
          params: { orderId: order._id as unknown as string },
        });
      }}
      accessibilityRole="button"
      accessibilityLabel={`Ouvrir la commande ${idTail}`}
    >
      <Card className="mb-3">
        <CardHeader className="flex-row items-center justify-between">
          <View className="flex-row items-center gap-2">
            <Text className="text-foreground text-base font-semibold">
              Cmd #{idTail}
            </Text>
            {showBadge ? (
              <View
                className="rounded-full bg-primary px-2 py-0.5"
                accessibilityLabel="Nouvelle commande non lue"
              >
                <Text className="text-primary-foreground text-xs font-semibold">
                  Nouvelle
                </Text>
              </View>
            ) : null}
          </View>
          {modeTag !== null ? (
            <View
              className={cn(
                "flex-row items-center gap-1 rounded-md px-2 py-1",
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
        </CardHeader>
        <CardContent className="gap-1">
          <Text className="text-muted-foreground text-sm">{statusLabel}</Text>
          {totalEuros !== null ? (
            <Text className="text-foreground text-lg font-semibold">
              {totalEuros} €
            </Text>
          ) : null}
          <View className="flex-row items-center gap-1">
            <Ionicons
              name="chevron-forward"
              size={14}
              className="text-muted-foreground"
            />
            <Text className="text-muted-foreground text-xs">
              Toucher pour ouvrir
            </Text>
          </View>
        </CardContent>
      </Card>
    </Pressable>
  );
}
