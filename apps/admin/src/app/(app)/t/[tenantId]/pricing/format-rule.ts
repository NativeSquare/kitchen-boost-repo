/**
 * F-PRICING-1 (#241) — Pure formatters that turn a persisted `pricingRules`
 * row into the two human-readable FR strings the list cell shows:
 *
 *   formatConditionsSummary([…])  → "Panier ≥ 25 € · Lundi/Mardi · Première commande"
 *   formatActionSummary(action)   → "Livraison offerte par le resto"
 *                                  → "Part fixe absorbée : 2,50 €"
 *                                  → "Part absorbée : 30 % du panier"
 *
 * Why a separate module: the same FR resume will be reused by the slices 2-5
 * builder (the « modify rule » modal previews the resume live). Keeping the
 * formatters pure (no React, no Convex) lets both the list AND the builder
 * lean on one source of truth.
 *
 * Numeric formatting uses FR locale (« 12,50 €, 25 €, 30 % ») via
 * `Intl.NumberFormat("fr-FR", ...)` rather than hand-rolling decimal commas —
 * the standard library handles edge cases (rounding to 2 decimals, NBSP before
 * the unit) without us reinventing them.
 */

import type {
  PricingAction,
  PricingCondition,
} from "@packages/backend/convex/table/pricingRules";

// ---------------------------------------------------------------------------
// FR formatters (centralised so a tweak to "show 0 decimals on integer cents"
// lands in ONE place — the resume shape is shared with the upcoming builder).
// ---------------------------------------------------------------------------

const EUR_FORMATTER = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  // V1 always renders 2 decimals (consistent FR money format): `2,50 €`,
  // `25,00 €`. Tests pin both shapes (`25` is a substring of `25,00 €`, and
  // `2,50` is pinned verbatim for non-integer amounts). Centralised here so a
  // future "drop trailing zeros on round euros" tweak lands in ONE place.
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** Format integer cents as FR euros: 250 → "2,50 €", 2500 → "25 €". */
function formatEuros(cents: number): string {
  return EUR_FORMATTER.format(cents / 100);
}

/** Format an integer percent as FR percent: 30 → "30 %". */
function formatPercent(percent: number): string {
  // We use a manual format here rather than `Intl.NumberFormat({ style: "percent" })`
  // because the latter expects 0..1 fractions and we already store 0..100 ints
  // in the backend schema (cf. `pricingAction` validator).
  return `${percent} %`;
}

/** Full FR day name for each 2-letter code, used by `jour_semaine`. */
const DAY_LABELS: Record<string, string> = {
  LU: "Lundi",
  MA: "Mardi",
  ME: "Mercredi",
  JE: "Jeudi",
  VE: "Vendredi",
  SA: "Samedi",
  DI: "Dimanche",
};

/** « ≥ » / « ≤ » glyph for the schema's `gte` / `lte` operator. */
function formatOperator(op: "gte" | "lte"): string {
  return op === "gte" ? "≥" : "≤";
}

// ---------------------------------------------------------------------------
// Per-kind condition formatter.
// ---------------------------------------------------------------------------

function formatCondition(condition: PricingCondition): string {
  switch (condition.kind) {
    case "total_panier":
      return `Panier ${formatOperator(condition.operator)} ${formatEuros(condition.valueCents)}`;
    case "premiere_cmd_client":
      return condition.value ? "Première commande" : "Pas la première commande";
    case "nombre_cmds_client":
      return `${formatOperator(condition.operator)} ${condition.value} commande${condition.value > 1 ? "s" : ""}`;
    case "plage_horaire":
      return `${condition.start} – ${condition.end}`;
    case "jour_semaine":
      // Preserve the schema's listing order; fall back to the raw code if a
      // future day shows up that's not in our map (defensive — the schema
      // says it can't, but if it did, we'd rather render "XX" than crash).
      return condition.days.map((d) => DAY_LABELS[d] ?? d).join("/");
    case "contient_item":
      if (condition.category !== undefined) {
        return `Contient un item de la catégorie « ${condition.category} »`;
      }
      if (condition.itemId !== undefined) {
        // Slice 1: no menuItems join — we surface the id so the gérant can at
        // least correlate. Slice 2 (the builder) will swap to the item name.
        return `Contient l'item ${condition.itemId}`;
      }
      // Defensive: schema marks both fields optional, so a row with neither
      // could exist (would be a degenerate rule). Render something rather
      // than empty so the list cell stays parseable.
      return "Contient un item";
  }
}

/**
 * Render the FR resume of a rule's conditions. Conditions are AND-ed at
 * evaluation time, separated by « · » in the resume (issue body example).
 * Returns a non-empty fallback for the rare `[]` input — a 0-condition rule
 * matches always; render a load-bearing FR word so the cell isn't blank.
 */
export function formatConditionsSummary(
  conditions: PricingCondition[],
): string {
  if (conditions.length === 0) {
    return "Toujours (sans condition)";
  }
  return conditions.map(formatCondition).join(" · ");
}

// ---------------------------------------------------------------------------
// Per-kind action formatter.
// ---------------------------------------------------------------------------

export function formatActionSummary(action: PricingAction): string {
  switch (action.kind) {
    case "livraison_offerte_resto":
      return "Livraison offerte par le resto";
    case "frais_livraison_part_resto_fixe":
      return `Part fixe absorbée par le resto : ${formatEuros(action.valueCents)}`;
    case "frais_livraison_part_resto_pourcentage_panier":
      return `Part absorbée par le resto : ${formatPercent(action.percent)} du panier`;
  }
}
