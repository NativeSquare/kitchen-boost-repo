import {
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { ConvexError, v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  mutation,
  query,
} from "../../_generated/server";
import { type Actor, getCurrentActor } from "../auth";

/**
 * 1.x-C — tenancy wrappers (root + resto), the FIRST line of defence of the
 * 100% applicative multi-tenant isolation (ADR 0010), built on the single
 * sanctioned identity point `getCurrentActor` (ADR 0011).
 *
 * Convex has no Postgres RLS, so EVERY business query/mutation must go through
 * one of these wrappers (the `no-untenanted-query` ESLint rule forbids raw
 * `ctx.db` elsewhere). Each resolves the caller's normalised `Actor`, enforces
 * access, and hands the handler an enriched ctx:
 *
 *  - `kbAdminQuery` / `kbAdminMutation` — require global role `kb_admin`; act on
 *    ANY tenant; no `tenantId` argument. ctx gains `{ actor }`.
 *  - `tenantQuery({ allow })` / `tenantMutation({ allow })` — `tenantId` is an
 *    EXPLICIT argument; throw `Forbidden` if the tenant is inaccessible OR the
 *    effective role is not in `allow` (default `["kb_manager"]`). ctx gains
 *    `{ actor, tenantId }`. A `kb_admin` always passes (root override).
 *
 * Built on `convex-helpers` `customQuery`/`customMutation` (the pattern from
 * STACK.md §5.1). Throws are `ConvexError({ code, message })` so the frontend
 * can branch on the code; the message always contains "Forbidden" /
 * "Unauthenticated" so tests can assert on it.
 */

/** Resto-scoped roles that can be granted on a tenant. */
export type TenantRole = "kb_manager" | "staff";

const forbidden = (message: string) =>
  new ConvexError({ code: "FORBIDDEN", message: `Forbidden: ${message}` });

const unauthenticated = () =>
  new ConvexError({ code: "UNAUTHENTICATED", message: "Unauthenticated" });

/** Assert the caller is an authenticated kb_admin; return the actor. */
async function requireKbAdmin(ctx: QueryCtx | MutationCtx): Promise<Actor> {
  const actor = await getCurrentActor(ctx);
  if (actor === null) throw unauthenticated();
  if (actor.role !== "kb_admin") {
    throw forbidden("kb_admin role required");
  }
  return actor;
}

/**
 * Assert the caller may act on `tenantId` with a role in `allow`; return the
 * actor (whose `effectiveRole` is resolved on that tenant). `kb_admin` is the
 * root override and always passes regardless of `allow`.
 */
async function requireTenantAccess(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
  allow: TenantRole[],
): Promise<Actor> {
  const actor = await getCurrentActor(ctx, tenantId);
  if (actor === null) throw unauthenticated();

  // Root: unlimited access to every tenant, bypasses `allow`.
  if (actor.effectiveRole === "kb_admin") return actor;

  // No (active) attachment to this tenant — inaccessible. Covers both a missing
  // row AND a revoked one (detachedAt set); getCurrentActor surfaces both as
  // effectiveRole === null.
  if (actor.effectiveRole === null) {
    throw forbidden("no access to this tenant");
  }

  // Has a resto role on the tenant, but is it permitted for THIS action?
  if (!allow.includes(actor.effectiveRole)) {
    throw forbidden(
      `role "${actor.effectiveRole}" not permitted (requires one of: ${allow.join(", ")})`,
    );
  }

  return actor;
}

// ---------------------------------------------------------------------------
// kb_admin (root) wrappers — no tenantId, act on any tenant. ctx += { actor }.
// ---------------------------------------------------------------------------

export const kbAdminQuery = customQuery(query, {
  args: {},
  input: async (ctx) => {
    const actor = await requireKbAdmin(ctx);
    return { ctx: { actor }, args: {} };
  },
});

export const kbAdminMutation = customMutation(mutation, {
  args: {},
  input: async (ctx) => {
    const actor = await requireKbAdmin(ctx);
    return { ctx: { actor }, args: {} };
  },
});

// ---------------------------------------------------------------------------
// tenant (resto) wrappers — tenantId explicit arg, allow-listed roles.
// ctx += { actor, tenantId }. `tenantId` is CONSUMED by the wrapper (it lives on
// ctx, not in the handler's business args).
// ---------------------------------------------------------------------------

const DEFAULT_ALLOW: TenantRole[] = ["kb_manager"];

/**
 * Resto-scoped query builder. `allow` lists the resto roles permitted (on top
 * of the implicit `kb_admin` root override); defaults to `["kb_manager"]`.
 */
export function tenantQuery(opts: { allow?: TenantRole[] } = {}) {
  const allow = opts.allow ?? DEFAULT_ALLOW;
  return customQuery(query, {
    args: { tenantId: v.id("tenants") },
    input: async (ctx, { tenantId }) => {
      const actor = await requireTenantAccess(ctx, tenantId, allow);
      return { ctx: { actor, tenantId }, args: {} };
    },
  });
}

/** Resto-scoped mutation builder. Same gate as `tenantQuery`. */
export function tenantMutation(opts: { allow?: TenantRole[] } = {}) {
  const allow = opts.allow ?? DEFAULT_ALLOW;
  return customMutation(mutation, {
    args: { tenantId: v.id("tenants") },
    input: async (ctx, { tenantId }) => {
      const actor = await requireTenantAccess(ctx, tenantId, allow);
      return { ctx: { actor, tenantId }, args: {} };
    },
  });
}
