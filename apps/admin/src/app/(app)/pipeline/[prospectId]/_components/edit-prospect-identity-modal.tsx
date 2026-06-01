"use client";

/**
 * F-PIPELINE-CRM 08 (#263) — `EditProspectIdentityModal` (pure) +
 * `EditProspectIdentityLauncher` (Convex-wired wrapper).
 *
 * Pure modal — V1 = form global (issue spec verbatim: « Pas d'édition
 * inline cellule-par-cellule (V1 = modal global) »). Owns its own
 * `useState` for the editable fields, seeded from the current prospect
 * doc. The submit handler emits a `patch` containing ONLY the fields
 * that diverged from the seed — Convex's `editProspect` validator
 * accepts only the listed fields, so we never send anything else
 * (no-invent).
 *
 * Connected wrapper wires `useMutation(api.lib.onboarding.crm.editProspect)`
 * and surfaces errors via `toast.error`. Mounted by `prospect-fiche-view.tsx`
 * next to the existing `ProspectIdentityPanel` (issue spec : « Bouton
 * "Éditer" dans le panneau identité »).
 *
 * Scope discipline (#263 hard constraint) — lives under
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/_components/` only.
 */
import { useState } from "react";
import { IconPencil } from "@tabler/icons-react";
import { useMutation } from "convex/react";
import { toast } from "sonner";

import { api } from "@packages/backend/convex/_generated/api";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getConvexErrorMessage } from "@/utils/getConvexErrorMessage";

/**
 * Canonical acquisition source literals (must match the backend
 * `acquisitionSource` validator). Re-declared locally so the modal
 * is hook-free of any Convex transitive import for the lean `node`
 * test env.
 */
type AcquisitionSource =
  | "cold_call"
  | "whatsapp"
  | "referral"
  | "visite_physique";

type TabletteModeValue = "appareil_existant" | "achat_kb" | "non_applicable";

const SOURCE_OPTIONS: ReadonlyArray<{
  value: AcquisitionSource;
  label: string;
}> = [
  { value: "cold_call", label: "Cold call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "referral", label: "Référence" },
  { value: "visite_physique", label: "Visite physique" },
];

const TABLETTE_OPTIONS: ReadonlyArray<{
  value: TabletteModeValue;
  label: string;
}> = [
  { value: "non_applicable", label: "Non applicable" },
  { value: "appareil_existant", label: "Appareil existant (BYOD)" },
  { value: "achat_kb", label: "Tablette achat KB (99 € HT)" },
];

/**
 * The patch sent to `api.lib.onboarding.crm.editProspect` — mirrors the
 * backend validator (`patch` object). Every field is optional (a patch
 * only carries changed fields).
 */
export type EditProspectPatch = {
  name?: string;
  siret?: string;
  address?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  source?: AcquisitionSource;
  score?: number;
  tabletteMode?: "appareil_existant" | "achat_kb";
};

export type EditProspectIdentityModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prospect: Doc<"prospects">;
  isSubmitting: boolean;
  submitError: string | null;
  /** Submit callback — emits the full patch (the modal does NOT diff). */
  onSubmit: (patch: EditProspectPatch) => void | Promise<void>;
};

export function EditProspectIdentityModal({
  open,
  onOpenChange,
  prospect,
  isSubmitting,
  submitError,
  onSubmit,
}: EditProspectIdentityModalProps) {
  // Seed every field from the current prospect doc. The form is uncontrolled
  // from the parent's perspective — `onSubmit` emits the full current state.
  const [name, setName] = useState<string>(prospect.name);
  const [siret, setSiret] = useState<string>(prospect.siret ?? "");
  const [address, setAddress] = useState<string>(prospect.address ?? "");
  const [contactName, setContactName] = useState<string>(
    prospect.contactName ?? "",
  );
  const [email, setEmail] = useState<string>(prospect.email ?? "");
  const [phone, setPhone] = useState<string>(prospect.phone);
  const [source, setSource] = useState<AcquisitionSource>(
    prospect.source as AcquisitionSource,
  );
  const [scoreRaw, setScoreRaw] = useState<string>(
    prospect.score === undefined ? "" : String(prospect.score),
  );
  const [tabletteMode, setTabletteMode] = useState<TabletteModeValue>(
    prospect.tabletteMode ?? "non_applicable",
  );

  const canSubmit = name.trim().length > 0 && phone.trim().length > 0;
  const isSubmitEnabled = canSubmit && !isSubmitting;

  const handleSubmit = () => {
    if (!isSubmitEnabled) return;
    const patch: EditProspectPatch = {
      name: name.trim(),
      // Empty optional strings stay omitted from the patch so we never
      // write `""` over an existing value.
      siret: siret.trim() === "" ? undefined : siret.trim(),
      address: address.trim() === "" ? undefined : address.trim(),
      contactName: contactName.trim() === "" ? undefined : contactName.trim(),
      email: email.trim() === "" ? undefined : email.trim(),
      phone: phone.trim(),
      source,
      score:
        scoreRaw.trim() === ""
          ? undefined
          : Number.isFinite(Number(scoreRaw))
            ? Number(scoreRaw)
            : undefined,
      tabletteMode:
        tabletteMode === "non_applicable" ? undefined : tabletteMode,
    };
    void onSubmit(patch);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Éditer l&apos;identité du prospect</DialogTitle>
          <DialogDescription>
            Modifie les champs identité du prospect. Les champs vides ne seront
            pas écrits (le serveur conserve la valeur précédente).
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-prospect-name">Nom</Label>
            <Input
              id="edit-prospect-name"
              data-slot="edit-prospect-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-prospect-siret">SIRET</Label>
            <Input
              id="edit-prospect-siret"
              data-slot="edit-prospect-siret"
              value={siret}
              onChange={(e) => setSiret(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label htmlFor="edit-prospect-address">Adresse</Label>
            <Input
              id="edit-prospect-address"
              data-slot="edit-prospect-address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-prospect-contact-name">Contact gérant</Label>
            <Input
              id="edit-prospect-contact-name"
              data-slot="edit-prospect-contact-name"
              value={contactName}
              onChange={(e) => setContactName(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-prospect-email">Email</Label>
            <Input
              id="edit-prospect-email"
              type="email"
              data-slot="edit-prospect-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-prospect-phone">Téléphone</Label>
            <Input
              id="edit-prospect-phone"
              data-slot="edit-prospect-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label>Source</Label>
            <Select
              value={source}
              onValueChange={(next) => setSource(next as AcquisitionSource)}
            >
              <SelectTrigger data-slot="edit-prospect-source">
                <SelectValue placeholder="Source" />
              </SelectTrigger>
              <SelectContent>
                {SOURCE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="edit-prospect-score">Score</Label>
            <Input
              id="edit-prospect-score"
              data-slot="edit-prospect-score"
              inputMode="numeric"
              value={scoreRaw}
              onChange={(e) => setScoreRaw(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1 md:col-span-2">
            <Label>Mode tablette</Label>
            <Select
              value={tabletteMode}
              onValueChange={(next) =>
                setTabletteMode(next as TabletteModeValue)
              }
            >
              <SelectTrigger data-slot="edit-prospect-tablette-mode">
                <SelectValue placeholder="Mode tablette" />
              </SelectTrigger>
              <SelectContent>
                {TABLETTE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {submitError !== null ? (
          <div
            data-slot="edit-prospect-submit-error"
            className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border p-3 text-sm"
          >
            {submitError}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            data-slot="edit-prospect-cancel"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Annuler
          </Button>
          <Button
            type="button"
            data-slot="edit-prospect-submit"
            onClick={handleSubmit}
            disabled={!isSubmitEnabled}
          >
            {isSubmitting ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export type EditProspectIdentityLauncherProps = {
  prospect: Doc<"prospects">;
};

/**
 * Convex-wired wrapper — mounts the trigger button next to the identity
 * panel and threads the live mutation through to the modal.
 */
export function EditProspectIdentityLauncher({
  prospect,
}: EditProspectIdentityLauncherProps) {
  const editProspect = useMutation(api.lib.onboarding.crm.editProspect);
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (patch: EditProspectPatch) => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      await editProspect({ prospectId: prospect._id, patch });
      setOpen(false);
    } catch (error) {
      const msg = getConvexErrorMessage(error);
      setSubmitError(msg);
      toast.error(`Échec édition identité : ${msg}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) setSubmitError(null);
    setOpen(next);
  };

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-slot="edit-prospect-trigger"
        onClick={() => setOpen(true)}
      >
        <IconPencil size={16} />
        Éditer
      </Button>
      <EditProspectIdentityModal
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
