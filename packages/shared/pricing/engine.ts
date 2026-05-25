import type {
  Action,
  Condition,
  JourSemaine,
  PricingInput,
  PricingResult,
  Rule,
} from "./types.js";

/**
 * Pure Pricing engine (PRD 35_pricing_engine.md, ADR 0013).
 *
 * Deterministic, side-effect-free function: `evaluate(input) -> result`. No
 * Convex, no DB, no I/O, no tenant scope — it is consumed exclusively by the
 * backend. All money is in integer cents (see types.ts) so the invariant
 * `client + resto = gross` holds exactly with integer arithmetic.
 */

const DAY_INDEX_TO_CODE: readonly JourSemaine[] = [
  "DI", // getDay() === 0
  "LU",
  "MA",
  "ME",
  "JE",
  "VE",
  "SA",
];

/** Minutes since midnight for a "HH:MM" string. */
function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

/** Is a single condition satisfied by the input? */
function conditionMatches(condition: Condition, input: PricingInput): boolean {
  switch (condition.kind) {
    case "total_panier":
      return condition.operator === "gte"
        ? input.totalPanierCents >= condition.valueCents
        : input.totalPanierCents <= condition.valueCents;

    case "premiere_cmd_client":
      return input.customer.isFirstOrder === condition.value;

    case "nombre_cmds_client":
      return condition.operator === "gte"
        ? input.customer.orderCount >= condition.value
        : input.customer.orderCount <= condition.value;

    case "plage_horaire": {
      const minutes =
        input.orderDateTime.getHours() * 60 + input.orderDateTime.getMinutes();
      // Boundaries inclusive on both ends.
      return (
        minutes >= hhmmToMinutes(condition.start) &&
        minutes <= hhmmToMinutes(condition.end)
      );
    }

    case "jour_semaine": {
      const code = DAY_INDEX_TO_CODE[input.orderDateTime.getDay()];
      return code !== undefined && condition.days.includes(code);
    }

    case "contient_item":
      return input.items.some(
        (item) =>
          (condition.itemId !== undefined &&
            item.itemId === condition.itemId) ||
          (condition.category !== undefined &&
            item.category === condition.category),
      );
  }
}

/** A rule matches iff ALL its conditions are true (AND). Empty = matches. */
function ruleMatches(rule: Rule, input: PricingInput): boolean {
  return rule.conditions.every((c) => conditionMatches(c, input));
}

/**
 * The share (in cents) of the gross delivery cost the restaurant absorbs for a
 * given action, before capping. The percentage action is computed on the cart
 * total (not on the delivery cost), and rounded to the nearest cent for a
 * deterministic integer result.
 */
function restoShareRaw(action: Action, input: PricingInput): number {
  switch (action.kind) {
    case "livraison_offerte_resto":
      return input.grossDeliveryCostCents;
    case "frais_livraison_part_resto_fixe":
      return action.valueCents;
    case "frais_livraison_part_resto_pourcentage_panier":
      return Math.round((input.totalPanierCents * action.percent) / 100);
  }
}

/**
 * The client/resto split for a matching rule, with the resto share capped to
 * [0, gross] so the client never pays below 0 and the resto never absorbs more
 * than the gross cost. Guarantees `client + resto = gross`.
 */
function splitFor(
  rule: Rule,
  input: PricingInput,
): { clientCents: number; restoCents: number } {
  const raw = restoShareRaw(rule.action, input);
  const restoCents = Math.max(0, Math.min(raw, input.grossDeliveryCostCents));
  return {
    clientCents: input.grossDeliveryCostCents - restoCents,
    restoCents,
  };
}

export const engine = {
  /**
   * Evaluate the active rules against an order and return the winning rule plus
   * the delivery-fee split. Among matching rules, the winner is the one that
   * MINIMISES the client fee (= maximises the resto's absorbed share), chosen
   * deterministically regardless of array order. No rule matches -> fallback:
   * the client pays the full gross cost. On an exact tie, the first matching
   * rule encountered keeps the win (deterministic for a given rule set).
   */
  evaluate(input: PricingInput): PricingResult {
    let winner: PricingResult | null = null;

    for (const rule of input.rules) {
      if (!ruleMatches(rule, input)) continue;

      const { clientCents, restoCents } = splitFor(rule, input);
      if (winner === null || clientCents < winner.fraisLivraisonClientCents) {
        winner = {
          winningRuleId: rule.id,
          fraisLivraisonClientCents: clientCents,
          fraisLivraisonRestoCents: restoCents,
        };
      }
    }

    // Fallback (no rule matched): the client pays the full gross cost.
    return (
      winner ?? {
        winningRuleId: null,
        fraisLivraisonClientCents: input.grossDeliveryCostCents,
        fraisLivraisonRestoCents: 0,
      }
    );
  },
};
