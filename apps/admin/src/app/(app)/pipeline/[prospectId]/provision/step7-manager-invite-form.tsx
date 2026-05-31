"use client";

/**
 * F-WIZARD [9/10] (#273) — `Step7ManagerInviteForm`, the real Step 7 form
 * that replaces the placeholder shipped by slice [1/10] (#265).
 *
 * Step 7 — envoi du magic-link d'invitation au gérant. Asynchrone : on
 * appelle `inviteManager({ tenantId, email, name? })` (B-AUTH-4 #204) ; le
 * gérant cliquera plus tard pour créer son compte KB Manager via le flux
 * `acceptInvite` étendu en B-AUTH-6 (#230). Step NON-BLOQUANT pour step 8 —
 * l'opérateur peut continuer même sans envoi (cas où le gérant est déjà sur
 * place et créera son compte plus tard), avec un warning visible (« Sans
 * invitation, le gérant ne pourra pas se connecter. »).
 *
 * L'acceptation de l'invite par le gérant peut survenir AVANT ou APRÈS
 * l'activation step 8 — les deux ordres sont supportés. `acceptInvite`
 * (`convex/table/admin.ts` B-AUTH-6) consomme un token quel que soit l'état
 * du tenant ; côté wizard rien à coder, c'est juste un fait du flux.
 *
 * Surface (issue body verbatim) :
 *   - Email gérant pré-rempli (read-only) — pour le modifier l'opérateur
 *     revient au step 1 ou passe par les paramètres tenant ultérieurement.
 *   - Input optionnel « Nom du gérant ».
 *   - Bouton « Envoyer l'invitation » qui déclenche `inviteManager`.
 *   - Sur succès → badge « Invitation envoyée le DD/MM/YYYY à HH:MM » +
 *     bouton « Renvoyer l'invitation » (re-déclenche `inviteManager` →
 *     côté backend, l'invite expirée est remplacée par une fresh / l'invite
 *     active jette `ALREADY_INVITED` avec un message clair).
 *   - Bouton « Continuer » toujours actif (step non-bloquant).
 *   - Erreur backend (ex. `ALREADY_INVITED`, email invalide) : message
 *     inline + le toast est déclenché par le wrapper `Step7Form`.
 *
 * Pourquoi un wrapper « pur » + un wrapper Convex (Step7Form) :
 * -----------------------------------------------------------
 * Mirror of `Step1Form` / `Step3Form` / `Step4Form` / `Step5Form` / `Step6Form` :
 * la wiring Convex (lecture prospect pour email/tenantId + lecture invite via
 * `getLatestManagerInviteForTenant` + mutation `inviteManager` + toasts) vit
 * dans `step-forms.tsx`. Ce module-ci reçoit tout déjà résolu via ses props
 * — facilement testable sous le lean `node` vitest env (même React-tree
 * serializer que les sibling forms).
 *
 * Scope (#273 hard constraint) : `apps/admin/src/app/(app)/pipeline/
 * [prospectId]/provision/` UNIQUEMENT.
 */

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import type { StepFormProps } from "./step-forms";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * The « invitation déjà envoyée » sentinel. Threaded by the wrapper from
 * `useQuery(getLatestManagerInviteForTenant, { tenantId })`. Convex tri-state:
 *   - `undefined` (query in flight) — handled by the wrapper (renders a
 *     spinner), this form receives the resolved value only.
 *   - `null` — no invite has ever been emitted for this tenant; show the
 *     « Envoyer » CTA + the warning copy.
 *   - `{ sentAt, email, name }` — a row exists; show the « envoyée » badge +
 *     « Renvoyer » CTA. `sentAt` is the `_creationTime` of the invite row
 *     (canonical send timestamp).
 */
export type ExistingManagerInvite = {
  sentAt: number;
  email: string;
  name: string;
};

export type Step7ManagerInviteFormProps = StepFormProps & {
  /**
   * The gérant email (read-only here — operator changes it via step 1 or
   * tenant settings). Source: the wrapper reads it from `prospect.email`
   * (fallback) or from `existingInvite.email` when an invite already exists.
   */
  email: string;
  /** Pre-filled name suggestion (e.g. from `prospect.contactName`). */
  defaultName?: string;
  /** The latest manager invite for this tenant, or `null` if none yet. */
  existingInvite: ExistingManagerInvite | null;
  /**
   * Send/resend the invite. Wired by `step-forms.tsx`'s `Step7Form` wrapper to
   * `useMutation(api.lib.admin.managerInvites.inviteManager)` with the
   * tenantId injected.
   */
  onSend: (input: { email: string; name?: string }) => Promise<void>;
  /** True while `inviteManager` is in flight (disables the send button). */
  isSending: boolean;
  /**
   * Backend error message (e.g. `ALREADY_INVITED`, email invalide), surfaced
   * inline. The wrapper also fires a toast.
   */
  sendError: string | null;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a `_creationTime` (ms epoch) as `DD/MM/YYYY à HH:MM` in fr-FR
 * locale. Defensive: a NaN / negative value falls back to an empty string
 * rather than rendering « Invalid Date » in the UI.
 */
function formatSentAt(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const d = new Date(ts);
  // fr-FR locale yields « 15/03/2026 » for the date part and « 09:42 » for
  // the time part — exact match for the issue spec « DD/MM/YYYY à HH:MM ».
  const date = d.toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const time = d.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} à ${time}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Step7ManagerInviteForm({
  email,
  defaultName,
  existingInvite,
  onSend,
  isSending,
  sendError,
  onPrev,
  onNext,
}: Step7ManagerInviteFormProps): React.JSX.Element {
  // Local state for the (optional) gérant name — seeded from the existing
  // invite's `name` if one exists, otherwise from `defaultName`. The operator
  // can edit it pre-send; on « Renvoyer » we forward whatever the input
  // currently shows (the backend's `inviteManager` accepts an optional `name`
  // and defaults to the email prefix if omitted).
  const [name, setName] = useState<string>(
    existingInvite?.name ?? defaultName ?? "",
  );

  const hasInvite = existingInvite !== null;

  const handleSend = async () => {
    if (isSending) return;
    const trimmed = name.trim();
    await onSend({
      email,
      name: trimmed.length > 0 ? trimmed : undefined,
    });
  };

  return (
    <div
      className="flex flex-col gap-4 px-4 py-2 lg:px-6"
      data-slot="wizard-step7-form"
    >
      {/* Email gérant — read-only, source-of-truth = step 1 prefill. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="wizard-step7-email">Email gérant</Label>
        <Input
          id="wizard-step7-email"
          name="email"
          type="email"
          value={email}
          readOnly
          data-slot="wizard-step7-email-input"
          aria-readonly="true"
        />
        <p className="text-muted-foreground text-xs">
          Pour modifier cet email, revenez au step 1 ou éditez la fiche tenant.
        </p>
      </div>

      {/* Nom du gérant — optional, editable pre-send. */}
      <div className="flex flex-col gap-2">
        <Label htmlFor="wizard-step7-name">Nom du gérant (optionnel)</Label>
        <Input
          id="wizard-step7-name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Le Gérant"
          data-slot="wizard-step7-name-input"
        />
      </div>

      {/* « Envoyer / Renvoyer » CTA — same backend call, label flips based on
          whether a row exists. */}
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          onClick={handleSend}
          disabled={isSending}
          data-slot="wizard-step7-send-button"
        >
          {isSending
            ? "Envoi en cours…"
            : hasInvite
              ? "Renvoyer l'invitation"
              : "Envoyer l'invitation"}
        </Button>

        {/* Backend error — surfaced inline (the wrapper also fires a toast). */}
        {sendError !== null ? (
          <p
            className="text-sm text-destructive"
            data-slot="wizard-step7-send-error"
            role="alert"
          >
            {sendError}
          </p>
        ) : null}

        {/* « Invitation envoyée le … » badge — visible when a row exists. */}
        {hasInvite ? (
          <Badge
            variant="secondary"
            className="self-start"
            data-slot="wizard-step7-sent-badge"
          >
            Invitation envoyée le {formatSentAt(existingInvite.sentAt)}
          </Badge>
        ) : null}

        {/* Warning when no invite has been sent yet — step is non-bloquant
            but the operator must understand the consequence. */}
        {!hasInvite ? (
          <p
            className="text-sm text-amber-700 dark:text-amber-300"
            data-slot="wizard-step7-no-invite-warning"
            role="note"
          >
            Sans invitation, le gérant ne pourra pas se connecter à son espace
            KB Manager.
          </p>
        ) : null}
      </div>

      <Separator />

      {/* Wizard nav strip. « Continuer » est TOUJOURS actif — step 7 est
          non-bloquant par spec (l'invite peut partir plus tard depuis la
          fiche tenant). */}
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="outline" onClick={onPrev}>
          Précédent
        </Button>
        <Button
          type="button"
          onClick={onNext}
          data-slot="wizard-step7-continue-button"
        >
          Continuer
        </Button>
      </div>
    </div>
  );
}
