"use client";

/**
 * F-PIPELINE-CRM 07 (#256) — `ProspectIdentityPanel`.
 *
 * Pure presentational panel mounted at the top of the supervision fiche
 * (`prospect-fiche-view.tsx`). Renders the prospect's identity block:
 *   - name, SIRET, address, contact (gérant name), email, phone
 *   - phase courante (badge)
 *   - source d'acquisition
 *   - score (when set)
 *   - tabletteMode (FR label, when set)
 *
 * Pure / no Convex / no Next.js — same split discipline as
 * `ProspectCard` / `ProvisionLauncherButton`: the React-tree serializer used
 * by the vitest suite (lean `node` env, no jsdom) can expand this directly
 * without a hooks shim.
 *
 * Scope discipline (#256 hard constraint): lives under
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/_components/` only. Zero
 * touch to `apps/web`, `apps/native`, or `packages/backend/convex/`.
 */
import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Human-readable label for the canonical pipeline phase (kb-admin CONTEXT
 * « Phase pipeline », acté 2026-05-23). Local copy (NOT imported from
 * `prospect-fiche-view.tsx`) to keep this module standalone — both shells
 * stay in sync via PRD 70 §3.3 (the source of truth).
 */
const PHASE_LABEL: Record<Doc<"prospects">["phase"], string> = {
  acquisition: "Acquisition",
  preparation: "Préparation",
  installation: "Installation",
  operationnel: "Opérationnel",
};

/**
 * Subtle phase-coloured badge variant for the canonical 4 phases (operator-
 * friendly visual anchor). Falls back to `secondary` for any unknown literal
 * (defensive — the schema union should keep this exhaustive).
 */
const PHASE_BADGE_CLASS: Record<Doc<"prospects">["phase"], string> = {
  acquisition: "bg-amber-100 text-amber-900",
  preparation: "bg-blue-100 text-blue-900",
  installation: "bg-violet-100 text-violet-900",
  operationnel: "bg-emerald-100 text-emerald-900",
};

/**
 * Human label for each `acquisitionSource` literal (PRD 70 §3.3 « 4 canaux
 * d'acquisition »). Mirrors `prospect-card.tsx` — the vocabulary is shared
 * across the Kanban + fiche surfaces.
 */
const SOURCE_LABEL: Record<Doc<"prospects">["source"], string> = {
  cold_call: "Cold call",
  whatsapp: "WhatsApp",
  referral: "Référence",
  visite_physique: "Visite physique",
};

/**
 * Human label for each `tabletteMode` literal (contrat_template.md
 * Article 3 ter — Option 1 BYOD vs Option 2 KB-supplied tablet, 99 € HT).
 */
const TABLETTE_LABEL: Record<
  NonNullable<Doc<"prospects">["tabletteMode"]>,
  string
> = {
  appareil_existant: "Appareil existant (BYOD)",
  achat_kb: "Tablette achat KB (99 € HT)",
};

export type ProspectIdentityPanelProps = {
  prospect: Doc<"prospects">;
};

/**
 * Tiny labelled-row helper: renders « <Label> : <value> » only when `value`
 * is a non-empty string (prevents « SIRET : undefined » garbage in the
 * defensive test). Inlined as a local function — not exported (single
 * caller).
 */
function Row({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="break-words">{String(value)}</span>
    </div>
  );
}

export function ProspectIdentityPanel({
  prospect,
}: ProspectIdentityPanelProps) {
  return (
    <Card data-slot="prospect-identity-panel">
      <CardContent className="flex flex-col gap-4 p-4 md:p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="flex flex-col gap-1">
            <h2 className="text-xl font-bold">{prospect.name}</h2>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs">Phase :</span>
              <Badge
                variant="secondary"
                className={PHASE_BADGE_CLASS[prospect.phase]}
                data-slot="prospect-identity-phase"
              >
                {PHASE_LABEL[prospect.phase]}
              </Badge>
            </div>
          </div>
          <div className="flex flex-col gap-1 md:items-end">
            <span className="text-muted-foreground text-xs">Source</span>
            <span className="text-sm font-medium">
              {SOURCE_LABEL[prospect.source]}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Row label="SIRET" value={prospect.siret} />
          <Row label="Téléphone" value={prospect.phone} />
          <Row label="Email" value={prospect.email} />
          <Row label="Contact gérant" value={prospect.contactName} />
          <Row label="Adresse" value={prospect.address} />
          <Row label="Score" value={prospect.score} />
          {prospect.tabletteMode !== undefined ? (
            <Row
              label="Mode tablette"
              value={TABLETTE_LABEL[prospect.tabletteMode]}
            />
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
