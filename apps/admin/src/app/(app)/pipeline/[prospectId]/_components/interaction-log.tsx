"use client";

/**
 * F-PIPELINE-CRM 08 (#263) — `InteractionLog` (pure) +
 * `InteractionLogConnected` (Convex-wired wrapper).
 *
 * Two-layer split (mirrors `milestone-checklist.tsx`):
 *
 *   - `InteractionLog` — PURE. Receives the prospect's interaction history
 *     + an `onLog(payload)` callback and renders the timeline. Owns the
 *     dialog open flag locally (`useState`); the connected wrapper passes
 *     the live mutation. The React-tree serializer used by the vitest
 *     `node` env can expand it through the `useState` shim used by the
 *     test (mirror of `generate-contract-modal.test.tsx`).
 *
 *   - `InteractionLogConnected` — THIN WRAPPER. Calls
 *     `useMutation(api.lib.onboarding.crm.logInteraction)` and forwards
 *     the resulting mutator to the pure shell. Mounted on the fiche
 *     (`prospect-fiche-view.tsx`).
 *
 * Convex reactivity guarantees the timeline re-renders with the new
 * interaction at the top once the mutation resolves — issue AC : « la
 * nouvelle interaction apparaît en tête de la timeline ».
 *
 * Scope discipline (#263 hard constraint): lives under
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/_components/` only.
 * Zero touch to `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */
import { useState, type ReactElement } from "react";
import {
  IconMessage,
  IconPhone,
  IconBrandWhatsapp,
  IconUserCheck,
  IconMapPin,
} from "@tabler/icons-react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import {
  LogInteractionForm,
  type InteractionCanal,
  type LogInteractionPayload,
} from "./log-interaction-form";

/**
 * Human label for each canal (matches the `acquisitionSource` backend
 * validator + the form's labels). Re-declared here so the timeline
 * stays callable in the lean `node` test env (no extra import).
 */
const CANAL_LABEL: Record<InteractionCanal, string> = {
  cold_call: "Cold call",
  whatsapp: "WhatsApp",
  referral: "Référence",
  visite_physique: "Visite physique",
};

/**
 * The icon that anchors each timeline row visually. Co-located so a
 * future PR can add per-canal accents without touching call sites.
 */
const CANAL_ICON: Record<
  InteractionCanal,
  (props: { size?: number }) => ReactElement
> = {
  cold_call: (props) => <IconPhone size={props.size ?? 16} />,
  whatsapp: (props) => <IconBrandWhatsapp size={props.size ?? 16} />,
  referral: (props) => <IconUserCheck size={props.size ?? 16} />,
  visite_physique: (props) => <IconMapPin size={props.size ?? 16} />,
};

/**
 * Format a UNIX-ms timestamp as a French relative date. Tiny, dependency-
 * free (no `Intl.RelativeTimeFormat` polyfill issue in `node` env): we
 * compute the diff in canonical buckets and pick the FR label.
 */
function formatRelativeDate(ms: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - ms);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "à l'instant";
  if (diff < hour) return `il y a ${Math.floor(diff / minute)} min`;
  if (diff < day) return `il y a ${Math.floor(diff / hour)} h`;
  const days = Math.floor(diff / day);
  if (days === 1) return "hier";
  if (days < 30) return `il y a ${days} j`;
  const months = Math.floor(days / 30);
  if (months < 12) return `il y a ${months} mois`;
  const years = Math.floor(months / 12);
  return `il y a ${years} an${years > 1 ? "s" : ""}`;
}

/**
 * The on-disk interaction shape (mirrors the `interaction` validator in
 * `convex/table/prospects.ts`). Re-declared here so the pure shell has
 * no transitive Convex import.
 */
export type ProspectInteraction = {
  note: string;
  date: number;
  canal: InteractionCanal;
};

/**
 * `logInteraction` mutation signature — the callback shape the pure
 * shell forwards form submits to. The connected wrapper wires the
 * canonical Convex mutation; tests inject a `vi.fn()`.
 */
export type LogInteractionFn = (
  prospectId: Id<"prospects">,
  payload: LogInteractionPayload,
) => Promise<unknown> | unknown;

export type InteractionLogProps = {
  prospectId: Id<"prospects">;
  /** Prospect's interaction history (chronological order on disk). */
  interactions: ReadonlyArray<ProspectInteraction>;
  /** Required callback fired on form submit. */
  onLog: LogInteractionFn;
};

/**
 * PURE shell — renders the antichronological timeline + a « Logger
 * interaction » trigger button that opens the form dialog. The dialog
 * itself is mounted unconditionally so the radix portal stays consistent
 * across opens.
 */
export function InteractionLog({
  prospectId,
  interactions,
  onLog,
}: InteractionLogProps) {
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Sort a defensive copy antichronologically — most recent first
  // (issue AC : « Timeline antichronologique »). The on-disk order is
  // append-only ascending, so we reverse-sort here.
  const sorted = [...interactions].sort((a, b) => b.date - a.date);

  const handleSubmit = async (payload: LogInteractionPayload) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await onLog(prospectId, payload);
      setOpen(false);
    } catch (error) {
      setSubmitError(getConvexErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setSubmitError(null);
    setOpen(next);
  };

  return (
    <Card data-slot="interaction-log">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Interactions</CardTitle>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-slot="interaction-log-trigger"
          onClick={() => setOpen(true)}
        >
          <IconMessage size={16} />
          Logger interaction
        </Button>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {sorted.length === 0 ? (
          <p
            className="text-muted-foreground text-sm"
            data-slot="interaction-log-empty"
          >
            Aucune interaction loggée pour le moment.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sorted.map((entry, idx) => {
              const Icon = CANAL_ICON[entry.canal];
              return (
                <li
                  key={`${entry.date}-${idx}`}
                  data-slot="interaction-row"
                  data-date={entry.date}
                  data-canal={entry.canal}
                  className="flex items-start gap-3 rounded-md border px-3 py-2"
                >
                  <div className="text-muted-foreground mt-0.5">
                    <Icon size={16} />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary">
                        {CANAL_LABEL[entry.canal]}
                      </Badge>
                      <span className="text-muted-foreground text-xs">
                        {formatRelativeDate(entry.date)}
                      </span>
                    </div>
                    <p className="text-sm break-words">{entry.note}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Logger une interaction</DialogTitle>
            <DialogDescription>
              Ajoute une note + le canal. La date est posée par le serveur au
              moment de l&apos;enregistrement.
            </DialogDescription>
          </DialogHeader>
          <LogInteractionForm
            isSubmitting={isSubmitting}
            submitError={submitError}
            onSubmit={handleSubmit}
            onCancel={() => handleOpenChange(false)}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}

export type InteractionLogConnectedProps = Omit<InteractionLogProps, "onLog">;

/**
 * Convex-wired wrapper — mounted on the fiche. Wires
 * `useMutation(api.lib.onboarding.crm.logInteraction)` and forwards
 * the mutator to the pure shell. Errors surface via `toast.error` (same
 * pattern as `milestone-checklist.tsx`).
 */
export function InteractionLogConnected(props: InteractionLogConnectedProps) {
  const logInteractionMutation = useMutation(
    api.lib.onboarding.crm.logInteraction,
  );

  const handleLog: LogInteractionFn = async (prospectId, payload) => {
    try {
      await logInteractionMutation({
        prospectId,
        note: payload.note,
        canal: payload.canal,
      });
    } catch (error) {
      const msg = getConvexErrorMessage(error);
      toast.error(`Échec log interaction : ${msg}`);
      throw error;
    }
  };

  return <InteractionLog {...props} onLog={handleLog} />;
}
