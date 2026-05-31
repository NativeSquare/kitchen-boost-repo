/**
 * F-PRICING-1 (#241) — Centralised French label maps for the pricing rule
 * condition and action kinds (PRD 35 §1 / PRD 70 §4.6).
 *
 * SOURCE OF TRUTH for the FR copy of the 6 V1 conditions + 3 V1 actions —
 * shared between slice 1 (the read-only list, this story) and slices 2-5
 * (the builder, upcoming). One map, no duplication.
 *
 * The maps are KEYED on the backend `kind` literal (closed list, mirrored
 * from `packages/backend/convex/table/pricingRules.ts`). The shape stays a
 * `Record<Kind, string>` so a missed kind fails at type-check rather than
 * silently rendering `undefined` at the UI.
 *
 * Anti-jargon (PRD 70 §4.6 grilling): labels are written for the gérant,
 * not for a developer — concrete French, no abbreviation, no "OR / GTE"
 * leaking. Numeric / range arguments are formatted by `format-rule.ts`,
 * not assembled here.
 */

import type {
  PricingAction,
  PricingCondition,
} from "@packages/backend/convex/table/pricingRules";

/** All 6 V1 condition kinds — the literal union derived from the schema. */
export type ConditionKind = PricingCondition["kind"];

/** All 3 V1 action kinds — the literal union derived from the schema. */
export type ActionKind = PricingAction["kind"];

/**
 * French short label for each condition kind. Used as the "category" of the
 * condition in the rule resume; the actual value (e.g. "≥ 25 €") is computed
 * by `format-rule.ts` from the persisted condition.
 */
export const CONDITION_KIND_LABELS: Record<ConditionKind, string> = {
  total_panier: "Panier",
  premiere_cmd_client: "Première commande",
  nombre_cmds_client: "Nombre de commandes",
  plage_horaire: "Plage horaire",
  jour_semaine: "Jour de la semaine",
  contient_item: "Contient un item ou une catégorie",
};

/**
 * French short label for each action kind. Used in the rule resume column AND
 * (slices 2-5) in the builder's action picker. The wording explicitly names
 * « resto » as the absorber — KB does NOT subsidise delivery in V1 (Q35-Q1).
 */
export const ACTION_KIND_LABELS: Record<ActionKind, string> = {
  livraison_offerte_resto: "Livraison offerte par le resto",
  frais_livraison_part_resto_fixe: "Part fixe absorbée par le resto",
  frais_livraison_part_resto_pourcentage_panier:
    "Part en pourcentage du panier absorbée par le resto",
};
