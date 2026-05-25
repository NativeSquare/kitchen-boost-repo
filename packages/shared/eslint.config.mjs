import tsParser from "@typescript-eslint/parser";

/**
 * Lint config for the @packages/shared TypeScript sources (the pure Pricing
 * engine, ADR 0013). The KitchenBoost `no-untenanted-query` rule deliberately
 * does NOT apply here: this package is a pure, side-effect-free, non-Convex
 * module — there is no `ctx.db` and no tenant scope to guard. The guardrail we
 * enforce instead is that nothing in `pricing/` reaches into Convex (kept pure
 * by construction + the typecheck against a Convex-free tsconfig).
 */
export default [
  {
    ignores: ["node_modules/**", "constants.js"],
  },
  {
    files: ["pricing/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "off",
    },
  },
];
