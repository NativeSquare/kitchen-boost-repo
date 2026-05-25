import noUntenantedQuery from "./rules/no-untenanted-query.js";

/**
 * KitchenBoost ESLint plugin.
 *
 * STATUS: ACTIVE on packages/backend (story 1.x-H). `no-untenanted-query` runs
 * as "error" on every business `convex/**` query/mutation, with the sanctioned
 * `ctx.db` access points exempted at the flat-config level (see
 * `configs.backendRecommended` below). This is the machine-enforced layer 2 of
 * the 100% applicative multi-tenant isolation (ADR 0010), backing the
 * `withTenant` helpers (layer 1) and the cross-tenant fuzz suite (layer 3).
 */
const plugin = {
  meta: { name: "kitchenboost", version: "0.0.0" },
  rules: {
    "no-untenanted-query": noUntenantedQuery,
  },
  configs: {},
};

/**
 * The ONLY sanctioned places raw `ctx.db` is allowed (ADR 0010, grill 1.x
 * decisions C/D) — transverse plumbing / GLOBAL (non-tenant-scoped) tables /
 * generated code / tests, NOT tenant-scoped business data. Path-based by design:
 * new business modules (the 2.x code this gates) get NO escape hatch and must go
 * through `tenantQuery` / `tenantMutation` / `kbAdminQuery`.
 */
const SANCTIONED_CTX_DB_PATHS = [
  // The tenancy wrappers themselves ARE the sanctioned `ctx.db` access path.
  "convex/lib/tenancy/**",
  // The single sanctioned identity point (getCurrentActor, ADR 0011): reads the
  // GLOBAL users / userTenants tables to resolve the actor.
  "convex/lib/auth/**",
  // Transverse webhook idempotence ledger — the GLOBAL processedWebhookEvents
  // table, not tenant-scoped business data (STACK.md §5.2).
  "convex/lib/webhooks/**",
  // Per-tenant credential storage + envelope crypto: `ctx.db` here runs INSIDE
  // tenant wrappers (scoped by ctx.tenantId), the sanctioned secrets path
  // (STACK.md §2.5).
  "convex/lib/crypto/**",
  // Template foundation CRUD on the GLOBAL users / customers / admin tables
  // (owned by Convex Auth, not tenant-scoped). Conformed where it mattered (the
  // unguarded role-escalation footgun was removed in 1.x-A); the remaining raw
  // access is the sanctioned global-table foundation.
  "convex/table/**",
  // Template generic CRUD generator (global tables).
  "convex/utils/**",
  // Generated code.
  "convex/_generated/**",
  // Tests: convex-test drives raw `ctx.db` via `t.run((ctx) => …)` to seed /
  // assert state — that is the test harness, not business code.
  "convex/**/*.test.ts",
];

/**
 * Flat-config block spread into `packages/backend/eslint.config.mjs` to ACTIVATE
 * the rule:
 *
 *   import kb from "@packages/eslint-config-kitchenboost";
 *   export default [...kb.configs.backendRecommended];
 *
 * `no-untenanted-query` fires as `error` on raw `ctx.db.{query,get,insert,patch,
 * replace,delete}` in business `convex/**` code, exempting only
 * `SANCTIONED_CTX_DB_PATHS`.
 */
plugin.configs.backendRecommended = [
  {
    files: ["convex/**/*.ts"],
    ignores: SANCTIONED_CTX_DB_PATHS,
    plugins: { kitchenboost: plugin },
    rules: { "kitchenboost/no-untenanted-query": "error" },
  },
];

export default plugin;
