import tsParser from "@typescript-eslint/parser";
import kb from "@packages/eslint-config-kitchenboost";

/**
 * Backend lint config (story 1.x-H). Activates the KitchenBoost
 * `no-untenanted-query` rule as the machine-enforced layer 2 of the 100%
 * applicative multi-tenant isolation (ADR 0010): raw `ctx.db.{query,get,insert,
 * patch,replace,delete}` is forbidden in business code, which must instead go
 * through the tenancy wrappers (`tenantQuery` / `tenantMutation` / `kbAdminQuery`).
 *
 * The sanctioned `ctx.db` access points (the wrappers themselves, the
 * getCurrentActor identity point, the webhook ledger, per-tenant crypto, the
 * GLOBAL users/customers table foundation, codegen and tests) are exempted at
 * the config level — see `kb.configs.backendRecommended` in
 * `@packages/eslint-config-kitchenboost`.
 */
export default [
  // Only the Convex source tree is in scope; nothing else needs this rule.
  { ignores: ["node_modules/**", "convex/_generated/**"] },
  // Parse the TS sources so the rule's AST visitor sees `ctx.db.*` calls.
  {
    files: ["convex/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: "module",
    },
  },
  ...kb.configs.backendRecommended,
];
