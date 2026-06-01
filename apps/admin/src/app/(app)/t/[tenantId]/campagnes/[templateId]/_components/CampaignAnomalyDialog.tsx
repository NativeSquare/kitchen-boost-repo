/**
 * F-CAMPAGNES [5/7] (#228) — `CampaignAnomalyDialog`, the shadcn dialog that
 * surfaces when the backend `sendTenantCampaign` mutation throws
 * `ConvexError({ code: "CAMPAIGN_ANOMALY", message: "...: <reason>" })`
 * (parent EPIC #145, PRD 80 §7 anti-anomaly).
 *
 * Issue body verbatim :
 *   - Dialog shadcn qui s ouvre sur réponse `ConvexError({code:"CAMPAIGN_ANOMALY"})`.
 *   - Message FR clair (« Tu as déjà lancé une campagne récemment / Tu approches
 *     ton quota / Audience anormalement large — réessaie plus tard »).
 *   - Bouton « Compris ».
 *
 * Controlled component (shadcn Dialog pattern) :
 *   - `open` + `onOpenChange` are forwarded to the underlying Radix Root.
 *   - `reason` is the parsed anomaly tag (cf. `classifySendError`) — `null`
 *     falls back to a generic FR message so an unrecognised backend tweak
 *     doesn't leave the gérant on a blank dialog.
 *
 * Why an explicit early-return on `open === false` :
 *   The node-env vitest serializer (cf. `CampaignAnomalyDialog.test.tsx`)
 *   cannot rely on the Radix Portal's state-driven mount to hide the content
 *   text (the Portal is a forward-ref the serializer treats opaque-with-
 *   children — i.e. children are still walked regardless of `open`). The
 *   explicit `return null` mirrors the user-observable contract (closed →
 *   nothing rendered) AND keeps the test pin honest. In a real browser the
 *   parent only mounts this on `open=true` anyway, so the early-return is
 *   pure defensive insurance.
 *
 * Scope (#228 hard constraint) : only this file under
 * `apps/admin/src/app/(app)/t/[tenantId]/campagnes/[templateId]/_components/`.
 * Zero touch to `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */

"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CampaignAnomalyReason } from "../_lib/classifySendError";

export type CampaignAnomalyDialogProps = {
  /** Controlled open state (shadcn Dialog pattern). */
  open: boolean;
  /** Forwarded to the Radix Root so the parent can react to ESC / overlay
   *  click. The « Compris » button itself uses `onOpenChange(false)`. */
  onOpenChange: (open: boolean) => void;
  /** Parsed anomaly tag (cf. `classifySendError`). `null` → generic fallback. */
  reason: CampaignAnomalyReason | null;
};

/**
 * Per-reason FR copy — load-bearing wording from the issue body. The exact
 * sentences are pinned by the test (case-insensitive on the load-bearing
 * fragments) so a typographic polish stays a one-line edit here.
 */
const REASON_TITLE: Record<CampaignAnomalyReason, string> = {
  TOO_FREQUENT_48H: "Trop tôt pour relancer",
  TOO_FREQUENT_WEEK: "Quota hebdomadaire atteint",
  RECIPIENT_SURGE: "Audience anormalement large",
};

const REASON_MESSAGE: Record<CampaignAnomalyReason, string> = {
  TOO_FREQUENT_48H:
    "Tu as déjà lancé une campagne récemment. Patiente 48 h entre deux envois pour ne pas saturer tes clients.",
  TOO_FREQUENT_WEEK:
    "Tu approches ton quota de 3 campagnes par semaine. Réessaie la semaine prochaine.",
  RECIPIENT_SURGE:
    "Audience anormalement large par rapport à ton dernier envoi — réessaie plus tard ou contacte KitchenBoost.",
};

const FALLBACK_TITLE = "Campagne bloquée";
const FALLBACK_MESSAGE =
  "Cette campagne ne peut pas partir maintenant (cadence ou audience inhabituelle). Réessaie plus tard ou contacte KitchenBoost.";

export function CampaignAnomalyDialog({
  open,
  onOpenChange,
  reason,
}: CampaignAnomalyDialogProps) {
  // Explicit early-return on closed — keeps the user-observable contract
  // honest under the node-env serializer (cf. file header).
  if (!open) return null;

  const title = reason === null ? FALLBACK_TITLE : REASON_TITLE[reason];
  const message = reason === null ? FALLBACK_MESSAGE : REASON_MESSAGE[reason];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="campaign-anomaly-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => onOpenChange(false)}
            data-slot="button"
            className="bg-[#1B7A3D] hover:bg-[#1B7A3D]/90"
          >
            Compris
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
