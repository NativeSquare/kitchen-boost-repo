/**
 * Pricing engine — public types (PRD 35_pricing_engine.md, ADR 0013).
 *
 * The engine determines, for a delivery order, **who pays what** on the Uber
 * Direct delivery cost: the share billed to the client vs. the share absorbed
 * by the restaurant. It is a PURE function — no Convex, no DB, no I/O, no
 * tenant scope — consumed exclusively by the backend (ADR 0013).
 *
 * MONEY UNIT: all amounts are **integer cents** (e.g. 590 = 5,90 €). This is
 * the money unit already used elsewhere in KitchenBoost (Stripe
 * `application_fee_amount` = 240 = 2,40 € TTC). Integer arithmetic is what
 * makes the engine deterministic and keeps the invariant
 * `frais_livraison_client + frais_livraison_resto = coût brut` exact (floats
 * would drift, e.g. 5.90 - 1.20 ≠ 4.70 in IEEE-754).
 */

/** Days of the week, as used by `jour_semaine` conditions (LU…DI). */
export type JourSemaine = "LU" | "MA" | "ME" | "JE" | "VE" | "SA" | "DI";

/** Comparison operator for the numeric/threshold conditions. */
export type ComparisonOperator = "gte" | "lte";

/**
 * The 6 V1 conditions (closed list — PRD §1, CONTEXT "Condition"). All
 * conditions of a rule must be true for it to match (AND logic).
 *
 * Retired in V1 (NOT modelled): `mode_livraison` (the engine is only called in
 * delivery mode) and `distance_livraison_km` (handled upstream by Uber Direct).
 */
export type Condition =
  | { kind: "total_panier"; operator: ComparisonOperator; valueCents: number }
  | { kind: "premiere_cmd_client"; value: boolean }
  | { kind: "nombre_cmds_client"; operator: ComparisonOperator; value: number }
  | { kind: "plage_horaire"; start: string; end: string } // "HH:MM"–"HH:MM"
  | { kind: "jour_semaine"; days: JourSemaine[] } // multi-select
  | { kind: "contient_item"; category?: string; itemId?: string };

/**
 * The 3 V1 actions (closed list — PRD §1, CONTEXT "Action"). The action
 * defines the share of the gross Uber Direct cost the restaurant absorbs; the
 * client pays the remainder. Every action is capped at the gross cost (the
 * restaurant can never absorb more than the gross cost; the client can never
 * pay below 0). `livraison_offerte_client` is deliberately ABSENT — KB never
 * subsidises delivery in V1 (Q35-Q1).
 */
export type Action =
  | { kind: "livraison_offerte_resto" }
  | { kind: "frais_livraison_part_resto_fixe"; valueCents: number }
  | { kind: "frais_livraison_part_resto_pourcentage_panier"; percent: number };

/** A single configurable pricing rule: conditions (AND) + one action. */
export interface Rule {
  /** Stable identifier, surfaced in the output so the caller can trace the winning rule. */
  id: string;
  /** All conditions must be true to match. An empty array matches every delivery order. */
  conditions: Condition[];
  action: Action;
}

/** A single cart line item. */
export interface CartItem {
  itemId: string;
  category: string;
  /** Quantity ordered (≥ 1). */
  quantity: number;
}

/** The customer profile relevant to the conditions. */
export interface CustomerProfile {
  /** Is this the customer's first order? (`premiere_cmd_client` condition.) */
  isFirstOrder: boolean;
  /** Number of past orders by this customer. (`nombre_cmds_client` condition.) */
  orderCount: number;
}

/** The full evaluation input (PRD §3). Pure data — no Convex, no tenant_id. */
export interface PricingInput {
  /** Cart line items (used by `contient_item`). */
  items: CartItem[];
  /** Cart subtotal in cents (used by `total_panier` and the % action). */
  totalPanierCents: number;
  /** Order date/time. Drives `plage_horaire` and `jour_semaine`. */
  orderDateTime: Date;
  customer: CustomerProfile;
  /** Gross Uber Direct delivery cost in cents (the quote). */
  grossDeliveryCostCents: number;
  /** The set of ACTIVE rules to evaluate. */
  rules: Rule[];
}

/** The evaluation output (PRD §3). */
export interface PricingResult {
  /**
   * The winning rule's id, or `null` when no rule matched (the fallback: the
   * client pays the full gross cost).
   */
  winningRuleId: string | null;
  /** Delivery fee billed to the client, in cents. Always ≥ 0. */
  fraisLivraisonClientCents: number;
  /** Delivery fee absorbed by the restaurant, in cents. Always ≤ gross cost. */
  fraisLivraisonRestoCents: number;
}
