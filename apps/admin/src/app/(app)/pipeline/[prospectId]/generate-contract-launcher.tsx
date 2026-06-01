"use client";

/**
 * F-CONTRATS slice 3/4 (#174) — `GenerateContractLauncher`.
 *
 * Thin Convex-wiring wrapper around the pure `GenerateContractModal`.
 * Mounted on the supervision fiche (`prospect-fiche-view.tsx`), it owns :
 *   - the trigger button « Générer contrat » rendered inside the
 *     `ContractsBlock` header,
 *   - the dialog open / close state,
 *   - the in-flight + error state for the
 *     `api.lib.admin.contracts.generateContract` mutation,
 *   - the toast on error (« pas d'iframe blanche silencieuse » —
 *     issue AC),
 *   - on success : capture the new `contractId` and forward it via the
 *     `onGenerated(contractId)` callback so the parent page can render
 *     the `ContractIframe` BELOW the contracts block (issue AC : « ferme
 *     le modal, affiche le HTML dans une `ContractIframe` directement
 *     dans la page de la fiche prospect »).
 *
 * Reactivity guarantee : `useMutation` against a `kbAdminMutation` makes
 * Convex auto-refresh every dependent `useQuery` — including
 * `api.lib.admin.contracts.listContractsForProspect` consumed by
 * `ContractsBlock` (slice 1). The new `draft` row appears in the list
 * without any manual refetch (issue AC : « La liste du slice 1 se met
 * à jour automatiquement »).
 *
 * Why a separate launcher file (and not inline in the block)
 * ---------------------------------------------------------
 * Same split discipline as `ProvisionLauncherButton` vs
 * `ProspectFicheView` : keeping the block pure (no Convex hooks) lets
 * the existing slice-1 test matrix stay valid under the lean `node`
 * vitest env. The launcher carries every hook-touching concern (mutation
 * + state + toast).
 *
 * Scope discipline (#174 hard constraint) : this file lives UNDER
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/` only. No touches to
 * `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */
import { useState } from "react";
import { IconFileText } from "@tabler/icons-react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { Button } from "@/components/ui/button";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

import {
  GenerateContractModal,
  type ContractPrestation,
} from "./generate-contract-modal";
import {
  type ContractPartnerPayload,
  decideGenerateContract,
} from "./generate-contract.decision";

export type GenerateContractLauncherProps = {
  /**
   * The prospect doc (tri-state convex query). When `undefined` /
   * `null` the trigger button stays mounted but DISABLED — the operator
   * can't open the modal without a hydrated prospect. The decision file
   * carries the same loading / not-found branches for symmetry.
   */
  prospect: Doc<"prospects"> | null | undefined;
  /**
   * Success callback fired once the mutation resolves with a new
   * `contractId`. The page uses this to lift the contract id into local
   * state, then drives a `useQuery(api.lib.admin.contracts.getContract,
   * { contractId })` to hydrate the HTML for `ContractIframe`.
   */
  onGenerated: (contractId: Id<"contracts">) => void;
};

export function GenerateContractLauncher({
  prospect,
  onGenerated,
}: GenerateContractLauncherProps) {
  const generateContract = useMutation(
    api.lib.admin.contracts.generateContract,
  );
  // T6 chantier 2 — when the user edits one of the 5 juridical fields in
  // the modal, the changes are persisted on the prospect BEFORE generating
  // the contract so the next opening pre-fills with the fresh values (and
  // the rest of the CRM sees the updated data). If the persist fails we
  // surface a toast + abort the generation — no half-update.
  const editProspect = useMutation(api.lib.onboarding.crm.editProspect);

  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Disable the trigger when there is no hydrated prospect. The modal
  // also carries its own defensive branches, but a disabled trigger is
  // friendlier than opening a modal with a « Prospect introuvable »
  // message.
  const triggerDisabled =
    prospect === undefined || prospect === null || isSubmitting;

  const handleOpenChange = (next: boolean) => {
    // Clear the inline error when the modal is closed — a fresh open
    // should start clean.
    if (!next) {
      setSubmitError(null);
    }
    setOpen(next);
  };

  const handleSubmit = async (
    prestation: ContractPrestation,
    partner: ContractPartnerPayload,
  ) => {
    if (prospect === undefined || prospect === null) {
      // Belt-and-braces — the trigger is disabled in this branch, but
      // a defensive guard keeps the `prospect._id` access below sound.
      return;
    }

    // Re-derive the decision at submit time so we ALWAYS see the latest
    // prospect snapshot (no risk of stale capture from a stale render).
    // The modal carries the editable form state, so we compare its
    // `partner` payload against the prospect's seed to decide whether to
    // persist a `editProspect` patch first.
    const decision = decideGenerateContract({ prospect });
    void decision;

    setIsSubmitting(true);
    setSubmitError(null);
    try {
      // T6 chantier 2 — persist edits on the prospect FIRST so the
      // next opening pre-fills with the fresh values + the CRM sees
      // them. Build a minimal patch containing only the fields that
      // diverge from the current prospect doc (avoid writing the same
      // value).
      const seed = {
        raisonSociale: (prospect.name ?? "").trim(),
        siret: (prospect.siret ?? "").trim(),
        adresse: (prospect.address ?? "").trim(),
        email: (prospect.email ?? "").trim(),
        representant: (prospect.contactName ?? "").trim(),
      };
      const patch: {
        name?: string;
        siret?: string;
        address?: string;
        email?: string;
        contactName?: string;
      } = {};
      if (partner.raisonSociale !== seed.raisonSociale) {
        patch.name = partner.raisonSociale;
      }
      if (partner.siret !== seed.siret) patch.siret = partner.siret;
      if (partner.adresse !== seed.adresse) patch.address = partner.adresse;
      if (partner.email !== seed.email) patch.email = partner.email;
      if (partner.representant !== seed.representant) {
        patch.contactName = partner.representant;
      }
      const hasEdit = Object.keys(patch).length > 0;
      if (hasEdit) {
        try {
          await editProspect({ prospectId: prospect._id, patch });
        } catch (error) {
          const msg = getConvexErrorMessage(error);
          setSubmitError(msg);
          // Abort BEFORE generating — never produce a contract with
          // un-persisted edits (the next opening would silently
          // regenerate with the stale prospect data).
          toast.error(`Échec mise à jour fiche prospect : ${msg}`);
          return;
        }
      }

      const contractId = await generateContract({
        prospectId: prospect._id,
        prestation,
        partner,
      });
      // Success path : close the modal, then signal the parent so it can
      // hydrate the iframe below the block. The list of contracts
      // refreshes automatically via Convex reactivity.
      setOpen(false);
      onGenerated(contractId);
    } catch (error) {
      const msg = getConvexErrorMessage(error);
      setSubmitError(msg);
      // Issue AC : « Échec mutation → toast d'erreur, pas d'iframe
      // blanche ». The modal also surfaces the inline error so the
      // operator sees the failure even if they dismiss the toast.
      toast.error(`Échec génération contrat : ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-slot="generate-contract-trigger"
        onClick={() => setOpen(true)}
        disabled={triggerDisabled}
      >
        <IconFileText />
        Générer contrat
      </Button>
      <GenerateContractModal
        open={open}
        onOpenChange={handleOpenChange}
        prospect={prospect}
        isSubmitting={isSubmitting}
        submitError={submitError}
        onSubmit={handleSubmit}
      />
    </>
  );
}
