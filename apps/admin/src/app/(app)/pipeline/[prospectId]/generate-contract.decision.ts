/**
 * F-CONTRATS slice 3/4 (#174) — `decideGenerateContract` decision logic, pinned
 * as a pure function.
 *
 * The "Générer contrat" modal (`generate-contract-modal.tsx`) pre-fills its 5
 * juridical fields from the prospect doc (PRD 70 §3.5 "Inputs pré-remplis" —
 * `raisonSociale`, `siret`, `adresse`, `email`, `representant`). Some of those
 * are OPTIONAL on the prospect schema (`siret`, `address`, `email`,
 * `contactName`) — only `name` is required. The modal must therefore:
 *   - surface in RED the fields the operator still has to complete on the
 *     fiche prospect BEFORE a contract can be generated;
 *   - DISABLE the submit button while any required juridical field is
 *     missing (with a clear help message «Complète la fiche prospect avant
 *     de générer un contrat»);
 *   - when every field is present, build the `partner` payload the backend
 *     mutation `api.lib.admin.contracts.generateContract` expects.
 *
 * Same split discipline as `decideProspectFiche` / `decideProvisionLauncher`
 * / `decideMonitoring`: the React layer is a thin shell that executes the
 * decision; the decision itself is pure-callable from vitest's lean `node`
 * env (no React, no Convex, no router) so every branch — all five fields
 * filled, one missing, all missing, prospect null — is pinned in
 * isolation.
 *
 * Field mapping (prospect → contract.partner)
 * ------------------------------------------
 *   prospect.name        →  partner.raisonSociale  (always present, schema-required)
 *   prospect.siret       →  partner.siret          (optional → may be missing)
 *   prospect.address     →  partner.adresse        (optional → may be missing)
 *   prospect.email       →  partner.email          (optional → may be missing)
 *   prospect.contactName →  partner.representant   (optional → may be missing)
 *
 * The mutation re-validates the payload server-side (every field is a non-
 * empty `v.string()`), so this decision is the UX layer — the safety net
 * is the backend.
 *
 * Why a dedicated decision file?
 * ------------------------------
 * The modal renders the recap + the radio + the submit, AND the launcher
 * needs to know «can we even open the modal? does the prospect carry enough
 * data?». Both consume the same predicate — extracting it to a pure
 * function avoids duplicating the field check (and the «which fields are
 * missing?» labels) across two surfaces. Same justification as
 * `decideProvisionLauncher` reused by the fiche + the launcher.
 */
import type { Doc } from "@packages/backend/convex/_generated/dataModel";

/**
 * The 5 juridical fields the contract mutation requires (the keys of the
 * `partnerFiche` validator in `packages/backend/convex/lib/admin/contracts.ts`).
 * Listed in the order the modal renders them top-to-bottom — so a future
 * tweak to the modal layout reorders one source of truth, not two.
 */
export const JURIDICAL_FIELDS = [
  "raisonSociale",
  "siret",
  "adresse",
  "email",
  "representant",
] as const;
export type JuridicalField = (typeof JURIDICAL_FIELDS)[number];

/**
 * Human-readable French label per juridical field — surfaced in the recap
 * row labels AND the «missing field» error message. Centralised so a label
 * tweak («Raison sociale» → «Société») happens in ONE place.
 */
export const JURIDICAL_FIELD_LABEL: Record<JuridicalField, string> = {
  raisonSociale: "Raison sociale",
  siret: "SIRET",
  adresse: "Adresse",
  email: "Email",
  representant: "Représentant",
};

/** The `partner` payload shape the backend mutation expects (all required strings). */
export type ContractPartnerPayload = {
  raisonSociale: string;
  siret: string;
  adresse: string;
  email: string;
  representant: string;
};

/**
 * Per-field recap row the modal renders: the current value (may be empty)
 * + whether it is still missing (drives the red-styling + the disabled
 * submit). The `present` flag is the canonical signal — the UI styles
 * `!present` in red and disables submit while ANY row has `!present`.
 */
export type JuridicalFieldRecap = {
  field: JuridicalField;
  label: string;
  /**
   * The current value from the prospect, possibly the empty string when
   * the prospect field is `undefined` or whitespace-only. Always a string
   * so the recap renders deterministically (never «undefined» in the DOM).
   */
  value: string;
  /**
   * True iff the value is a non-empty trimmed string. The submit is gated
   * on every row being `present`.
   */
  present: boolean;
};

export type GenerateContractDecisionInput = {
  /**
   * The prospect from `useQuery(api.lib.onboarding.crm.getProspect, ...)`,
   * following Convex's tri-state contract: `undefined` (in-flight) | `null`
   * (no doc) | `Doc<"prospects">` (hydrated). The decision short-circuits
   * to `loading` / `not-found` upstream surfaces before ever reaching the
   * modal — but we accept the wider type so the launcher can defensively
   * forward the raw `useQuery` value.
   */
  prospect: Doc<"prospects"> | null | undefined;
};

export type GenerateContractDecision =
  /** Prospect still resolving — the launcher button disables itself. */
  | { kind: "loading" }
  /** Prospect doesn't exist — the launcher hides itself. */
  | { kind: "not-found" }
  /**
   * Prospect hydrated. Always provides the per-field recap so the modal
   * can render the visual feedback (red/normal). `partner` is the build
   * payload, populated ONLY when every field is present (otherwise the
   * modal MUST refuse to submit — pinned by `canGenerate`).
   */
  | {
      kind: "ready";
      recap: JuridicalFieldRecap[];
      missingFields: JuridicalField[];
      canGenerate: boolean;
      /**
       * The payload to forward to `api.lib.admin.contracts.generateContract`.
       * `null` while any field is missing — the caller MUST NOT submit with
       * a partial payload (the mutation would throw on the validator).
       */
      partner: ContractPartnerPayload | null;
    };

/**
 * Normalise an optional prospect field to a plain string for the recap.
 * Trims whitespace so a field full of spaces is treated as missing (a
 * defensive guard against stale CRM data — the mutation would otherwise
 * accept a whitespace string).
 */
function normalize(value: string | undefined): string {
  return (value ?? "").trim();
}

export function decideGenerateContract(
  input: GenerateContractDecisionInput,
): GenerateContractDecision {
  const { prospect } = input;

  if (prospect === undefined) return { kind: "loading" };
  if (prospect === null) return { kind: "not-found" };

  // Build the per-field recap in the canonical display order. Map each
  // prospect field to its juridical counterpart, normalise + flag absent
  // rows.
  const raisonSociale = normalize(prospect.name);
  const siret = normalize(prospect.siret);
  const adresse = normalize(prospect.address);
  const email = normalize(prospect.email);
  const representant = normalize(prospect.contactName);

  const byField: Record<JuridicalField, string> = {
    raisonSociale,
    siret,
    adresse,
    email,
    representant,
  };

  const recap: JuridicalFieldRecap[] = JURIDICAL_FIELDS.map((field) => ({
    field,
    label: JURIDICAL_FIELD_LABEL[field],
    value: byField[field],
    present: byField[field].length > 0,
  }));

  const missingFields = recap.filter((r) => !r.present).map((r) => r.field);
  const canGenerate = missingFields.length === 0;

  const partner: ContractPartnerPayload | null = canGenerate
    ? {
        raisonSociale,
        siret,
        adresse,
        email,
        representant,
      }
    : null;

  return {
    kind: "ready",
    recap,
    missingFields,
    canGenerate,
    partner,
  };
}
