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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

import {
  JURIDICAL_FIELD_LABEL,
  type ContractPartnerPayload,
  decideGenerateContract,
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
 * UI labels for the 3 prestation values + a one-line FR description distilled
 * from the contract template (Article 1 §1.3) so a user who has not read the
 * full contract knows what they are picking. Resumé strict — no copy/paste
 * from the template.
 */
const PRESTATION_OPTIONS: {
  value: ContractPrestation;
  label: string;
  description: string;
}[] = [
  {
    value: "A",
    label: "A seul — Marque virtuelle sur Uber Eats",
    description:
      "Licence d'une marque virtuelle KitchenBoost, création + paramétrage menu Uber Eats, gestion compte et optimisation marketing.",
  },
  {
    value: "B",
    label: "B seul — Canal de commande directe",
    description:
      "Plateforme KitchenBoost au nom du restaurant : QR code dans les sacs, page de commande directe, livraison Uber Direct, paiement Stripe (sans commission marketing).",
  },
  {
    value: "A_AND_B",
    label: "A & B — Les deux combinées",
    description:
      "Marque virtuelle Uber Eats (A) + canal de commande directe KitchenBoost (B). Cas le plus courant.",
  },
];

/** Verbatim copy from the issue spec (« message d'aide clair »). */
const MISSING_FIELDS_COPY =
  "Complète la fiche prospect avant de générer un contrat.";

/** SIRET = exactly 14 digits (loose validation — Luhn is not enforced V1). */
const SIRET_REGEX = /^\d{14}$/;
/** Email — a permissive standard shape, not RFC 5322 strict. */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validate the 5 juridical fields with format rules (T6 chantier 2). */
type FieldErrors = Partial<Record<keyof ContractPartnerPayload, string>>;

function validatePartner(p: ContractPartnerPayload): FieldErrors {
  const errors: FieldErrors = {};
  if (p.raisonSociale.trim().length === 0) {
    errors.raisonSociale = "Raison sociale requise.";
  }
  const siretClean = p.siret.replace(/\s+/g, "");
  if (siretClean.length === 0) {
    errors.siret = "SIRET requis.";
  } else if (!SIRET_REGEX.test(siretClean)) {
    errors.siret = "SIRET invalide (14 chiffres exactement).";
  }
  if (p.adresse.trim().length === 0) {
    errors.adresse = "Adresse requise.";
  }
  if (p.email.trim().length === 0) {
    errors.email = "Email requis.";
  } else if (!EMAIL_REGEX.test(p.email.trim())) {
    errors.email = "Email invalide.";
  }
  if (p.representant.trim().length === 0) {
    errors.representant = "Représentant requis.";
  }
  return errors;
}

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
   * Submit callback — fired with the selected prestation and the (possibly
   * edited) partner payload. The launcher persists any field edit on the
   * prospect BEFORE generating the contract so the next opening pre-fills
   * with the fresh values (T6 chantier 2 — édition sur place).
   */
  onSubmit: (
    prestation: ContractPrestation,
    partner: ContractPartnerPayload,
  ) => void | Promise<void>;
};

export function GenerateContractModal(props: GenerateContractModalProps) {
  const { open, onOpenChange, prospect, isSubmitting, submitError, onSubmit } =
    props;

  // The modal owns the selected prestation + the 5 editable juridical
  // fields. The fields are SEEDED from the prospect doc but writable —
  // a user can edit on the fly before generating; the launcher persists
  // any change on the prospect (via api.lib.onboarding.crm.editProspect)
  // BEFORE firing the generate mutation so the next opening shows the
  // fresh values. Resets are owned by the launcher: it unmounts the modal
  // on close, which discards this state for the next opening.
  const [prestation, setPrestation] = useState<ContractPrestation>("A");

  // Seed the editable inputs from the prospect doc when present. Falls
  // back to empty strings — the gating logic below disables submit until
  // every field validates.
  const [raisonSociale, setRaisonSociale] = useState<string>(
    (prospect?.name ?? "").trim(),
  );
  const [siret, setSiret] = useState<string>((prospect?.siret ?? "").trim());
  const [adresse, setAdresse] = useState<string>(
    (prospect?.address ?? "").trim(),
  );
  const [email, setEmail] = useState<string>((prospect?.email ?? "").trim());
  const [representant, setRepresentant] = useState<string>(
    (prospect?.contactName ?? "").trim(),
  );

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

  // decision.kind === "ready" — the prospect is hydrated. We keep
  // `decision` around for the missing-fields help message (the launcher
  // re-derives the decision at submit time too — single source of truth
  // for the seed values).
  void decision;

  // Build the current editable payload from the input state. Trims on
  // collection — the validator and the backend mutation both see the
  // trimmed form. `siret` is also stripped of inner whitespace so a user
  // can paste « 995 089 851 00019 » and the 14-digit shape still matches.
  const currentPartner: ContractPartnerPayload = {
    raisonSociale: raisonSociale.trim(),
    siret: siret.replace(/\s+/g, ""),
    adresse: adresse.trim(),
    email: email.trim(),
    representant: representant.trim(),
  };

  const fieldErrors = validatePartner(currentPartner);
  const errorCount = Object.keys(fieldErrors).length;
  const canGenerate = errorCount === 0;
  const isSubmitEnabled = canGenerate && !isSubmitting;

  const handleSubmit = () => {
    if (!isSubmitEnabled) return;
    void onSubmit(prestation, currentPartner);
  };

  // The set of inputs rendered in the editable form — keeps the JSX
  // declarative + lets a future field-add stay one line.
  type FieldSpec = {
    key: keyof ContractPartnerPayload;
    label: string;
    value: string;
    setValue: (next: string) => void;
    placeholder?: string;
    inputMode?: "text" | "email" | "numeric";
    type?: string;
  };
  const FIELDS: FieldSpec[] = [
    {
      key: "raisonSociale",
      label: JURIDICAL_FIELD_LABEL.raisonSociale,
      value: raisonSociale,
      setValue: setRaisonSociale,
      placeholder: "Raison sociale du restaurant",
    },
    {
      key: "siret",
      label: JURIDICAL_FIELD_LABEL.siret,
      value: siret,
      setValue: setSiret,
      placeholder: "14 chiffres",
      inputMode: "numeric",
    },
    {
      key: "adresse",
      label: JURIDICAL_FIELD_LABEL.adresse,
      value: adresse,
      setValue: setAdresse,
      placeholder: "12 rue ..., 91000 Évry",
    },
    {
      key: "email",
      label: JURIDICAL_FIELD_LABEL.email,
      value: email,
      setValue: setEmail,
      placeholder: "contact@restaurant.fr",
      inputMode: "email",
      type: "email",
    },
    {
      key: "representant",
      label: JURIDICAL_FIELD_LABEL.representant,
      value: representant,
      setValue: setRepresentant,
      placeholder: "Prénom Nom du signataire",
    },
  ];

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

        {/* Prestation picker (radios) — each option carries a one-line
            FR description distilled from the contract template (Art. 1
            §1.3) so a user who has not read the contract knows what
            they are picking. */}
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
                <div key={opt.value} className="flex items-start gap-2">
                  <RadioGroupItem value={opt.value} id={id} className="mt-1" />
                  <div className="flex flex-col gap-0.5">
                    <Label htmlFor={id} className="text-sm font-medium">
                      {opt.label}
                    </Label>
                    <span
                      data-slot="generate-contract-prestation-description"
                      className="text-muted-foreground text-xs"
                    >
                      {opt.description}
                    </span>
                  </div>
                </div>
              );
            })}
          </RadioGroup>
        </div>

        {/* Juridical fields — editable inputs seeded from the prospect.
            The launcher persists any change BEFORE generating so the
            fresh values flow back into the prospect doc + the next
            opening pre-fills with them. */}
        <div
          className="flex flex-col gap-2"
          data-slot="generate-contract-juridical-recap"
        >
          <Label className="text-sm font-medium">Champs juridiques</Label>
          <p className="text-muted-foreground text-xs">
            Pré-remplis depuis la fiche prospect — modifiables ici. Les
            modifications sont enregistrées sur le prospect au moment de
            générer.
          </p>
          <div className="flex flex-col gap-3 rounded-md border p-3">
            {FIELDS.map((f) => {
              const err = fieldErrors[f.key];
              const isMissing = f.value.trim().length === 0;
              return (
                <div
                  key={f.key}
                  data-slot="juridical-field-row"
                  data-field={f.key}
                  data-missing={isMissing ? "true" : "false"}
                  data-invalid={err !== undefined ? "true" : "false"}
                  className="flex flex-col gap-1"
                >
                  <Label
                    htmlFor={`generate-contract-field-${f.key}`}
                    className="text-muted-foreground text-xs uppercase"
                  >
                    {f.label}
                  </Label>
                  <Input
                    id={`generate-contract-field-${f.key}`}
                    data-slot={`generate-contract-input-${f.key}`}
                    value={f.value}
                    onChange={(e) => f.setValue(e.target.value)}
                    placeholder={f.placeholder}
                    inputMode={f.inputMode}
                    type={f.type ?? "text"}
                    aria-invalid={err !== undefined ? true : undefined}
                  />
                  {err !== undefined ? (
                    <span
                      data-slot={`generate-contract-error-${f.key}`}
                      className="text-destructive text-xs"
                    >
                      {err}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
          {!canGenerate ? (
            <p
              data-slot="generate-contract-missing-help"
              className="text-destructive text-xs"
            >
              {MISSING_FIELDS_COPY}
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
