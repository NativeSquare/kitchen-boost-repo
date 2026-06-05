import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Text } from "@/components/ui/text";
import { useActiveTenantId } from "@/lib/tenant-switcher";
import { cn } from "@/lib/utils";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";
import {
  RefuseDialog,
  decideAutoExpiredDetailNote,
  decideModeTag,
  decidePickupHandoffNote,
  decideRefusalReasonLabel,
  decideRefuseButton,
  decideRefuseStepCount,
  decideStatusLabel,
  decideWorkflowButton,
  type RefusalReason,
} from "@/lib/orders";
import { printOrderTicket } from "@/lib/printing";
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

  // #412 — printer config + tenant name source for the auto-print + Réimprimer
  // ticket. The query is `OPERATIONAL_ALLOW` so the kitchen tablet under audit
  // monolithique V1 (staff actor) still reads — same shape as
  // `getOperationalPause`. Resolves to `null` when no printer is configured
  // (PRD 20 §14 — auto-print is then a clean no-op). `getSession` carries the
  // attached tenants with their names: we pluck the active tenant's name to
  // power the ticket header (same name surfaced by the header switcher).
  const printerConfig = useQuery(
    api.lib.printing.printing.getPrinterConfig,
    activeTenantId !== null ? { tenantId: activeTenantId } : "skip",
  );
  const session = useQuery(api.lib.auth.getSession.getSession);
  const tenantName =
    session?.tenants.find((t) => t.tenantId === activeTenantId)?.name ??
    "Restaurant";

  // Tap-to-reveal the delivery address (PRD 20 §4 — same UX rationale as the
  // tap-to-reveal phones the schema doesn't yet expose at the order level).
  const [addressRevealed, setAddressRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  // #412 — local busy flag for the « Réimprimer » button. Distinct from
  // `busy` (workflow buttons) so a reprint mid-workflow doesn't disable the
  // Accept / Prête / Remise primary actions.
  const [reprinting, setReprinting] = useState(false);
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
  // #413 — 2-step from `nouvelle`, 3-step from `en préparation` / `prête`
  // (anti-fat-finger: warning + typed "REFUSER"). The dialog itself owns
  // the step rendering; we just pass the count.
  const refuseStepCount = decideRefuseStepCount(order.status);
  const pickupNote = decidePickupHandoffNote(order.mode);
  // #417 — auto_expired terminal note (PRD 20 §8 « message neutre si
  // auto_expired »). Surfaced only when the order's status is auto_expired ;
  // sur tous les autres états le verdict est `hide` et le card n'est pas
  // monté. Le wording est tested dans `decide-history.test.ts`.
  const autoExpiredNote = decideAutoExpiredDetailNote(order.status);
  // #417 — refusal motif pour les cmds `refusée` ouvertes depuis l'historique.
  // Le backend stocke le motif sur le `orderEvents` row du transition
  // `refusée` ; on remonte le plus récent et on le traduit en label FR.
  // PRD 20 §8 « Détail cmd cliquable, affiche motif si refusée ».
  const refusedReasonLabel =
    order.status === "refusée"
      ? deriveRefusalReasonLabelFromEvents(detail.events)
      : null;
  const totalEuros =
    order.pricingSnapshot !== undefined
      ? (order.pricingSnapshot.total / 100).toFixed(2)
      : null;
  const idTail = (order._id as unknown as string).slice(-4).toUpperCase();

  /**
   * #412 — fire-and-forget Star WebPRNT POST for THIS order. Used by:
   *  - auto-print right after a successful `acknowledge` (PRD 20 §14, auto-
   *    print à l'ack);
   *  - the « Réimprimer » button (manual recourse if the first print failed).
   *
   * No-printer → silent no-op. Network / HTTP / timeout error → non-blocking
   * Alert « Impression échouée — vérifie l'imprimante » (PRD 20 §14). The
   * workflow has ALREADY committed by the time we get here, so a failed
   * print never blocks the cuisinier.
   */
  const printThisOrder = async (): Promise<void> => {
    const verdict = await printOrderTicket({
      starWebPrntUrl: printerConfig?.starWebPrntUrl ?? null,
      ticket: {
        tenantName,
        orderId: order._id as unknown as string,
        mode: order.mode,
        createdAtMs: order.createdAt,
        items: items.map((item) => ({
          quantity: item.quantity,
          itemName: item.itemName,
          modifiers: item.modifiers,
        })),
        restaurantNote: order.restaurantNote,
        totalCents: order.pricingSnapshot?.total,
      },
    });
    if (verdict.kind === "error") {
      Alert.alert(
        "Impression échouée",
        "Vérifie l'imprimante (alimentation, réseau, IP). La commande reste acceptée.",
      );
    }
  };

  const onWorkflowPress = async () => {
    if (buttonDecision.kind !== "show" || busy) return;
    setBusy(true);
    try {
      if (buttonDecision.action === "acknowledge") {
        await acknowledge({
          tenantId: activeTenantId,
          orderId: order._id,
        });
        // #412 — auto-print right after the mutation commits. Fire-and-
        // forget: a failure here is surfaced through a toast but does NOT
        // throw — the cmd is `en préparation` regardless of the printer.
        await printThisOrder();
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

  // #412 — « Réimprimer » manual button (PRD 20 §4 + §14). Tap once →
  // re-fire the same payload at the configured printer. Same non-blocking
  // toast on error.
  const onReprintPress = async () => {
    if (reprinting) return;
    setReprinting(true);
    try {
      await printThisOrder();
    } finally {
      setReprinting(false);
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
  const onRefuseConfirm = async (
    reason: RefusalReason,
    customReason?: string,
  ) => {
    if (refusing) return;
    setRefusing(true);
    try {
      await refuse({
        tenantId: activeTenantId,
        orderId: order._id,
        reason,
        // ADR 0019 — set iff reason === "autre"; the dialog en garantit
        // l'invariant (la branche customReasonInput route uniquement quand
        // l'utilisateur a saisi un texte). Le backend re-trim + re-valide.
        ...(customReason !== undefined ? { customReason } : {}),
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

      {/* #417 — Note auto_expired (PRD 20 §8 « message neutre si auto_expired »).
          Surfaced uniquement quand le terminal système a fired. Le wording
          est neutre par design — le système a fait le refund auto, le
          gérant n'a rien à faire et ne doit pas être blâmé. */}
      {autoExpiredNote.kind === "show" ? (
        <Card className="mb-3" testID="auto-expired-note">
          <CardHeader>
            <Text className="text-foreground text-base font-semibold">
              {autoExpiredNote.heading}
            </Text>
          </CardHeader>
          <CardContent>
            <Text className="text-foreground text-sm">
              {autoExpiredNote.body}
            </Text>
          </CardContent>
        </Card>
      ) : null}

      {/* #417 — Motif de refus (PRD 20 §8 « affiche motif si refusée »).
          Affiché uniquement pour les cmds `refusée` ouvertes depuis
          l'historique. Le motif est extrait du `orderEvents` row qui
          enregistre le `reason` à la transition vers `refusée` (chantier
          2.3-E). Si aucun motif n'est trouvé (cas très rare d'event log
          tronqué), on saute la card plutôt qu'afficher « Autre » par
          défaut — pas de spec inventée. */}
      {refusedReasonLabel !== null ? (
        <Card className="mb-3" testID="refused-reason-card">
          <CardHeader>
            <Text className="text-foreground text-base font-semibold">
              Motif du refus
            </Text>
          </CardHeader>
          <CardContent>
            <Text className="text-foreground text-sm">
              {refusedReasonLabel}
            </Text>
          </CardContent>
        </Card>
      ) : null}

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

      {/* #412 — « Réimprimer » manual button (PRD 20 §4 + §14). Available
          at any time (even after handoff) so the cuisinier can recover from
          a tag tombé, mal sorti, etc. Hidden when no printer is configured:
          there is nothing to print to, and the gérant should configure one
          in Settings first (PrinterEntry → /printer). */}
      {printerConfig !== undefined &&
      printerConfig !== null &&
      printerConfig.starWebPrntUrl !== "" ? (
        <View className="mb-3">
          <Button
            variant="outline"
            onPress={onReprintPress}
            disabled={reprinting || busy || refusing}
            accessibilityLabel="Réimprimer le ticket"
          >
            {reprinting ? (
              <ActivityIndicator />
            ) : (
              <View className="flex-row items-center gap-2">
                <Ionicons name="print-outline" size={18} color="#444" />
                <Text>Réimprimer le ticket</Text>
              </View>
            )}
          </Button>
        </View>
      ) : null}

      {/* Workflow buttons — primary (Accepter / Prête / Remise) + the
          secondary "Refuser" button on every live state (PRD 20 §6a, #403 +
          #413). On `nouvelle` the cuisinier reads the binary choice
          (accept vs refuse) at a glance; on `en préparation` / `prête` the
          Refuser button is still surfaced (the cost-of-error gate lives in
          the dialog's 3-step flow, not in button hiding). On terminal
          states no button is rendered at all. */}
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

      {/* #403 + #413 — Refusal dialog (PRD 20 §6a). The dialog's state
          machine + the 2-step / 3-step branching live in `refuse-dialog.tsx`;
          this screen owns the mutation + the busy state + the navigation
          after success. The step count (#413) is decided from the source
          status — 2 from `nouvelle`, 3 from `en préparation` / `prête`. */}
      <RefuseDialog
        open={refuseDialogOpen}
        stepCount={refuseStepCount}
        busy={refusing}
        onClose={() => setRefuseDialogOpen(false)}
        onConfirm={onRefuseConfirm}
      />
    </ScrollView>
  );
}

/**
 * #417 — Extract the refusal motif from the order's event log and translate
 * it to a French label. The backend records `{ status: "refusée", reason }`
 * on the transition (chantier 2.3-E, `recordTenantOrderStatus`). The
 * `reason` is one of the closed `RefusalReason` enum values
 * (`rupture | fermeture | surcharge | autre`).
 *
 * We scan events in reverse so a re-recorded refusal (defensive — the
 * legal-transitions guard makes it a no-op, but the audit log accepts
 * subsequent rows) carries the latest motif. Returns `null` if no event
 * carries a recognised reason — the detail screen then hides the « Motif
 * du refus » card rather than inventing one.
 *
 * Defensively NARROWED to the closed set so a future schema add (a new
 * `reason` value) does not silently fall back to "Autre" — the unknown
 * value passes through this filter and the card stays hidden.
 */
function deriveRefusalReasonLabelFromEvents(
  events: { status: string; reason?: string }[],
): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev.status !== "refusée") continue;
    const reason = ev.reason;
    if (
      reason === "rupture" ||
      reason === "fermeture" ||
      reason === "surcharge" ||
      reason === "autre"
    ) {
      return decideRefusalReasonLabel(reason as RefusalReason);
    }
  }
  return null;
}
