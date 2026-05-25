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
import { logAudit } from "./audit";

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
 *
 * 1.x-G — audit log, HYBRID composition (STACK.md §6.4). The MUTATION wrappers
 * compose `logAudit` via the `onSuccess` hook of `customMutation` (runs INSIDE
 * the same transaction, only after the handler committed):
 *  - `kbAdminMutation` AUTO-logs every mutation (root actions are sensitive).
 *  - `tenantMutation` logs ONLY when the function declares `audit: true`.
 * Each function may also declare `action: "<verb>"`; it defaults to the function
 * path otherwise. Queries are never audited (read-only).
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
// Audit composition helpers (1.x-G).
// ---------------------------------------------------------------------------

/**
 * Per-function audit options, read from the `extra` keys of a wrapped function
 * definition (everything besides `args` / `returns` / `handler`):
 *  - `action` — the audited verb; falls back to a generated default.
 *  - `audit`  — `tenantMutation` opt-in (ignored by `kbAdminMutation`, which
 *    always logs).
 */
type AuditOptions = { action?: unknown; audit?: unknown };

/** Resolve the action label: the declared `action`, else a stable fallback. */
function resolveAction(extra: AuditOptions, fallback: string): string {
  return typeof extra.action === "string" && extra.action.length > 0
    ? extra.action
    : fallback;
}

/** `Id<"tenants">` if `args.tenantId` looks like one, else undefined. */
function tenantIdFromArgs(
  args: Record<string, unknown>,
): Id<"tenants"> | undefined {
  const t = args.tenantId;
  return typeof t === "string" ? (t as Id<"tenants">) : undefined;
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
  // `extra` carries the function-level audit options (action, …).
  input: async (ctx, _args, extra: AuditOptions) => {
    const actor = await requireKbAdmin(ctx);
    return {
      ctx: { actor },
      args: {},
      // Root mutations are ALWAYS audited (composition inside the wrapper). Runs
      // only after the handler committed (same transaction); a thrown/refused
      // call writes nothing.
      onSuccess: async ({ ctx: rawCtx, args }) => {
        await logAudit(rawCtx, {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: resolveAction(extra, "kbAdminMutation"),
          tenantId: tenantIdFromArgs(args),
        });
      },
    };
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

/**
 * Resto-scoped mutation builder. Same gate as `tenantQuery`. A wrapped function
 * may opt INTO the audit trail by declaring `audit: true` (and optionally
 * `action: "<verb>"`); untagged tenant mutations are NOT logged (most resto
 * writes are routine — opt-in keeps the trail signal-rich, STACK.md §6.4).
 */
export function tenantMutation(opts: { allow?: TenantRole[] } = {}) {
  const allow = opts.allow ?? DEFAULT_ALLOW;
  return customMutation(mutation, {
    args: { tenantId: v.id("tenants") },
    // `extra` carries the function-level audit options (audit, action).
    input: async (ctx, { tenantId }, extra: AuditOptions) => {
      const actor = await requireTenantAccess(ctx, tenantId, allow);
      const audited = extra.audit === true;
      return {
        ctx: { actor, tenantId },
        args: {},
        // Logged ONLY when the function opted in; runs after the handler
        // committed, in the same transaction.
        onSuccess: audited
          ? async ({ ctx: rawCtx }) => {
              await logAudit(rawCtx, {
                actorUserId: actor.userId,
                // Prefer the effective role on this tenant (kb_manager / staff /
                // kb_admin via root override), else the global role.
                actorRole: actor.effectiveRole ?? actor.role,
                action: resolveAction(extra, "tenantMutation"),
                tenantId,
              });
            }
          : undefined,
      };
    },
  });
}
