import type { Condition } from "@packages/shared/pricing";

/**
 * 2.4-B — pure contradiction detector for a rule's conditions (PRD 35
 * §"Edge cases": a rule whose conditions can never all be true must be refused
 * at save). Conditions are AND-ed by the engine, so a contradiction makes the
 * rule dead — it would never match any order, silently confusing the resto.
 *
 * Pure function over the SAME `Condition[]` type the engine
 * (`@packages/shared/pricing`, #29) evaluates, so schema, engine and this
 * validator stay aligned. Returns a human-readable reason when a contradiction
 * is found (used in the thrown error), else `null`.
 *
 * V1 detects the two structurally-decidable contradiction classes that map to
 * the documented case and its boolean twin:
 *  - a numeric range whose lower bound exceeds its upper bound, on the two
 *    threshold conditions (`total_panier` cents, `nombre_cmds_client` count) —
 *    e.g. `total_panier >= 50 € AND <= 30 €` (the canonical PRD example);
 *  - a boolean condition (`premiere_cmd_client`) asserted both true and false.
 * We do NOT over-reach into satisfiable-but-odd combinations (e.g. two
 * `contient_item` on different items — both CAN be in one cart).
 */

/** The numeric/threshold condition kinds that carry a gte/lte bound. */
type ThresholdKind = "total_panier" | "nombre_cmds_client";

/** Pull the numeric bound out of a threshold condition, whatever its value key. */
function thresholdBound(
  condition: Condition,
): { kind: ThresholdKind; operator: "gte" | "lte"; value: number } | null {
  if (condition.kind === "total_panier") {
    return {
      kind: "total_panier",
      operator: condition.operator,
      value: condition.valueCents,
    };
  }
  if (condition.kind === "nombre_cmds_client") {
    return {
      kind: "nombre_cmds_client",
      operator: condition.operator,
      value: condition.value,
    };
  }
  return null;
}

/**
 * Inspect the conditions and return the first contradiction's reason, or `null`
 * if the set is satisfiable.
 */
export function findConditionContradiction(
  conditions: Condition[],
): string | null {
  // 1. Threshold ranges: the strongest lower bound must not exceed the strongest
  //    upper bound, per threshold kind. Equal bounds are fine (an exact match).
  const minGte: Partial<Record<ThresholdKind, number>> = {};
  const maxLte: Partial<Record<ThresholdKind, number>> = {};
  for (const condition of conditions) {
    const bound = thresholdBound(condition);
    if (bound === null) continue;
    if (bound.operator === "gte") {
      const current = minGte[bound.kind];
      minGte[bound.kind] =
        current === undefined ? bound.value : Math.max(current, bound.value);
    } else {
      const current = maxLte[bound.kind];
      maxLte[bound.kind] =
        current === undefined ? bound.value : Math.min(current, bound.value);
    }
  }
  for (const kind of ["total_panier", "nombre_cmds_client"] as const) {
    const lo = minGte[kind];
    const hi = maxLte[kind];
    if (lo !== undefined && hi !== undefined && lo > hi) {
      return `Conditions contradictoires sur ${kind} : minimum (${lo}) supérieur au maximum (${hi}).`;
    }
  }

  // 2. Boolean condition asserted both true AND false.
  let premiereSeen: boolean | undefined;
  for (const condition of conditions) {
    if (condition.kind !== "premiere_cmd_client") continue;
    if (premiereSeen === undefined) {
      premiereSeen = condition.value;
    } else if (premiereSeen !== condition.value) {
      return "Conditions contradictoires sur premiere_cmd_client : la condition est exigée à la fois vraie et fausse.";
    }
  }

  return null;
}
