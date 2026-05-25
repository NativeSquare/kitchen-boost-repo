/**
 * Public API of the pure Pricing engine (ADR 0013).
 *
 * This is the ONLY surface other code imports. The engine is consumed
 * EXCLUSIVELY by the backend; `apps/web` never imports it (the front receives a
 * computed price from the API, it never holds the rules or the formula).
 */
export { engine } from "./engine.js";
export type {
  Action,
  CartItem,
  ComparisonOperator,
  Condition,
  CustomerProfile,
  JourSemaine,
  PricingInput,
  PricingResult,
  Rule,
} from "./types.js";
