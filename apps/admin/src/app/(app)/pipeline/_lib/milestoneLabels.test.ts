/**
 * F-PIPELINE-CRM 06 (#262) — pinned French labels for the milestones the
 * BypassConfirmDialog surfaces.
 *
 * Same FR wording as `milestoneChecklistModel.ts → MILESTONE_CATALOG` (PRD
 * 70 §3.3). Pinning the lookup here keeps the dialog dependency-free of the
 * fiche checklist module (different surfaces).
 */
import { describe, expect, it } from "vitest";

import { labelForMilestoneKey } from "./milestoneLabels";

describe("labelForMilestoneKey — FR labels for bypass-dialog (#262)", () => {
  it("returns the FR label for each Closing milestone (PRD 70 §3.3)", () => {
    expect(labelForMilestoneKey("contratSigne")).toBe("Contrat signé");
    expect(labelForMilestoneKey("kbisRecu")).toBe("KBIS reçu");
    expect(labelForMilestoneKey("pieceIdentiteRecue")).toBe(
      "Pièce d'identité reçue",
    );
    expect(labelForMilestoneKey("ribRecu")).toBe("RIB reçu");
    expect(labelForMilestoneKey("factureTablettePayee")).toBe(
      "Facture tablette payée",
    );
  });

  it("returns the FR label for each Préparation gate milestone (→ Installation)", () => {
    expect(labelForMilestoneKey("menuImporte")).toBe("Menu KB importé en DB");
    expect(labelForMilestoneKey("photosEmballagesRecues")).toBe(
      "Photos emballages reçues",
    );
  });

  it("falls back to the raw key when no label is mapped (defensive)", () => {
    // Defensive — should never happen in production (the only sources are
    // the backend gates and we mirror them above). If the backend grows a
    // new gate key, the dialog still renders something instead of an empty
    // bullet — the operator sees the raw key and can flag it.
    expect(labelForMilestoneKey("someUnknownKey")).toBe("someUnknownKey");
  });
});
