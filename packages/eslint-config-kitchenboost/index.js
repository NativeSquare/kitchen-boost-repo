import noUntenantedQuery from "./rules/no-untenanted-query.js";

/**
 * KitchenBoost ESLint plugin.
 *
 * STATUS: SCAFFOLDED — NOT yet active on packages/backend.
 * Activation (turning `no-untenanted-query` to "error" on convex/**, with the
 * sanctioned helper paths exempted) is part of story 1.x-A, once the withTenant
 * helpers exist and the template code (users.ts / admin.ts) is conformed.
 * See ADR 0010 (isolation multi-tenant Convex applicative).
 */
const plugin = {
  meta: { name: "kitchenboost", version: "0.0.0" },
  rules: {
    "no-untenanted-query": noUntenantedQuery,
  },
  configs: {},
};

/**
 * Self-contained flat-config block to spread into
 * `packages/backend/eslint.config.mjs` WHEN ACTIVATING (story 1.x-A):
 *
 *   import kb from "@packages/eslint-config-kitchenboost";
 *   export default [...kb.configs.backendRecommended];
 */
plugin.configs.backendRecommended = [
  {
    files: ["convex/**/*.ts"],
    // Sanctioned exceptions: the tenancy helpers ARE the wrapper, and codegen is generated.
    ignores: ["convex/lib/tenancy/**", "convex/_generated/**"],
    plugins: { kitchenboost: plugin },
    rules: { "kitchenboost/no-untenanted-query": "error" },
  },
];

export default plugin;
