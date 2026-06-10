import {
  customMutation,
  customQuery,
} from "convex-helpers/server/customFunctions";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  type MutationCtx,
  type QueryCtx,
  mutation,
  query,
} from "../../_generated/server";
import { type Actor, getCurrentActor } from "../auth";

/**
 * 1.x-D — client-side tenancy wrappers, built on the same foundation as the pro
 * wrappers (1.x-C `withTenant.ts`): the single sanctioned identity point
 * `getCurrentActor` (ADR 0011) and 100 % applicative isolation (ADR 0010).
 *
 *  - `customerQuery` / `customerMutation` — require the GLOBAL role `customer`;
 *    `tenantId` is an EXPLICIT argument (the customer is a guest eater on a given
 *    tenant's PWA, with no `userTenants` row). They throw `Unauthenticated` for
 *    an anonymous caller and `Forbidden` for any PRO (kb_admin / kb_manager /
 *    staff). The handler ctx gains `{ actor, tenantId }` and ONLY ever sees the
 *    CALLER's own `actor.userId`, so the self-scope (a customer can only reach
 *    its own data) is STRUCTURAL: no other customer's id is reachable from the
 *    handler. Phase 1 has no customer business table yet — this is the contract
 *    + structural guard that 2.1+ (Client Ordering) builds on.
 *
 *  - `publicTenantQuery` — read-only access to a tenant's PUBLIC data (e.g. the
 *    menu shown on the PWA before login). `tenantId` is required and must
 *    resolve to an existing tenant, else it throws `Forbidden`. NO pro auth —
 *    anonymous callers are allowed. The handler ctx gains `{ tenantId, tenant }`
 *    (the resolved row, so the handler doesn't re-fetch). There is deliberately
 *    NO public mutation twin: public access is read-only by construction.
 *
 * Throws are `ConvexError({ code, message })` so the frontend can branch on the
 * code; the message always contains "Forbidden" / "Unauthenticated" so tests can
 * assert on it (same convention as `withTenant.ts`).
 */

const forbidden = (message: string) =>
  new ConvexError({ code: "FORBIDDEN", message: `Forbidden: ${message}` });

const unauthenticated = () =>
  new ConvexError({ code: "UNAUTHENTICATED", message: "Unauthenticated" });

/**
 * Assert the caller is an authenticated `customer` (global role); return the
 * actor. A PRO (kb_admin / kb_manager / staff) is refused here — a customer
 * wrapper is for customers only, and the symmetric guard (a customer refused by
 * the pro wrappers) lives in `withTenant.ts` via the per-tenant effective role.
 */
async function requireCustomer(ctx: QueryCtx | MutationCtx): Promise<Actor> {
  const actor = await getCurrentActor(ctx);
  if (actor === null) throw unauthenticated();
  if (actor.role !== "customer") {
    throw forbidden("customer role required");
  }
  return actor;
}

// ---------------------------------------------------------------------------
// customer wrappers — global role `customer`, explicit tenantId, self-scoped.
// ctx += { actor, tenantId }. `tenantId` is CONSUMED by the wrapper.
// ---------------------------------------------------------------------------

export const customerQuery = customQuery(query, {
  args: { tenantId: v.id("tenants") },
  input: async (ctx, { tenantId }) => {
    const actor = await requireCustomer(ctx);
    return { ctx: { actor, tenantId }, args: {} };
  },
});

export const customerMutation = customMutation(mutation, {
  args: { tenantId: v.id("tenants") },
  input: async (ctx, { tenantId }) => {
    const actor = await requireCustomer(ctx);
    return { ctx: { actor, tenantId }, args: {} };
  },
});

/**
 * OPTIONAL auth — for queries that must work for both authenticated and
 * anonymous callers (e.g. `getCurrentCustomer` consumed by root-layout
 * components that mount BEFORE Convex Auth Anonymous signIn completes). The
 * strict `customerQuery` throws UNAUTHENTICATED, polluting Convex logs at every
 * 1st PWA visit; this variant returns `actor: null` instead, so the handler
 * decides what to render for an anonymous caller (typically: return null).
 *
 * PRO callers (kb_admin / kb_manager / staff per-tenant, but only kb_admin is
 * globally non-customer — see `requireCustomer`) are STILL refused with
 * FORBIDDEN: making the wrapper anonymous-tolerant must NOT open a back door
 * for the global root to enumerate customer-only surfaces.
 *
 * The handler ctx gains `{ actor: Actor | null, tenantId }`. Self-scope, when
 * the actor is non-null, comes the same way as `customerQuery`: the handler
 * only ever sees `ctx.actor.userId`, never another customer's id.
 *
 * NB: there is no `customerMutationOptional` on purpose. An anonymous caller
 * must not write through a customer surface — the strict `customerMutation`
 * stays the only write path, preserving the invariant that provisioning a
 * customer fiche requires a real (anonymous-auth) session.
 */
export const customerQueryOptional = customQuery(query, {
  args: { tenantId: v.id("tenants") },
  input: async (ctx, { tenantId }) => {
    const actor = await getCurrentActor(ctx);
    // PRO callers refused; anonymous (actor === null) is tolerated.
    if (actor !== null && actor.role !== "customer") {
      throw forbidden("customer role required");
    }
    return { ctx: { actor, tenantId }, args: {} };
  },
});

// ---------------------------------------------------------------------------
// publicTenant wrapper — read-only public tenant data, NO auth, valid tenantId.
// ctx += { tenantId, tenant }.
// ---------------------------------------------------------------------------

/**
 * Resolve `tenantId` to an existing tenant row, or throw `Forbidden`. A dangling
 * / unknown id is treated as inaccessible (not "404 here is the empty data"):
 * public callers learn nothing about which ids exist.
 */
async function requireTenant(
  ctx: QueryCtx | MutationCtx,
  tenantId: Id<"tenants">,
): Promise<Doc<"tenants">> {
  const tenant = await ctx.db.get(tenantId);
  if (tenant === null) throw forbidden("unknown tenant");
  return tenant;
}

export const publicTenantQuery = customQuery(query, {
  args: { tenantId: v.id("tenants") },
  input: async (ctx, { tenantId }) => {
    const tenant = await requireTenant(ctx, tenantId);
    return { ctx: { tenantId, tenant }, args: {} };
  },
});
