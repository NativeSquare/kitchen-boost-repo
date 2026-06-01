/**
 * F-PIPELINE-CRM 03 (#218) — `buildMilestoneChecklist`, the pure module that
 * derives the structured list of milestones applicable to a prospect from
 * `prospect.milestones` + `prospect.tabletteMode`.
 *
 * Pure (no React, no Convex, no DOM, no async, no I/O) — the React shell
 * (later: `MilestoneChecklist` component on `/pipeline/[prospectId]`) is a thin
 * adapter that renders the structured list returned here. Same discipline as
 * `prospectPhaseMover.ts` (#217) / `decideProspectFiche` / `decideProvisionLauncher`:
 * the decision is testable in vitest's `node` env, the shell is a coquille.
 *
 * What this module decides
 * ------------------------
 *  - Which binary milestones are APPLICABLE to this prospect (drops the two
 *    tablette-invoice entries unless `tabletteMode === "achat_kb"`, mirror of
 *    `requiredClosingMilestones` in `convex/lib/onboarding/pipeline.ts`).
 *  - Each milestone's PHASE (PRD 70 §3.3 "Liste exhaustive des milestones par
 *    phase"): acquisition / preparation / installation.
 *  - Each milestone's ACHIEVED state — derived from the timestamp shape of
 *    `prospect.milestones` (present ⇒ achieved at that instant), exactly like
 *    `evaluateClosing` / `missingMilestonesForPhase` read it.
 *  - Which milestones IMPACT CLOSING — the strict Closing set
 *    (`MANDATORY_CLOSING_MILESTONES` + the conditional `factureTablettePayee`
 *    when `tabletteMode === "achat_kb"`). The UI uses this flag to badge an
 *    item as "Closing" so the operator knows ticking it might auto-bascule
 *    Acquisition → Préparation.
 *
 * Out of scope (deliberately)
 * ---------------------------
 *  - The composite oscillating integrations (Stripe Connect / Uber Direct /
 *    Hubrise) — they are NOT binary milestones (`{current, history[]}` shape,
 *    cf. `convex/table/prospects.ts`) and have their own dedicated reducer
 *    (`integrationStatusReducer`, future story of the epic).
 *  - The "1ère cmd publique reçue" event for Opérationnel — not a binary
 *    prospect-stored milestone in `convex/table/prospects.ts`, same exclusion
 *    as `gates.ts`.
 *  - Bypass decision / phase transitions — that's `decidePhaseMove` (#217).
 *  - Convex / network wiring — the React shell will adapt.
 *
 * Why duplicate constants front-side
 * ----------------------------------
 * Same rule as `prospectPhaseMover.ts`: epic F-PIPELINE-CRM scope is
 * `apps/admin/src/app/(app)/pipeline/` STRICT — no touch to
 * `packages/backend/convex/`. The canonical Closing set lives in
 * `convex/lib/onboarding/pipeline.ts` (`MANDATORY_CLOSING_MILESTONES` +
 * `CONDITIONAL_TABLETTE_MILESTONE`); the canonical phase classification lives in
 * PRD 70 §3.3 + is encoded in `convex/lib/onboarding/gates.ts`. Mirroring them
 * here keeps the module dependency-free; a future slice may lift the shared
 * arrays into `packages/shared/` if more cross-package consumers appear.
 */

/** The 3 phases that own BINARY milestones (PRD 70 §3.3). Opérationnel has none. */
type Phase = "acquisition" | "preparation" | "installation";

/**
 * Shape of `prospect.tabletteMode` AS SEEN BY THIS MODULE.
 *
 * Issue #218 spec is `"achat_kb" | "appareil_existant" | "non_applicable"`,
 * but the persisted schema (`convex/table/prospects.ts`) only knows
 * `"achat_kb" | "appareil_existant"` plus `undefined` (the field is optional).
 * `"non_applicable"` is the explicit front-side sentinel for "no choice yet /
 * not applicable" — semantically identical to an absent value: both exclude
 * the conditional tablette milestones (cf. `requiredClosingMilestones`, which
 * adds the tablette milestone ONLY when `tabletteMode === "achat_kb"`).
 */
export type TabletteModeInput =
  | "achat_kb"
  | "appareil_existant"
  | "non_applicable";

/**
 * The binary-milestone subset of `prospect.milestones` (timestamp shape, cf.
 * `convex/table/prospects.ts`). The composite oscillating integration objects
 * (`stripeConnect` / `uberDirect` / `hubrise`) are deliberately NOT typed here
 * — they're out of scope (see module header).
 */
export type ProspectMilestonesInput = {
  premierContact?: number;
  rdvBooke?: number;
  devisPresente?: number;
  contratGenere?: number;
  contratEnvoyeOdoo?: number;
  contratSigne?: number;
  kbisRecu?: number;
  pieceIdentiteRecue?: number;
  ribRecu?: number;
  factureTabletteEmise?: number;
  factureTablettePayee?: number;
  photosEmballagesRecues?: number;
  menuImporte?: number;
  // Installation milestones are NOT persisted on `prospects.milestones` in the
  // current schema (the table only carries Acquisition + the 2 binary
  // Préparation ones, cf. `convex/table/prospects.ts`). They are still listed
  // by this model so the front checklist can render the full Installation
  // section as "pending" — a future schema extension will populate them.
  tabletteCommandee?: number;
  tabletteLivree?: number;
  tabletteConfiguree?: number;
  stickersQrImprimes?: number;
  visitePhysiqueJDay?: number;
  stickersQrCollesDansSacs?: number;
  stickerBoitesAppliques?: number;
  kbManagerInvite?: number;
  kbManagerLoginComplete?: number;
  testCmdInterne?: number;
};

/** A milestone entry as exposed to the UI. */
export type MilestoneEntry = {
  /** Stable machine key — matches the persisted `prospect.milestones` shape. */
  key: string;
  /** Operator-facing FR label (PRD 70 §3.3 wording). */
  label: string;
  /** Which Kanban phase the milestone belongs to. */
  phase: Phase;
  /** True iff the milestone has a timestamp on the prospect (achieved). */
  achieved: boolean;
  /** The timestamp when the milestone was achieved, if any. */
  achievedAt?: number;
  /**
   * True iff this milestone is part of the prospect's APPLICABLE Closing set
   * (composite event that auto-bascules Acquisition → Préparation). Mirror of
   * `MANDATORY_CLOSING_MILESTONES` + the conditional `factureTablettePayee`
   * when `tabletteMode === "achat_kb"` (`convex/lib/onboarding/pipeline.ts`).
   */
  impactsClosing: boolean;
};

/**
 * The mandatory Closing milestones (mirror of `MANDATORY_CLOSING_MILESTONES`
 * in `convex/lib/onboarding/pipeline.ts` — PRD 70 §3.3 / kb-admin CONTEXT
 * "Closing"). DO NOT extend without updating the backend constant first.
 */
const MANDATORY_CLOSING_KEYS = new Set<string>([
  "contratSigne",
  "kbisRecu",
  "pieceIdentiteRecue",
  "ribRecu",
]);

/**
 * The conditional Closing milestone — applies ONLY when `tabletteMode ===
 * "achat_kb"` (mirror of `CONDITIONAL_TABLETTE_MILESTONE`).
 */
const CONDITIONAL_TABLETTE_CLOSING_KEY = "factureTablettePayee";

/**
 * The catalog of binary milestones to render, in display order, grouped by
 * phase. Mirror of PRD 70 §3.3 "Liste exhaustive des milestones par phase"
 * (Acquisition + Préparation binary entries + Installation entries).
 *
 * `tabletteOnly: true` ⇒ entry is dropped unless `tabletteMode === "achat_kb"`
 * (the two conditional invoice entries from PRD 70 §3.3 Acquisition).
 */
type CatalogEntry = {
  key: keyof ProspectMilestonesInput;
  label: string;
  phase: Phase;
  tabletteOnly?: true;
};

const MILESTONE_CATALOG: readonly CatalogEntry[] = [
  // Acquisition (PRD 70 §3.3) — binary milestones in display order.
  {
    key: "premierContact",
    label: "Premier contact effectué",
    phase: "acquisition",
  },
  { key: "rdvBooke", label: "RDV booké", phase: "acquisition" },
  { key: "devisPresente", label: "Devis présenté", phase: "acquisition" },
  { key: "contratGenere", label: "Contrat généré", phase: "acquisition" },
  {
    key: "contratEnvoyeOdoo",
    label: "Contrat envoyé Odoo",
    phase: "acquisition",
  },
  { key: "contratSigne", label: "Contrat signé", phase: "acquisition" },
  { key: "kbisRecu", label: "KBIS reçu", phase: "acquisition" },
  {
    key: "pieceIdentiteRecue",
    label: "Pièce d'identité reçue",
    phase: "acquisition",
  },
  { key: "ribRecu", label: "RIB reçu", phase: "acquisition" },
  {
    key: "factureTabletteEmise",
    label: "Facture tablette émise",
    phase: "acquisition",
    tabletteOnly: true,
  },
  {
    key: "factureTablettePayee",
    label: "Facture tablette payée",
    phase: "acquisition",
    tabletteOnly: true,
  },

  // Préparation (PRD 70 §3.3) — binary prospect-stored milestones only. The
  // oscillating Stripe / Uber / Hubrise integrations are NOT in this list (own
  // reducer, future story).
  { key: "menuImporte", label: "Menu KB importé en DB", phase: "preparation" },
  {
    key: "photosEmballagesRecues",
    label: "Photos emballages reçues",
    phase: "preparation",
  },

  // Installation (PRD 70 §3.3).
  {
    key: "tabletteCommandee",
    label: "Tablette commandée",
    phase: "installation",
  },
  { key: "tabletteLivree", label: "Tablette livrée", phase: "installation" },
  {
    key: "tabletteConfiguree",
    label: "Tablette configurée mode kiosque",
    phase: "installation",
  },
  {
    key: "stickersQrImprimes",
    label: "Stickers QR imprimés",
    phase: "installation",
  },
  {
    key: "visitePhysiqueJDay",
    label: "Visite physique J-day",
    phase: "installation",
  },
  {
    key: "stickersQrCollesDansSacs",
    label: "QR stickers collés dans sacs livraison",
    phase: "installation",
  },
  {
    key: "stickerBoitesAppliques",
    label: "Sticker boîtes / packaging branding appliqué",
    phase: "installation",
  },
  {
    key: "kbManagerInvite",
    label: "kb_manager user créé + invité (lien magique)",
    phase: "installation",
  },
  {
    key: "kbManagerLoginComplete",
    label: "kb_manager user a complété login + 2FA",
    phase: "installation",
  },
  { key: "testCmdInterne", label: "Test cmd interne", phase: "installation" },
];

/**
 * Whether `key` impacts the APPLICABLE Closing set for a prospect on the given
 * tablette mode. Mirror of `requiredClosingMilestones` (no invention — same
 * canonical set as the backend).
 */
function impactsClosingFor(
  key: string,
  tabletteMode: TabletteModeInput,
): boolean {
  if (MANDATORY_CLOSING_KEYS.has(key)) return true;
  if (key === CONDITIONAL_TABLETTE_CLOSING_KEY && tabletteMode === "achat_kb") {
    return true;
  }
  return false;
}

/**
 * Derive the structured checklist of milestones applicable to a prospect.
 * Pure function — same input ⇒ same output, no side effects.
 */
export function buildMilestoneChecklist(args: {
  milestones: ProspectMilestonesInput;
  tabletteMode: TabletteModeInput;
}): MilestoneEntry[] {
  const { milestones, tabletteMode } = args;

  return MILESTONE_CATALOG.filter((entry) => {
    if (!entry.tabletteOnly) return true;
    // Conditional tablette-invoice entries — keep ONLY for `achat_kb`.
    return tabletteMode === "achat_kb";
  }).map((entry) => {
    const achievedAt = milestones[entry.key];
    return {
      key: entry.key,
      label: entry.label,
      phase: entry.phase,
      achieved: achievedAt !== undefined,
      achievedAt,
      impactsClosing: impactsClosingFor(entry.key, tabletteMode),
    };
  });
}
