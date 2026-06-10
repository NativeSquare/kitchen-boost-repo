import type { Doc, Id } from "../../_generated/dataModel";
import {
  customerMutation,
  customerQueryOptional,
  insertCustomerFiche,
  readCustomerFicheByUser,
} from "../tenancy";

/**
 * 2.1-B — Anonymous Customer identity: silent provisioning of the `customers`
 * fiche on top of the Convex Auth Anonymous provider (wired in `auth.ts`).
 *
 * A customer = an anonymous `users` row (`isAnonymous = true`, global role
 * `customer`, stamped by `anonymousProfile` at sign-in) + a `customers` fiche
 * (FK `userId`). The native Convex Auth session cookie IS the device cookie
 * (ADR 0008); recognition is INTRA-resto only (each resto on its own brand
 * domain → host-only cookie). Cross-resto recognition is the Wallet pass ONLY
 * (chantier 2.8) — NOT here. There is NO `customerSessions` table and NO
 * cross-domain logic.
 *
 * Both functions are SELF-SCOPED: built on `customerMutation` / `customerQuery`,
 * whose handler ctx only ever exposes the CALLER's own `actor.userId`, and they
 * touch the GLOBAL `customers` table ONLY through the sanctioned
 * `lib/tenancy/customerFiche` seam — never raw `ctx.db` (ADR 0010). Identity is
 * resolved exclusively via `getCurrentActor` (ADR 0011): no `getAuthUserId` here.
 *
 * `tenantId` is an explicit wrapper argument (the customer is a guest eater on a
 * given resto's PWA). It is NOT stamped on the GLOBAL fiche — the per-tenant link
 * is `customerOrdersPerTenant`, written by the Orders chantier (2.3).
 */

/**
 * Silently provision (or recognise) the current anonymous customer's fiche.
 *
 * First visit on a resto/device → creates a minimal `customers` fiche linked to
 * the caller's `userId` and returns its id. Return on the SAME session → the
 * existing fiche is found via the `by_user` index and returned UNCHANGED
 * (idempotent: never a second fiche for the same user). Self-scoped: the handler
 * only ever sees `ctx.actor.userId`.
 */
export const getOrCreateCurrentCustomer = customerMutation({
  args: {},
  handler: async (ctx): Promise<Id<"customers">> => {
    const existing = await readCustomerFicheByUser(ctx, ctx.actor.userId);
    if (existing !== null) return existing._id;
    return insertCustomerFiche(ctx, ctx.actor.userId);
  },
});

/**
 * Read the current customer's OWN fiche, or `null` if not provisioned yet OR
 * if the caller is not authenticated yet.
 *
 * Built on `customerQueryOptional` (NOT the strict `customerQuery`) because
 * this query is consumed by root-layout PWA components
 * (`<IOSStandaloneHeuristicRunner>`, install prompts, wallet banners, …) that
 * mount the moment the `__Host-kb_tenant` cookie is posted — BEFORE the Convex
 * Auth Anonymous sign-in completes. Throwing UNAUTHENTICATED there used to
 * pollute Convex logs at every 1st PWA visit; returning `null` for an
 * anonymous caller is the contract those consumers actually want. PRO callers
 * are still refused with FORBIDDEN by the wrapper.
 *
 * Self-scoped when authenticated (keyed on `ctx.actor.userId`) — no other
 * customer's fiche is reachable.
 */
export const getCurrentCustomer = customerQueryOptional({
  args: {},
  handler: async (ctx): Promise<Doc<"customers"> | null> => {
    if (ctx.actor === null) return null;
    return readCustomerFicheByUser(ctx, ctx.actor.userId);
  },
});
