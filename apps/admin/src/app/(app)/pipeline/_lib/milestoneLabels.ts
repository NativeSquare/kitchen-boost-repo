/**
 * F-PIPELINE-CRM 06 (#262) — FR labels for milestone keys, scoped to the
 * Kanban surfaces (BypassConfirmDialog + future helpers).
 *
 * Mirror of the labels embedded in `milestoneChecklistModel.ts →
 * MILESTONE_CATALOG` (same FR wording as the fiche checklist — PRD 70 §3.3).
 * Kept as a tiny lookup table here so the dialog doesn't have to import the
 * fiche-side catalog (different surfaces, distinct responsibilities).
 *
 * If the backend `gates.ts` grows a new key, the dialog falls back to the
 * raw key — defensive but visible: the operator sees something flagged
 * instead of an empty bullet, and the missing entry surfaces immediately in
 * the next QA pass.
 */

const LABELS: Readonly<Record<string, string>> = {
  // Closing (PRD 70 §3.3 → Préparation gate)
  contratSigne: "Contrat signé",
  kbisRecu: "KBIS reçu",
  pieceIdentiteRecue: "Pièce d'identité reçue",
  ribRecu: "RIB reçu",
  factureTablettePayee: "Facture tablette payée",

  // Préparation gate binary milestones (PRD 70 §3.3 → Installation gate)
  menuImporte: "Menu KB importé en DB",
  photosEmballagesRecues: "Photos emballages reçues",
};

/**
 * Returns the FR label for a milestone key. Falls back to the raw key when
 * unknown (defensive — see module header).
 */
export function labelForMilestoneKey(key: string): string {
  return LABELS[key] ?? key;
}
