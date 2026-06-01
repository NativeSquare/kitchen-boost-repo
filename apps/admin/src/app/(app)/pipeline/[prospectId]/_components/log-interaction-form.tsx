"use client";

/**
 * F-PIPELINE-CRM 08 (#263) — `LogInteractionForm`.
 *
 * Pure presentational form (no Convex hooks). Owns its own local note +
 * canal state (uncontrolled from the parent's perspective), exposes
 * `data-can-submit` on the submit button so the test matrix can pin
 * « form is valid » without injecting keystrokes (lean `node` env has no
 * jsdom).
 *
 * Date is server-stamped by the backend `appendInteraction` helper
 * (`Date.now()` in `lib/tenancy/prospectsStore.ts` — the caller never
 * forges it), so the form does NOT expose a date picker. The
 * `api.lib.onboarding.crm.logInteraction` validator only accepts
 * `prospectId`, `note`, `canal` — no `date`. No-invent.
 *
 * Scope discipline (#263) — lives under
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/_components/` only.
 */
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The 4 canonical canal literals — MUST match the backend `acquisitionSource`
 * validator (`packages/backend/convex/table/prospects.ts`). Re-declared here
 * as a const tuple so the lean `node` test env has no transitive Convex
 * dep when expanding the form.
 */
const CANAL_OPTIONS: ReadonlyArray<{
  value: "cold_call" | "whatsapp" | "referral" | "visite_physique";
  label: string;
}> = [
  { value: "cold_call", label: "Cold call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "referral", label: "Référence" },
  { value: "visite_physique", label: "Visite physique" },
];

export type InteractionCanal = (typeof CANAL_OPTIONS)[number]["value"];

export type LogInteractionPayload = {
  note: string;
  canal: InteractionCanal;
};

export type LogInteractionFormProps = {
  /** Disables the submit button while a mutation round-trip is in flight. */
  isSubmitting: boolean;
  /** Inline backend error (in addition to the toast the launcher fires). */
  submitError: string | null;
  /** Submit callback — fired with the captured note + canal. */
  onSubmit: (payload: LogInteractionPayload) => void | Promise<void>;
  /** Cancel callback — closes the modal without submitting. */
  onCancel: () => void;
  /** Optional seed for tests (the form is otherwise uncontrolled). */
  initialNote?: string;
  /** Optional seed for tests (the form is otherwise uncontrolled). */
  initialCanal?: InteractionCanal;
};

export function LogInteractionForm({
  isSubmitting,
  submitError,
  onSubmit,
  onCancel,
  initialNote = "",
  initialCanal = "cold_call",
}: LogInteractionFormProps) {
  const [note, setNote] = useState<string>(initialNote);
  const [canal, setCanal] = useState<InteractionCanal>(initialCanal);

  const canSubmit = note.trim().length > 0 && !isSubmitting;

  const handleSubmit = () => {
    if (!canSubmit) return;
    void onSubmit({ note: note.trim(), canal });
  };

  return (
    <div className="flex flex-col gap-4" data-slot="log-interaction-form">
      <div className="flex flex-col gap-2">
        <Label htmlFor="log-interaction-note" className="text-sm font-medium">
          Note
        </Label>
        <Textarea
          id="log-interaction-note"
          data-slot="log-interaction-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Décris brièvement l'échange (intéressé, objection, RDV posé…)."
          rows={4}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Canal</Label>
        <Select
          value={canal}
          onValueChange={(next) => setCanal(next as InteractionCanal)}
        >
          <SelectTrigger data-slot="log-interaction-canal">
            <SelectValue placeholder="Canal" />
          </SelectTrigger>
          <SelectContent>
            {CANAL_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Visible labels for every canal — pinned by the test matrix to
         *  pin that all 4 canonical canaux are present in the rendered
         *  tree even though radix's `Select` content panel only mounts
         *  on open (lean `node` env can't open it). */}
        <ul className="sr-only" data-slot="log-interaction-canal-options">
          {CANAL_OPTIONS.map((opt) => (
            <li key={opt.value} data-canal={opt.value}>
              {opt.label}
            </li>
          ))}
        </ul>
      </div>

      {submitError !== null ? (
        <div
          data-slot="log-interaction-submit-error"
          className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
        >
          {submitError}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          data-slot="log-interaction-cancel"
          onClick={onCancel}
          disabled={isSubmitting}
        >
          Annuler
        </Button>
        <Button
          type="button"
          data-slot="log-interaction-submit"
          onClick={handleSubmit}
          disabled={!canSubmit}
          data-can-submit={canSubmit}
        >
          {isSubmitting ? "Envoi…" : "Logger"}
        </Button>
      </div>
    </div>
  );
}
