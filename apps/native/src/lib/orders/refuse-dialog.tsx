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
import { useReducer } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import {
  REFUSAL_REASONS,
  REFUSE_TYPED_WORD,
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
  /** Parent fires `useMutation(api.lib.orders.workflow.refuse)` with the picked reason. */
  onConfirm: (reason: RefusalReason) => void;
};

export function RefuseDialog({
  open,
  stepCount,
  busy,
  onClose,
  onConfirm,
}: RefuseDialogProps) {
  const [state, dispatch] = useReducer(refuseFlowReducer, { step: "idle" });

  // The closed-set tuple is mapped over directly — no invented motif can
  // surface (the array is frozen + 1:1 with the backend validator).
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          // The parent's `stepCount` decides which flow we enter — the
          // reducer carries it from `pickReason` to `selectReason` so the
          // 2-step / 3-step branching can't drift.
          dispatch({ type: "open", stepCount });
        } else {
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
                Motif : {decideRefusalReasonLabel(state.reason)}. Le client sera
                remboursé immédiatement et notifié du refus. Cette action est
                irréversible.
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
                <Text>Retour</Text>
              </Button>
              <Button
                variant="destructive"
                onPress={() => {
                  // Fire the mutation FIRST (parent owns it), then close the
                  // dialog so a double-tap can't queue a second refund.
                  onConfirm(state.reason);
                  dispatch({ type: "confirm" });
                  onClose();
                }}
                disabled={busy}
                accessibilityLabel="Confirmer le refus et le remboursement"
              >
                {busy ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-destructive-foreground font-semibold">
                    Confirmer le refus + refund
                  </Text>
                )}
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
                Motif : {decideRefusalReasonLabel(state.reason)}. Cette commande
                est déjà en préparation ou prête. Refuser maintenant signifie
                perdre le travail cuisine déjà réalisé, et le client recevra un
                remboursement total. Il pourra perdre confiance. Es-tu sûr de
                vouloir continuer ?
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
                <Text>Retour</Text>
              </Button>
              <Button
                onPress={() => dispatch({ type: "acknowledgeWarning" })}
                accessibilityLabel="Continuer vers la confirmation finale"
              >
                <Text className="text-primary-foreground font-semibold">
                  Continuer
                </Text>
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
                Motif : {decideRefusalReasonLabel(state.reason)}. Pour confirmer
                le refus et le remboursement total, tape{" "}
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
                <Text>Retour</Text>
              </Button>
              <Button
                variant="destructive"
                onPress={() => {
                  onConfirm(state.reason);
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
                  <Text className="text-destructive-foreground font-semibold">
                    Confirmer le refus + refund
                  </Text>
                )}
              </Button>
            </DialogFooter>
          </>
        ) : (
          // `pickReason` or `idle` (idle should not actually render because
          // the parent's `open` prop is false in that case — the dialog
          // unmounts).
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
                  className="border-border rounded-md border bg-background px-4 py-4 active:bg-muted"
                >
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
                <Text>Annuler</Text>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
