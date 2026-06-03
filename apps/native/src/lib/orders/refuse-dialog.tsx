import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Text } from "@/components/ui/text";
import { useReducer } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import {
  REFUSAL_REASONS,
  decideRefusalReasonLabel,
  refuseFlowReducer,
  type RefusalReason,
} from "./decide-refuse-flow";

/**
 * #403 — the 2-step Refusal dialog (PRD 20 §6a, kb-orders CONTEXT "Refusal",
 * ADR 0016).
 *
 * Thin React adapter over the pure state machine `refuseFlowReducer`. The
 * decision logic lives in `decide-refuse-flow.ts` (pinned by vitest) — this
 * component is just the rendering layer that wires the user taps to the
 * reducer's actions and surfaces the busy state of the parent's `useMutation`.
 *
 * Step 1 — Pick motif:
 *   4 big tap targets (one per closed-set motif). Tapping a motif advances
 *   to Step 2 carrying the chosen reason in the reducer's state — the chosen
 *   motif and the about-to-be-dispatched reason can never drift.
 *
 * Step 2 — Confirm:
 *   "Confirmer le refus + refund" primary button + "Retour" cancel. Anti-fat-
 *   finger: a Cancel here returns to `idle` without triggering anything.
 *   The Confirm button is disabled while the parent's mutation is in flight
 *   (`busy` prop), and dispatching `confirm` closes the dialog immediately
 *   so a double-tap can't queue a second refund.
 *
 * The actual `useMutation(api.lib.orders.workflow.refuse)` lives on the
 * detail screen (`[orderId].tsx`) — this component is reason-typed and only
 * calls back through `onConfirm(reason)`. Keeping the mutation in the parent
 * means the busy spinner, the error Alert and the optional navigation after
 * success are all owned by the same place that owns the rest of the workflow
 * buttons (acknowledge / markPrepared / markHandedOff).
 *
 * Visibility is controlled by the parent (`open` prop) — the parent shows
 * the dialog when the secondary "Refuser" button is tapped (decided by
 * `decideRefuseButton`). On close (cancel OR confirm), the reducer goes back
 * to `idle` AND the parent flips `open` to `false`.
 */
export type RefuseDialogProps = {
  /** Whether the parent currently shows the dialog (driven by parent state). */
  open: boolean;
  /** Whether the parent's `refuse` mutation is in flight (disables Confirm). */
  busy: boolean;
  /** Parent closes the dialog (cancel from anywhere, or confirm completed). */
  onClose: () => void;
  /** Parent fires `useMutation(api.lib.orders.workflow.refuse)` with the picked reason. */
  onConfirm: (reason: RefusalReason) => void;
};

export function RefuseDialog({
  open,
  busy,
  onClose,
  onConfirm,
}: RefuseDialogProps) {
  const [state, dispatch] = useReducer(refuseFlowReducer, { step: "idle" });

  // Sync the reducer to the parent's `open` prop — when the parent opens the
  // dialog, we move to Step 1 (`pickReason`); when it closes (e.g. ESC on
  // web, swipe-down on native), we go back to `idle`.
  // We do NOT use a useEffect — the reducer's `open` action is idempotent
  // from non-idle steps and a no-op transition from `idle ↔ idle`, so we can
  // safely dispatch synchronously from the render path via `onOpenChange`.

  // The closed-set tuple is mapped over directly — no invented motif can
  // surface (the array is frozen + 1:1 with the backend validator).
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          dispatch({ type: "open" });
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
        ) : (
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
