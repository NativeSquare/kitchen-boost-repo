Closes #

## What

<!-- One paragraph: what this PR does and why. -->

## How tested

<!-- Which Vitest suites / manual checks prove it. -->

## Agent checklist (WORKFLOW.md §4–§5)

- [ ] **TDD order** — commits are `test(<id>)` → `feat(<id>)` → `refactor(<id>)`
- [ ] Tests cover the issue's acceptance criteria / Testing Decisions
- [ ] **withTenant everywhere** — no raw `ctx.db.query()` in business code (via `tenantQuery` / `tenantMutation` / `kbAdminQuery`)
- [ ] Identity only via `getCurrentActor` (no stray `getAuthUserId`) — ADR 0011
- [ ] **Cross-tenant fuzz test** added/updated if this touches `tenant_id` — ADR 0010
- [ ] **MOAT** — no query returns a raw `customer` object to role `kb_manager`
- [ ] Module exposes its API via `index.ts`; no cross-module imports bypassing it
- [ ] No invented product specs (prices/ingredients/rules not in the PRD)
- [ ] No secrets committed
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green

> If `packages/backend/convex/schema.ts` changed, add the **`needs-schema-review`** label — schema PRs require human review.
