"use client";

/**
 * F-CONTRATS slice 3/4 (#174) — `GenerateContractModal`.
 *
 * Pure presentational modal opened from the « Générer contrat » button of
 * `ContractsBlock` (slice 1). Owns the prestation picker state (default
 * `A`) + delegates the actual mutation call to the parent
 * (`generate-contract-launcher.tsx`) via `onSubmit(prestation)`. The
 * launcher owns the Convex wiring + the toast on error + the success
 * post-processing.
 *
 * Why a pure component (Convex hooks live UP)
 * ------------------------------------------
 * Same split discipline as `Step1ProvisioningForm` /
 * `MonitoringView` / `ProspectFicheView`: the React-tree-serializer
 * vitest pattern only handles pure callable components. The launcher
 * (`generate-contract-launcher.tsx`) owns `useMutation`, `useState` for
 * the open flag + the error string, and threads them down here. This
 * file stays callable from the lean `node` env.
 *
 * Surface (issue #174)
 * --------------------
 *   - **Picker prestation** : 3 radios « A seul / B seul / A & B »
 *     (canonical values `A` / `B` / `A_AND_B` — match the contract
 *     template's `<!-- BEGIN prestation_X -->` tags + `contractPrestation`
 *     validator in `convex/table/contracts`). Default selection : `A`.
 *   - **Récap des 5 champs juridiques** : pré-remplis depuis le prospect
 *     via `decideGenerateContract`. Une ligne par champ avec le label FR,
 *     la valeur (ou « — » si absente), et le flag `data-missing` qui
 *     pilote le styling rouge. Read-only en V1 (issue spec : « édition
 *     manuelle des champs juridiques = V2 »).
 *   - **Help message** : « Complète la fiche prospect avant de générer un
 *     contrat » quand un champ manque, AVEC la liste des champs absents
 *     (nominative — l'opérateur sait quoi compléter sur la fiche).
 *   - **Bouton submit** : disabled tant que `canGenerate === false` OU
 *     `isSubmitting === true`. Libellé « Générer » → « Génération… »
 *     pendant l'appel.
 *   - **Bouton cancel** : ferme le modal via `onOpenChange(false)`.
 *
 * Out of scope (V2)
 * -----------------
 * Pas de boutons « Envoyer Odoo », « Rafraîchir statut », « Marquer
 * signé », ni d'édition manuelle des champs juridiques — issue spec :
 * « Out of scope explicite » + PRD 70 §3.5 V1 simplifié.
 *
 * Scope discipline (#174 hard constraint) : ce fichier (et ses tests
 * voisins) vit UNIQUEMENT sous `apps/admin/src/app/(app)/pipeline/
 * [prospectId]/`. Aucune touche à `apps/web`, `apps/native`, ni
 * `packages/backend/convex/`.
 */
import { useState } from "react";

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import {
  JURIDICAL_FIELD_LABEL,
  decideGenerateContract,
  type ContractPartnerPayload,
} from "./generate-contract.decision";

/**
 * Canonical prestation values — they MUST match the backend
 * `contractPrestation` validator + the `<!-- BEGIN prestation_X -->`
 * markers of `docs/legal/contrat_template.md`. Exporting the type so the
 * launcher can re-declare its `onSubmit` signature without re-importing
 * the convex schema type.
 */
export type ContractPrestation = "A" | "B" | "A_AND_B";

/**
 * UI labels for the 3 prestation values (issue spec verbatim: « A seul /
 * B seul / A & B »). Order matches the issue's bullet list.
 */
const PRESTATION_OPTIONS: { value: ContractPrestation; label: string }[] = [
  { value: "A", label: "A seul" },
  { value: "B", label: "B seul" },
  { value: "A_AND_B", label: "A & B" },
];

/** Verbatim copy from the issue spec (« message d'aide clair »). */
const MISSING_FIELDS_COPY =
  "Complète la fiche prospect avant de générer un contrat.";

export type GenerateContractModalProps = {
  /** Whether the dialog is open (parent state, plumbed by the launcher). */
  open: boolean;
  /** Dialog open-state setter (radix contract). */
  onOpenChange: (open: boolean) => void;
  /**
   * The prospect doc (tri-state convex query). When `undefined` /
   * `null`, the modal renders defensively (loading / not-found) so the
   * launcher can forward the raw query value without pre-filtering. In
   * practice the launcher will only open the modal once the prospect
   * resolves — these are belt-and-braces branches.
   */
  prospect: Doc<"prospects"> | null | undefined;
  /** Submit-in-flight flag (mutation round-trip). */
  isSubmitting: boolean;
  /**
   * Backend error string surfaced inline under the form (in addition
   * to the toast the launcher fires). The form never clears it — the
   * launcher flips it back to `null` on re-submit.
   */
  submitError: string | null;
  /**
   * Submit callback — fired with the selected prestation when every
   * juridical field is present. The launcher wraps the actual
   * `api.lib.admin.contracts.generateContract` mutation, building the
   * full payload (`prospectId` + `prestation` + `partner`) using
   * `decideGenerateContract`'s `partner` field.
   */
  onSubmit: (prestation: ContractPrestation) => void | Promise<void>;
};

export function GenerateContractModal(props: GenerateContractModalProps) {
  const { open, onOpenChange, prospect, isSubmitting, submitError, onSubmit } =
    props;

  // The modal owns ONE piece of state: the selected prestation. Default
  // is `A` (most-frequent contract per Yanis' case studies — L'Artisan
  // signed A only). Resets are owned by the launcher: it unmounts the
  // modal on close, which discards this state for the next opening.
  const [prestation, setPrestation] = useState<ContractPrestation>("A");

  const decision = decideGenerateContract({ prospect });

  // Loading / not-found are defensive branches — in practice the launcher
  // gates opening on a hydrated prospect, but the modal must render
  // SOMETHING sensible if it ever receives the wider tri-state value.
  if (decision.kind === "loading") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Générer un contrat</DialogTitle>
            <DialogDescription>
              Chargement de la fiche prospect…
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  if (decision.kind === "not-found") {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Générer un contrat</DialogTitle>
            <DialogDescription>
              Prospect introuvable. Impossible de générer un contrat.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  // decision.kind === "ready"
  const { recap, missingFields, canGenerate, partner: _partner } = decision;
  // `_partner` is forwarded by the launcher — the modal itself only
  // signals « ready to submit » via `canGenerate`. The launcher reads
  // `decideGenerateContract(...)` again to grab the partner payload at
  // submit time (single source of truth — no risk of stale capture).

  const isSubmitEnabled = canGenerate && !isSubmitting;

  const handleSubmit = () => {
    if (!isSubmitEnabled) return;
    void onSubmit(prestation);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Générer un contrat</DialogTitle>
          <DialogDescription>
            Choisis la prestation et vérifie les champs juridiques pré-remplis
            depuis la fiche prospect. Le contrat est généré en brouillon,
            l&apos;envoi Odoo et le suivi de signature se font manuellement
            (V1).
          </DialogDescription>
        </DialogHeader>

        {/* Prestation picker (radios). */}
        <div
          className="flex flex-col gap-3"
          data-slot="generate-contract-prestation"
        >
          <Label className="text-sm font-medium">Prestation</Label>
          <RadioGroup
            value={prestation}
            onValueChange={(next) => setPrestation(next as ContractPrestation)}
          >
            {PRESTATION_OPTIONS.map((opt) => {
              const id = `generate-contract-prestation-${opt.value}`;
              return (
                <div key={opt.value} className="flex items-center gap-2">
                  <RadioGroupItem value={opt.value} id={id} />
                  <Label htmlFor={id} className="text-sm">
                    {opt.label}
                  </Label>
                </div>
              );
            })}
          </RadioGroup>
        </div>

        {/* Juridical fields recap (read-only V1). */}
        <div
          className="flex flex-col gap-2"
          data-slot="generate-contract-juridical-recap"
        >
          <Label className="text-sm font-medium">Champs juridiques</Label>
          <ul className="flex flex-col divide-y rounded-md border">
            {recap.map((row) => (
              <li
                key={row.field}
                data-slot="juridical-field-row"
                data-field={row.field}
                data-missing={row.present ? "false" : "true"}
                className={
                  row.present
                    ? "flex items-baseline justify-between gap-4 px-3 py-2 text-sm"
                    : "flex items-baseline justify-between gap-4 px-3 py-2 text-sm text-destructive"
                }
              >
                <span className="text-muted-foreground text-xs uppercase">
                  {row.label}
                </span>
                <span className="text-right font-medium">
                  {row.present ? row.value : "— Manquant"}
                </span>
              </li>
            ))}
          </ul>
          {missingFields.length > 0 ? (
            <p
              data-slot="generate-contract-missing-help"
              className="text-destructive text-xs"
            >
              {MISSING_FIELDS_COPY} Champs absents :{" "}
              {missingFields.map((f) => JURIDICAL_FIELD_LABEL[f]).join(", ")}.
            </p>
          ) : null}
        </div>

        {/* Inline backend error (in addition to the toast the launcher fires). */}
        {submitError !== null ? (
          <div
            data-slot="generate-contract-submit-error"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
          >
            {submitError}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-slot="generate-contract-cancel"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Annuler
          </Button>
          <Button
            type="button"
            data-slot="generate-contract-submit"
            onClick={handleSubmit}
            disabled={!isSubmitEnabled}
          >
            {isSubmitting ? "Génération…" : "Générer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
