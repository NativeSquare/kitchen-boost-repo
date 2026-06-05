import type { RefusalReason } from "../../table/orders";

/**
 * ADR 0019 — PURE template builder for the `refund_issued` client push body
 * (PRD 80 §1 trigger 6). Aucune lecture Convex, aucun I/O ; testé en isolation
 * (vitest) pour qu'on puisse régressioner le wording sans booter le dispatcher
 * web-push (qui hardcode aujourd'hui `{title: "KitchenBoost"}` faute de
 * templating V1 — chantier 2.7).
 *
 * Trois branches :
 *
 *  - `reason === "autre"` + `customReason` (trimmé, ≥ 1 char) ⇒
 *    `"Désolé, votre commande a été refusée. Motif : ${customReason}"`
 *    (ADR 0019 décision A : le label "Autre" disparaît au profit du texte
 *    libre saisi par le restaurateur ; le client lit directement la précision).
 *
 *  - `reason` ∈ enum (rupture / fermeture / surcharge) ⇒
 *    `"Désolé, votre commande a été refusée. Motif : <label>."`
 *    (le label suit `decideRefusalReasonLabel` côté front pour garder l'UX
 *    cohérente — historique + push parlent la même langue).
 *
 *  - `reason` absent OU `autre` sans `customReason` valide (data corruption
 *    ou auto_expired ADR 0016) ⇒ texte neutre sans mention de motif. PRD 20
 *    §6b — le timeout système n'a pas à blâmer le resto, signal opérationnel
 *    non visible côté client.
 *
 * Le builder est tolérant côté input : un `customReason` fourni avec un motif
 * enum est silencieusement ignoré (le backend ne le stocke pas pour ces
 * motifs, mais on garde la fonction safe contre une malformation amont).
 */

export type RefundIssuedPushBodyInput = {
  /** L'un des 4 motifs fermés, ou absent (auto_expired / data corruption). */
  reason?: RefusalReason;
  /** Texte libre 1-280 chars, set iff `reason === "autre"`. */
  customReason?: string;
};

const NEUTRAL_BODY =
  "Désolé, votre commande n'a pas pu être traitée. Vous avez été remboursé.";

/**
 * Label French pour chaque motif enum — aligné 1:1 sur
 * `decideRefusalReasonLabel` côté front (apps/native). Dupliqué ici plutôt
 * qu'importé depuis le front pour ne pas introduire un import inverse
 * (front → backend ne traverse jamais à l'inverse).
 */
function enumLabel(reason: Exclude<RefusalReason, "autre">): string {
  switch (reason) {
    case "rupture":
      return "Rupture de stock";
    case "fermeture":
      return "Fermeture impromptue";
    case "surcharge":
      return "Surcharge cuisine";
  }
}

export function decideRefundIssuedPushBody(
  input: RefundIssuedPushBodyInput,
): string {
  if (input.reason === undefined) return NEUTRAL_BODY;

  if (input.reason === "autre") {
    const trimmed = (input.customReason ?? "").trim();
    if (trimmed.length === 0) {
      // Defensive : le backend n'émet jamais ce shape (validateCustomReason
      // throws), mais data corruption / auto_expired neutre tombe ici.
      return NEUTRAL_BODY;
    }
    return `Désolé, votre commande a été refusée. Motif : ${trimmed}`;
  }

  // Motifs enum (rupture / fermeture / surcharge) — le customReason éventuel
  // est silencieusement ignoré (catch-all par design, ADR 0019).
  return `Désolé, votre commande a été refusée. Motif : ${enumLabel(input.reason)}.`;
}
