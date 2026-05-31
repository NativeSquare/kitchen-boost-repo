"use client";

/**
 * F-CONTRATS slice 1/4 (#158) — `ContractsBlock`.
 *
 * Pure presentational block (read-only V1) mounted on the supervision fiche
 * `/pipeline/[prospectId]` (ADR 0014 §5 + amendement 2026-05-27 — la clé est
 * `prospectId`, PAS `tenantId`).
 *
 * What this block does
 * --------------------
 * Lists the contracts already generated for this prospect — one line per
 * version — with:
 *   - the **prestation** (A / B / A&B, contrat_template.md §1.3),
 *   - the **generation date** (kb-admin CONTEXT « Statut contrat » — daté),
 *   - the **lifecycle status badge** (draft / sent / signed / expired, PRD
 *     70 §3.5).
 *
 * If no contract exists yet, an explicit empty state surfaces (« Aucun
 * contrat généré pour ce prospect. »). If the Convex query is still in
 * flight, a loading shell is rendered (distinct from the empty state so
 * the user can tell « still loading » vs « zero rows »).
 *
 * V1 = read-only — DELIBERATELY no buttons
 * ----------------------------------------
 * Per PRD 70 §3.5 « Contrats V1 simplifié » (acté grilling front 2026-05-27,
 * cf. PRD 70 ligne 510) :
 *   « front = générer + iframe seulement. Envoi Odoo + tracking statut +
 *     refresh = manuel hors-app (Alex sur Odoo direct). sendContract /
 *     refreshContractStatus / expireContract non branchés au front V1. »
 *
 * And this is slice 1/4 of F-CONTRATS — even the « Générer » CTA (which
 * IS in scope V1) lives in the LATER slice 3/4 of the epic. This slice
 * delivers ONLY the read-only list. The status badge is INFORMATIVE: no
 * « Marquer signé » button, no « Rafraîchir statut », no « Envoyer Odoo ».
 *
 * RBAC
 * ----
 * The data source is `api.lib.admin.contracts.listContractsForProspect`,
 * which is exposed via `kbAdminQuery` (root-only, ADR 0010). The page's
 * upstream gate (`decideProspectFiche` → `UnauthorizedCard` for a
 * `kb_manager`, pinned in `prospect-fiche-view.test.tsx` AC3) means this
 * block is only ever mounted when the actor is an admin. The block itself
 * does NOT re-implement the refusal surface.
 *
 * Pure component, owned data upstream
 * -----------------------------------
 * Same split discipline as `MonitoringView` and `ProspectFicheView`:
 * `useQuery` lives in `page.tsx`; this component receives `contracts` as
 * a prop and stays pure-callable from vitest's `node` env (no jsdom, no
 * Convex client). The tri-state Convex contract is honoured:
 *   - `undefined` → query in-flight (loading shell)
 *   - `[]`        → resolved, no row (empty state)
 *   - `Doc[]`     → resolved, hydrated (one row per contract)
 */
import type { ReactNode } from "react";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Human-readable label for the canonical contract `prestation` (from
 * `contrat_template.md` §1.3 — the document section explicitly lists « A »,
 * « B », « A&B »).
 */
const PRESTATION_LABEL: Record<Doc<"contracts">["prestation"], string> = {
  A: "A",
  B: "B",
  A_AND_B: "A&B",
};

/**
 * Human-readable French label for the canonical contract `status` (from
 * `kb-admin/CONTEXT.md` « Statut contrat » + PRD 70 §3.5: `draft → sent →
 * signed → expired`).
 */
const STATUS_LABEL: Record<Doc<"contracts">["status"], string> = {
  draft: "Brouillon",
  sent: "Envoyé",
  signed: "Signé",
  expired: "Expiré",
};

/**
 * Distinct shadcn Badge variant per status, so the user can tell statuses
 * apart at a glance (AC «4 statuts ont chacun un rendu visuel distinct»).
 * The 4 variants are pinned by `contracts-block.test.tsx` — the test
 * asserts the SET of variants has cardinality 4, not specific values, so
 * a future palette tweak (e.g. `outline` → `ghost`) does not break the
 * pin as long as the variants remain distinct.
 */
const STATUS_BADGE_VARIANT: Record<
  Doc<"contracts">["status"],
  "secondary" | "default" | "outline" | "destructive"
> = {
  draft: "secondary", // neutral grey — not started
  sent: "default", // active accent — in flight on Odoo
  signed: "outline", // outline — terminal positive
  expired: "destructive", // destructive — terminal negative
};

/**
 * Locale-formatted generation date. Centralised so the empty state, the
 * row list, and any future re-use agree on the same `fr-FR` format. The
 * test pins only the year — exact format is implementation detail.
 */
function formatGenerationDate(timestampMs: number): string {
  // The `dateStyle: "medium"` choice (« 14 févr. 2025 ») fits a dense
  // supervision fiche row better than the long form (« 14 février 2025 »).
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(timestampMs),
  );
}

export type ContractsBlockProps = {
  /**
   * The prospect's contracts from `useQuery(api.lib.admin.contracts
   * .listContractsForProspect, ...)`, following Convex's tri-state contract:
   *   - `undefined` → query in flight (loading shell, distinct from empty).
   *   - `[]`        → query resolved, zero contracts (empty state copy).
   *   - `Doc[]`     → query resolved, hydrated (one row per contract).
   */
  contracts: Doc<"contracts">[] | undefined;
  /**
   * F-CONTRATS slice 3/4 (#174) — optional slot rendered to the right of
   * the « Contrats » heading. Used by `prospect-fiche-view.tsx` to mount
   * the `GenerateContractLauncher` trigger (« Générer contrat » CTA +
   * modal). Kept OPTIONAL so the slice-1 « V1 read-only » test matrix
   * stays green : if the slot is not provided, the block renders no
   * action button (the slice-1 « zero `<button>` » pin still holds).
   */
  headerAction?: ReactNode;
  /**
   * F-CONTRATS slice 4/4 (#185) — when wired, each contract row becomes
   * clickable; clicking calls back with that row's id so the parent can
   * re-hydrate the `ContractIframe` below the block with the chosen
   * contract's HTML. When omitted, rows stay non-interactive (the
   * slice-1 « V1 read-only » contract holds : zero `<button>` elements).
   */
  onSelectContract?: (contractId: Id<"contracts">) => void;
  /**
   * F-CONTRATS slice 4/4 (#185) — id of the contract currently displayed
   * in the `ContractIframe` below the block. The matching row carries
   * `data-active="true"` so the operator knows which version is being
   * previewed. When `undefined`, every row is `data-active="false"`
   * (« nothing selected yet » — e.g. just after page load, before any
   * generation or row click).
   */
  selectedContractId?: Id<"contracts"> | null;
};

export function ContractsBlock({
  contracts,
  headerAction,
  onSelectContract,
  selectedContractId,
}: ContractsBlockProps) {
  // The wrapper is shared across all three tri-state branches so the block
  // keeps a stable visual footprint in the fiche (no layout shift between
  // « loading » → « empty » → « N rows »).
  return (
    <section
      data-slot="contracts-block"
      className="flex flex-col gap-3 rounded-lg border p-4"
    >
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Contrats</h2>
        {headerAction !== undefined ? (
          <div data-slot="contracts-block-header-action">{headerAction}</div>
        ) : null}
      </header>
      {contracts === undefined ? (
        // Loading — distinct from the empty state so the user can tell
        // « still resolving » vs « zero rows ». The serializer test pins
        // that this copy does NOT contain « Aucun contrat généré ».
        <p className="text-muted-foreground text-sm">Chargement…</p>
      ) : contracts.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Aucun contrat généré pour ce prospect.
        </p>
      ) : (
        <ul className="flex flex-col divide-y">
          {contracts.map((c) => {
            // F-CONTRATS slice 4/4 (#185) — content shared between the
            // non-interactive (slice 1) and interactive (slice 4) branches
            // so the visual layout stays identical (the active state is
            // ONLY a background tint + data-active hook, never a layout
            // shift). Pulled out so the test matrix's « rows in the
            // non-interactive branch render no <button> » pin still holds
            // when this branch is the `<li>` path.
            const rowContent = (
              <>
                <div className="flex flex-col gap-0.5">
                  <span className="font-medium">
                    Prestation {PRESTATION_LABEL[c.prestation]}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    Généré le {formatGenerationDate(c.createdAt)}
                  </span>
                </div>
                <Badge variant={STATUS_BADGE_VARIANT[c.status]}>
                  {STATUS_LABEL[c.status]}
                </Badge>
              </>
            );

            if (onSelectContract === undefined) {
              // Slice-1 « V1 read-only » branch — rows are inert. Pinned
              // by `contracts-block.test.tsx` AC « never renders any
              // action button » (the test counts `<button>` AND looks for
              // `data-slot="contracts-block-row"`).
              return (
                <li
                  key={c._id as unknown as string}
                  className="flex items-center justify-between gap-4 py-2 text-sm"
                >
                  {rowContent}
                </li>
              );
            }

            // Slice-4 « clickable rows » branch — render the `<li>` as a
            // flex container holding a full-width `<button>` so the entire
            // row surface (text + badge) becomes the click target. The
            // button carries `type="button"` (HTML default would be
            // `submit` — would break the day this block is nested in a
            // form), the `data-slot="contracts-block-row"` marker the
            // test pin looks for, the `data-contract-id` for locating
            // specific rows, and the `data-active` flag for the active
            // state.
            const isActive =
              selectedContractId !== undefined &&
              selectedContractId !== null &&
              (selectedContractId as unknown as string) ===
                (c._id as unknown as string);
            return (
              <li key={c._id as unknown as string} className="flex">
                <button
                  type="button"
                  data-slot="contracts-block-row"
                  data-contract-id={c._id as unknown as string}
                  data-active={isActive ? "true" : "false"}
                  aria-pressed={isActive}
                  onClick={() => onSelectContract(c._id)}
                  className={cn(
                    "flex w-full items-center justify-between gap-4 rounded-sm px-2 py-2 text-left text-sm transition-colors",
                    "hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                    isActive && "bg-muted",
                  )}
                >
                  {rowContent}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
