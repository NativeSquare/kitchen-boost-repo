# @packages/eslint-config-kitchenboost

Custom ESLint rules enforcing KitchenBoost backend conventions.

## Rules

### `no-untenanted-query`

Flags raw Convex datastore access — `ctx.db.query()`, `.get()`, `.insert()`, `.patch()`, `.replace()`, `.delete()` — in business code. Multi-tenant isolation has **no Postgres RLS** in this stack; it relies on every business query/mutation going through the tenancy helpers (`tenantQuery` / `tenantMutation` / `kbAdminQuery`). This rule is the merge-time guardrail that backs that discipline. See [ADR 0010](../../docs/adr/0010-isolation-multi-tenant-convex-applicative.md).

The sanctioned exceptions — the helper definitions themselves and generated code — are exempted at the flat-config level (`ignores`), not inside the rule.

## ⚠️ Status: scaffolded, not yet active

This package exists and is unit-tested, but the rule is **not yet wired into `packages/backend`**. Activating it would currently fail lint on the template code (`users.ts`, `admin.ts` do raw `ctx.db.query()`), whose conformance is the job of **story 1.x-A**.

To activate (do this in 1.x-A, after the `withTenant` helpers land and the template code is conformed), add to `packages/backend/eslint.config.mjs`:

```js
import kb from "@packages/eslint-config-kitchenboost";

export default [
  // ...existing backend config
  ...kb.configs.backendRecommended,
];
```

## Tests

```bash
pnpm --filter @packages/eslint-config-kitchenboost test
```
