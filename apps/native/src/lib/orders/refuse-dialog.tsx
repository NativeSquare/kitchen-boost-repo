import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useReducer } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import {
  CUSTOM_REASON_MAX_LENGTH,
  REFUSAL_REASONS,
  REFUSE_TYPED_WORD,
  decideCanSubmitCustomReason,
  decideRefusalReasonLabel,
  decideTypedConfirmation,
  refuseFlowReducer,
  type RefusalReason,
} from "./decide-refuse-flow";

/**
 * #403 + #413 — the Refusal dialog (PRD 20 §6a, kb-orders CONTEXT "Refusal",
 * ADR 0016).
 *
 * Thin React adapter over the pure state machine `refuseFlowReducer`. The
 * decision logic lives in `decide-refuse-flow.ts` (pinned by vitest) — this
 * component is just the rendering layer that wires the user taps to the
 * reducer's actions and surfaces the busy state of the parent's `useMutation`.
 *
 * Two flow variants, decided by the parent (via `stepCount`):
 *
 * ── 2-step variant (#403, from `nouvelle`) ───────────────────────────────────
 *  Step 1 — Pick motif: 4 big tap targets (one per closed-set motif).
 *  Step 2 — Confirm: "Confirmer le refus + refund" primary + "Retour" cancel.
 *           Anti-fat-finger: Cancel at step 2 returns to `idle` without
 *           triggering anything.
 *
 * ── 3-step variant (#413, from `en préparation` / `prête`) ───────────────────
 *  Step 1 — Pick motif (same as above).
 *  Step 2 — Warn-inflight: explicit warning that the kitchen has already
 *           started (« ATTENTION — la commande est déjà en préparation/prête,
 *           le client va recevoir un remboursement et perdre confiance »).
 *           Cuisinier must acknowledge to reach step 3.
 *  Step 3 — Typed-word: input field where the cuisinier types "REFUSER"
 *           (case-insensitive). The Confirm button is gated by
 *           `decideTypedConfirmation(typed)` — a fat-finger tap on the
 *           button alone cannot succeed.
 *
 * The actual `useMutation(api.lib.orders.workflow.refuse)` lives on the
 * detail screen (`[orderId].tsx`) — this component is reason-typed and only
 * calls back through `onConfirm(reason)`. Keeping the mutation in the parent
 * means the busy spinner, the error Alert and the optional navigation after
 * success are all owned by the same place that owns the rest of the workflow
 * buttons (acknowledge / markPrepared / markHandedOff).
 *
 * Visibility is controlled by the parent (`open` prop). On close (cancel OR
 * confirm), the reducer goes back to `idle` AND the parent flips `open` to
 * `false`.
 */
export type RefuseDialogProps = {
  /** Whether the parent currently shows the dialog (driven by parent state). */
  open: boolean;
  /**
   * The dialog flow mode (#413). `2` from `nouvelle` (#403 original story);
   * `3` from `en préparation` / `prête` (anti-fat-finger: warning step +
   * typed "REFUSER" word). Resolved by the parent via `decideRefuseStepCount`.
   */
  stepCount: 2 | 3;
  /** Whether the parent's `refuse` mutation is in flight (disables Confirm). */
  busy: boolean;
  /** Parent closes the dialog (cancel from anywhere, or confirm completed). */
  onClose: () => void;
  /**
   * Parent fires `useMutation(api.lib.orders.workflow.refuse)` with the picked
   * reason. ADR 0019 — quand `reason === "autre"`, `customReason` (texte libre
   * 1-280 chars, trimmé) est obligatoire ; sinon il est `undefined`. La dialog
   * elle-même garantit l'invariant via le step `customReasonInput` (l'autre
   * branche de `selectReason` ne saute jamais à `confirm` avec `autre`).
   */
  onConfirm: (reason: RefusalReason, customReason?: string) => void;
};

export function RefuseDialog({
  open,
  stepCount,
  busy,
  onClose,
  onConfirm,
}: RefuseDialogProps) {
  const [state, dispatch] = useReducer(refuseFlowReducer, { step: "idle" });

  // Sync the parent-owned `open` prop with the dialog's local reducer.
  //
  // Why a useEffect: `@rn-primitives/dialog` uses `useControllableState` —
  // in controlled mode (we pass `open`), its internal `onChange` is ONLY
  // fired when the primitive itself calls `setValue` (e.g. backdrop / hw
  // back / X close). It is NEVER fired when the parent flips `open` via
  // `setRefuseDialogOpen(true)`. Without this effect, the reducer stays
  // at `idle` even when the dialog is visually open, and every motif tap
  // dispatches `selectReason` from `idle` → defensive no-op (cf. test
  // "ignores `selectReason` from idle"). All 4 motifs would silently do
  // nothing. The `open` action is idempotent (re-fire from a non-idle
  // step keeps the current step intact), so this is safe across renders.
  useEffect(() => {
    if (open) {
      dispatch({ type: "open", stepCount });
    } else {
      // Parent closed the dialog (via setRefuseDialogOpen(false) — happens
      // after a confirm or an external close). Reset the reducer so the
      // next open starts at `pickReason` instead of resuming mid-flow.
      dispatch({ type: "cancel" });
    }
  }, [open, stepCount]);

  // The closed-set tuple is mapped over directly — no invented motif can
  // surface (the array is frozen + 1:1 with the backend validator).
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Primitive-driven changes (backdrop tap, hardware back, X close
        // button). The parent-driven `open` flip is handled by the
        // `useEffect` above; here we only relay primitive close events to
        // the parent so its `refuseDialogOpen` state stays in sync.
        if (!next) {
          dispatch({ type: "cancel" });
          onClose();
        }
      }}
    >
      <DialogContent>
        {state.step === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirmer le refus + remboursement</DialogTitle>
              <DialogDescription>
                Motif : {decideRefusalReasonLabel(state.reason)}
                {state.customReason !== undefined
                  ? ` — ${state.customReason}`
                  : ""}
                . Le client sera remboursé immédiatement et notifié du refus.
                Cette action est irréversible.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onPress={() => {
                  dispatch({ type: "cancel" });
                  onClose();
                }}
                disabled={busy}
                accessibilityLabel="Retour"
              >
                <Ionicons name="arrow-back-outline" size={18} color="#111111" />
                <Text>Retour</Text>
              </Button>
              <Button
                variant="destructive"
                onPress={() => {
                  // Fire the mutation FIRST (parent owns it), then close the
                  // dialog so a double-tap can't queue a second refund.
                  onConfirm(state.reason, state.customReason);
                  dispatch({ type: "confirm" });
                  onClose();
                }}
                disabled={busy}
                accessibilityLabel="Confirmer le refus et le remboursement"
              >
                {busy ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Ionicons name="warning-outline" size={18} color="white" />
                    <Text className="text-destructive-foreground font-semibold">
                      Confirmer le refus + refund
                    </Text>
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : state.step === "customReasonInput" ? (
          // ADR 0019 — étape additionnelle quand `reason === "autre"` : le
          // restaurateur saisit un texte libre 1-280 chars qui sera propagé tel
          // quel dans le push client ("Motif : ${customReason}"). Le bouton
          // « Continuer » est disabled tant que `decideCanSubmitCustomReason`
          // retourne false (trim vide ou > 280).
          <>
            <DialogHeader>
              <DialogTitle>Précisez le motif</DialogTitle>
              <DialogDescription>
                Ce message sera visible par le client dans sa notification.
              </DialogDescription>
            </DialogHeader>
            <View className="gap-2">
              <Input
                value={state.typed}
                onChangeText={(value) =>
                  dispatch({ type: "setCustomReason", value })
                }
                placeholder="Ex : ratatouille brûlée, panne frigo, etc."
                multiline
                numberOfLines={3}
                maxLength={CUSTOM_REASON_MAX_LENGTH}
                editable={!busy}
                accessibilityLabel="Motif libre"
                accessibilityHint={`Saisis le motif. ${CUSTOM_REASON_MAX_LENGTH} caractères max.`}
                testID="refuse-custom-reason-input"
                className="h-24"
              />
              <Text className="text-muted-foreground text-right text-xs">
                {state.typed.length}/{CUSTOM_REASON_MAX_LENGTH}
              </Text>
            </View>
            <DialogFooter>
              <Button
                variant="outline"
                onPress={() => {
                  dispatch({ type: "cancel" });
                  onClose();
                }}
                disabled={busy}
                accessibilityLabel="Retour"
              >
                <Ionicons name="arrow-back-outline" size={18} color="#111111" />
                <Text>Retour</Text>
              </Button>
              <Button
                onPress={() => dispatch({ type: "submitCustomReason" })}
                disabled={busy || !decideCanSubmitCustomReason(state.typed)}
                accessibilityLabel="Continuer vers la confirmation"
                accessibilityState={{
                  disabled: busy || !decideCanSubmitCustomReason(state.typed),
                }}
              >
                <Text className="text-primary-foreground font-semibold">
                  Continuer
                </Text>
                <Ionicons
                  name="arrow-forward-outline"
                  size={18}
                  color="white"
                />
              </Button>
            </DialogFooter>
          </>
        ) : state.step === "warnInflight" ? (
          // #413 — Step 2 of the 3-step flow: cuisine déjà commencée. The
          // copy is distinct from the 2-step confirm (rappel coût erreur, no
          // refund happens until the cuisinier reaches Step 3 and types
          // "REFUSER"). The primary button is intentionally NOT destructive
          // at this step — it's an acknowledgement, not the kill switch.
          <>
            <DialogHeader>
              <DialogTitle>Attention — la cuisine a déjà commencé</DialogTitle>
              <DialogDescription>
                Motif : {decideRefusalReasonLabel(state.reason)}
                {state.customReason !== undefined
                  ? ` — ${state.customReason}`
                  : ""}
                . Cette commande est déjà en préparation ou prête. Refuser
                maintenant signifie perdre le travail cuisine déjà réalisé, et
                le client recevra un remboursement total. Il pourra perdre
                confiance. Es-tu sûr de vouloir continuer ?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onPress={() => {
                  dispatch({ type: "cancel" });
                  onClose();
                }}
                accessibilityLabel="Retour"
              >
                <Ionicons name="arrow-back-outline" size={18} color="#111111" />
                <Text>Retour</Text>
              </Button>
              <Button
                onPress={() => dispatch({ type: "acknowledgeWarning" })}
                accessibilityLabel="Continuer vers la confirmation finale"
              >
                <Text className="text-primary-foreground font-semibold">
                  Continuer
                </Text>
                <Ionicons
                  name="arrow-forward-outline"
                  size={18}
                  color="white"
                />
              </Button>
            </DialogFooter>
          </>
        ) : state.step === "typeWord" ? (
          // #413 — Step 3 of the 3-step flow: typed "REFUSER" gate. The
          // Confirm button is disabled until `decideTypedConfirmation` is
          // true — a fat-finger tap on the button alone cannot send a
          // refund.
          <>
            <DialogHeader>
              <DialogTitle>Confirmation finale</DialogTitle>
              <DialogDescription>
                Motif : {decideRefusalReasonLabel(state.reason)}
                {state.customReason !== undefined
                  ? ` — ${state.customReason}`
                  : ""}
                . Pour confirmer le refus et le remboursement total, tape{" "}
                <Text className="font-semibold">{REFUSE_TYPED_WORD}</Text>{" "}
                ci-dessous.
              </DialogDescription>
            </DialogHeader>
            <View className="gap-2">
              <Input
                value={state.typed}
                onChangeText={(value) =>
                  dispatch({ type: "setTypedWord", value })
                }
                placeholder={`Tape ${REFUSE_TYPED_WORD} pour valider`}
                autoCapitalize="characters"
                autoCorrect={false}
                editable={!busy}
                accessibilityLabel={`Tape ${REFUSE_TYPED_WORD} pour valider`}
                accessibilityHint="Champ texte de confirmation, case-insensitive"
                testID="refuse-typed-word-input"
              />
            </View>
            <DialogFooter>
              <Button
                variant="outline"
                onPress={() => {
                  dispatch({ type: "cancel" });
                  onClose();
                }}
                disabled={busy}
                accessibilityLabel="Retour"
              >
                <Ionicons name="arrow-back-outline" size={18} color="#111111" />
                <Text>Retour</Text>
              </Button>
              <Button
                variant="destructive"
                onPress={() => {
                  onConfirm(state.reason, state.customReason);
                  dispatch({ type: "confirm" });
                  onClose();
                }}
                disabled={busy || !decideTypedConfirmation(state.typed)}
                accessibilityLabel="Confirmer le refus et le remboursement"
                accessibilityState={{
                  disabled: busy || !decideTypedConfirmation(state.typed),
                }}
              >
                {busy ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <>
                    <Ionicons name="warning-outline" size={18} color="white" />
                    <Text className="text-destructive-foreground font-semibold">
                      Confirmer le refus + refund
                    </Text>
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          // `pickReason` (default landing step once the open-sync effect has
          // fired). `idle` can momentarily fall through here on the first
          // render while the `useEffect` hasn't dispatched `open` yet — the
          // copy is identical so the user never sees a flash, and the
          // motif Pressables become wired the moment the reducer flips to
          // `pickReason`.
          <>
            <DialogHeader>
              <DialogTitle>Refuser cette commande</DialogTitle>
              <DialogDescription>
                Choisissez le motif du refus. Le client sera remboursé
                automatiquement et notifié.
              </DialogDescription>
            </DialogHeader>
            <View className="gap-2">
              {REFUSAL_REASONS.map((reason) => (
                <Pressable
                  key={reason}
                  onPress={() => dispatch({ type: "selectReason", reason })}
                  accessibilityRole="button"
                  accessibilityLabel={`Motif : ${decideRefusalReasonLabel(
                    reason,
                  )}`}
                  className="border-border flex-row items-center gap-3 rounded-md border bg-background px-4 py-4 active:bg-muted"
                >
                  <Ionicons
                    name={decideRefusalReasonIcon(reason)}
                    size={22}
                    color="#111111"
                  />
                  <Text className="text-foreground text-base font-medium">
                    {decideRefusalReasonLabel(reason)}
                  </Text>
                </Pressable>
              ))}
            </View>
            <DialogFooter>
              <Button
                variant="outline"
                onPress={() => {
                  dispatch({ type: "cancel" });
                  onClose();
                }}
                accessibilityLabel="Annuler"
              >
                <Ionicons name="close-outline" size={18} color="#111111" />
                <Text>Annuler</Text>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Map a closed-set RefusalReason to its visual cue (Ionicon name). Visual
 * i18n mirror of `decideRefusalReasonLabel` — pour les restaurateurs qui ne
 * lisent pas le FR, l'icône doit suffire à reconnaître le motif :
 *
 *   rupture    → cube-outline           (stock manquant, plus de pièces)
 *   fermeture  → lock-closed-outline    (resto fermé)
 *   surcharge  → flame-outline          (cuisine en feu / overbooked)
 *   autre      → ellipsis-horizontal-outline (motif libre)
 */
function decideRefusalReasonIcon(
  reason: RefusalReason,
): keyof typeof Ionicons.glyphMap {
  switch (reason) {
    case "rupture":
      return "cube-outline";
    case "fermeture":
      return "lock-closed-outline";
    case "surcharge":
      return "flame-outline";
    case "autre":
      return "ellipsis-horizontal-outline";
  }
}
