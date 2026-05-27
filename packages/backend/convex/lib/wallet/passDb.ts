import { ConvexError, v } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import { internalMutation } from "../../_generated/server";
import { customerQuery } from "../tenancy/customer";
import {
  getOrCreateCustomerFiche,
  getTenantById,
  insertWalletPass,
  logAudit,
  readCustomerFicheByUser,
} from "../tenancy";
import { WALLET_PASS_TYPE_IDENTIFIER } from "./_constants";

/**
 * 2.8-A — the QUERY + MUTATION half of the Wallet pass generation, kept OUT of the
 * `"use node"` action file (`generatePass.ts`): Convex forbids queries/mutations in
 * a `"use node"` module. The action orchestrates the SIGNING (Node crypto +
 * `passkit-generator`); these are the DB seams it calls (`ctx.runQuery` /
 * `ctx.runMutation`).
 *
 * Both go through the sanctioned `lib/tenancy` seam (the GLOBAL `walletPasses` +
 * `customers` tables carry no `tenantId`, ADR 0010); identity is sourced only via
 * the customer wrapper's `getCurrentActor` (ADR 0011).
 */

/** The self-scoped context the action signs + persists a pass for. */
export type OwnPassContext = {
  userId: Id<"users">;
  customerId: Id<"customers">;
  /** The visible brand resto name (last ordered), or null if none yet. */
  brandTenantName: string | null;
  /** The brand resto id stored as the `lastBrandTenantId` usage, or null. */
  brandTenantId: Id<"tenants"> | null;
};

/**
 * Customer-scoped guard: resolve the caller's OWN customer fiche and, if a
 * `brandTenantId` is supplied, validate it resolves to a real tenant and return its
 * name for the visible branding (the last resto ordered, a USAGE — ADR 0003).
 * Self-scoped (`customerQuery`): a PRO / anonymous caller is rejected by the
 * wrapper, keyed on `ctx.actor.userId` — so a card is only ever generated for the
 * caller's own fiche (ADR 0010, the mandatory cross-tenant fuzz target).
 */
export const resolveOwnPassContext = customerQuery({
  args: { brandTenantId: v.optional(v.id("tenants")) },
  returns: v.object({
    userId: v.id("users"),
    customerId: v.id("customers"),
    brandTenantName: v.union(v.string(), v.null()),
    brandTenantId: v.union(v.id("tenants"), v.null()),
  }),
  handler: async (ctx, args): Promise<OwnPassContext> => {
    const fiche = await readCustomerFicheByUser(ctx, ctx.actor.userId);
    if (fiche === null) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "No customer fiche; order at least once first.",
      });
    }

    let brandTenantName: string | null = null;
    let brandTenantId: Id<"tenants"> | null = null;
    if (args.brandTenantId !== undefined) {
      const tenant = await getTenantById(ctx, args.brandTenantId);
      if (tenant === null) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Unknown brand tenant.",
        });
      }
      brandTenantName = tenant.name;
      brandTenantId = tenant._id;
    }

    return {
      userId: ctx.actor.userId,
      customerId: fiche._id,
      brandTenantName,
      brandTenantId,
    };
  },
});

/**
 * INTERNAL — persist the freshly-generated pass + audit it (US 24). System-side
 * write ordered AFTER the signing in the action. Reaches the GLOBAL `walletPasses`
 * table ONLY through the sanctioned `lib/tenancy` seam (`insertWalletPass`), never
 * raw `ctx.db` (ADR 0010). Re-resolves the OWN fiche by userId (silent
 * provisioning, ADR 0008) so a never-provisioned customer still gets a fiche.
 */
export const recordGeneratedPass = internalMutation({
  args: {
    userId: v.id("users"),
    serialNumber: v.string(),
    brandTenantId: v.optional(v.id("tenants")),
  },
  returns: v.id("walletPasses"),
  handler: async (ctx, args): Promise<Id<"walletPasses">> => {
    const customerId = await getOrCreateCustomerFiche(ctx, args.userId);
    const passId = await insertWalletPass(ctx, {
      serialNumber: args.serialNumber,
      passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
      customerId,
      lastBrandTenantId: args.brandTenantId,
    });
    await logAudit(ctx, {
      actorUserId: args.userId,
      actorRole: "customer",
      action: "wallet.pass.generate",
      tenantId: args.brandTenantId,
      targetType: "walletPass",
      targetId: args.serialNumber,
      metadata: { passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER },
    });
    return passId;
  },
});
