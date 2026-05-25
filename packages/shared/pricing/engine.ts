import type { PricingInput, PricingResult } from "./types.js";

export const engine = {
  evaluate(_input: PricingInput): PricingResult {
    throw new Error("not implemented");
  },
};
