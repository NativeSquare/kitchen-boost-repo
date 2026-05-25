# @packages/eslint-config-kitchenboost

Custom ESLint rules enforcing KitchenBoost backend conventions.

## Rules

### `no-untenanted-query`

Flags raw Convex datastore access — `ctx.db.query()`, `.get()`, `.insert()`, `.patch()`, `.replace()`, `.delete()` — in business code. Multi-tenant isolation has **no Postgres RLS** in this stack; it relies on every business query/mutation going through the tenancy helpers (`tenantQuery` / `tenantMutation` / `kbAdminQuery`). This rule is the merge-time guardrail that backs that discipline. See [ADR 0010](../../docs/adr/0010-isolation-multi-tenant-convex-applicative.md).

The sanctioned exceptions are exempted at the flat-config level (`ignores`), not inside the rule.

## Status: active on `packages/backend`

Wired in via `packages/backend/eslint.config.mjs` (story 1.x-H):

```js
import tsParser from "@typescript-eslint/parser";
import kb from "@packages/eslint-config-kitchenboost";

export default [
  { files: ["convex/**/*.ts"], languageOptions: { parser: tsParser } },
  ...kb.configs.backendRecommended,
];
```

`configs.backendRecommended` runs the rule as `error` on `convex/**/*.ts` and
exempts the sanctioned `ctx.db` access points (the only places raw datastore
access is allowed). Documented exemptions:

| Path                   | Why exempt                                                      |
| ---------------------- | --------------------------------------------------------------- |
| `convex/lib/tenancy/`  | The wrappers themselves ARE the sanctioned access path          |
| `convex/lib/auth/`     | `getCurrentActor`, the single identity point (ADR 0011)         |
| `convex/lib/webhooks/` | Transverse idempotence ledger — GLOBAL `processedWebhookEvents` |
| `convex/lib/crypto/`   | Per-tenant credentials, `ctx.db` runs inside tenant wrappers    |
| `convex/table/`        | Template foundation CRUD on the GLOBAL users/customers tables   |
| `convex/utils/`        | Template generic CRUD generator (global tables)                 |
| `convex/_generated/`   | Generated code                                                  |
| `convex/**/*.test.ts`  | `convex-test` `t.run((ctx) => …)` harness, not business code    |

New (2.x) business modules get **no** exemption — they must route through
`tenantQuery` / `tenantMutation` / `kbAdminQuery`.

## Tests

```bash
pnpm --filter @packages/eslint-config-kitchenboost test
```
