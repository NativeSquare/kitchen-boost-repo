import { describe, expect, it } from "vitest";
import { decideRefundIssuedPushBody } from "./refundIssuedTemplate";

/**
 * ADR 0019 — pure template builder for the `refund_issued` push body (PRD 80
 * §1 trigger 6). Pure : aucune lecture Convex, aucun I/O ; pinned par cette
 * suite vitest pour qu'on puisse régressioner le wording sans booter le
 * dispatcher web-push.
 *
 * Règles (ADR 0019) :
 *  - `reason: "autre"` + `customReason` ⇒ `"Désolé, votre commande a été refusée. Motif : ${customReason}"` (label "Autre" disparaît, seul le texte libre apparaît).
 *  - `reason: "autre"` SANS `customReason` ⇒ ne devrait pas arriver (le backend
 *    throws avant) mais on garde un fallback neutre déterministe.
 *  - `reason: "rupture" | "fermeture" | "surcharge"` ⇒ `"Désolé, votre commande a été refusée. Motif : <label>."` (label = decideRefusalReasonLabel équivalent côté backend).
 *  - `reason` absent / système (`auto_expired` neutre) ⇒ template neutre sans
 *    mention de motif (le système n'a pas à blâmer le resto).
 */

describe("decideRefundIssuedPushBody — reason: 'autre' + customReason", () => {
  it("formate 'Motif : ${customReason}' (sans label 'Autre' — ADR 0019 décision A)", () => {
    expect(
      decideRefundIssuedPushBody({
        reason: "autre",
        customReason: "ratatouille brûlée",
      }),
    ).toBe("Désolé, votre commande a été refusée. Motif : ratatouille brûlée");
  });

  it("texte libre court accepté tel quel", () => {
    expect(
      decideRefundIssuedPushBody({
        reason: "autre",
        customReason: "panne frigo",
      }),
    ).toBe("Désolé, votre commande a été refusée. Motif : panne frigo");
  });

  it("trim le customReason (alignement backend qui trim aussi)", () => {
    expect(
      decideRefundIssuedPushBody({
        reason: "autre",
        customReason: "  ratatouille brûlée  ",
      }),
    ).toBe("Désolé, votre commande a été refusée. Motif : ratatouille brûlée");
  });
});

describe("decideRefundIssuedPushBody — reason enum (rupture / fermeture / surcharge)", () => {
  it("rupture → 'Motif : Rupture de stock' (label enum, comportement inchangé)", () => {
    expect(decideRefundIssuedPushBody({ reason: "rupture" })).toBe(
      "Désolé, votre commande a été refusée. Motif : Rupture de stock.",
    );
  });

  it("fermeture → 'Motif : Fermeture impromptue'", () => {
    expect(decideRefundIssuedPushBody({ reason: "fermeture" })).toBe(
      "Désolé, votre commande a été refusée. Motif : Fermeture impromptue.",
    );
  });

  it("surcharge → 'Motif : Surcharge cuisine'", () => {
    expect(decideRefundIssuedPushBody({ reason: "surcharge" })).toBe(
      "Désolé, votre commande a été refusée. Motif : Surcharge cuisine.",
    );
  });

  it("rupture ignore un customReason fourni (régression — pas de fuite)", () => {
    // Les 3 motifs enum n'ont jamais à propager un customReason (le backend
    // ne le stocke pas). Le builder reste tolérant : un customReason fourni
    // avec un motif enum est silencieusement ignoré.
    expect(
      decideRefundIssuedPushBody({
        reason: "rupture",
        customReason: "ignored",
      }),
    ).toBe("Désolé, votre commande a été refusée. Motif : Rupture de stock.");
  });
});

describe("decideRefundIssuedPushBody — fallback neutre (auto_expired ou customReason manquant)", () => {
  it("reason absent (template neutre — auto_expired ADR 0016)", () => {
    // PRD 20 §6b — le timeout système 5 min envoie un push neutre sans
    // mention de motif (le resto n'est pas blâmé pour un signal opérationnel).
    expect(decideRefundIssuedPushBody({})).toBe(
      "Désolé, votre commande n'a pas pu être traitée. Vous avez été remboursé.",
    );
  });

  it("reason: 'autre' SANS customReason ⇒ fallback neutre (le backend throws avant, defensive)", () => {
    // Le backend ne devrait jamais émettre ce shape (validateCustomReason le
    // refuse). Si un event row arrive sans customReason (data corruption), le
    // template tombe sur le wording neutre plutôt que d'afficher "Motif : ".
    expect(decideRefundIssuedPushBody({ reason: "autre" })).toBe(
      "Désolé, votre commande n'a pas pu être traitée. Vous avez été remboursé.",
    );
  });

  it("reason: 'autre' + customReason vide (defensive) ⇒ fallback neutre", () => {
    expect(
      decideRefundIssuedPushBody({ reason: "autre", customReason: "   " }),
    ).toBe(
      "Désolé, votre commande n'a pas pu être traitée. Vous avez été remboursé.",
    );
  });
});
