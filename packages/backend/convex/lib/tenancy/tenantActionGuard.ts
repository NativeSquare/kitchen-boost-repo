import { ConvexError, v } from "convex/values";
import { internalQuery } from "../../_generated/server";
import type { Id } from "../../_generated/dataModel";
import { getCurrentActor } from "../auth";

/**
 * B-REFUND-PUBLIC-ACTION (#221) — internal GUARD QUERY consumed by the
 * `tenantAction` wrapper (story 1.x-C sibling, this file).
 *
 * Actions have no `ctx.db` and can't call `getCurrentActor` (which needs a
 * QueryCtx / MutationCtx). The `tenantAction` wrapper re-asserts the caller's
 * tenant access by running THIS internal query through `ctx.runQuery`: the
 * query inherits the action's identity (Convex propagates the auth identity
 * across `runQuery`), so the same gate as `tenantQuery` / `tenantMutation`
 * applies — Forbidden for an inaccessible tenant, Unauthenticated for a
 * missing identity, role-not-in-allow rejected.
 *
 * Returns the normalised actor fields the action handler needs to AUDIT the
 * write with a real `actorUserId` + `actorRole` (the action's downstream
 * mutation receives them and writes the audit row in the same transaction as
 * the side effects). Kept tiny and isolated so business code never imports it
 * directly — it is invoked by the wrapper only.
 */

/** Resto-scoped roles the wrapper can be opened to (same set as tenantQuery). */
const tenantRoleValidator = v.union(
  v.literal("kb_manager"),
  v.literal("staff"),
);

const forbidden = (message: string) =>
  new ConvexError({ code: "FORBIDDEN", message: `Forbidden: ${message}` });

const unauthenticated = () =>
  new ConvexError({ code: "UNAUTHENTICATED", message: "Unauthenticated" });

/**
 * Resolve the caller, assert it can act on `tenantId` with a role in `allow`,
 * and return the audited fields the action handler needs. The role gate
 * MIRRORS `tenantQuery` / `tenantMutation` (kb_admin always passes via root
 * override; otherwise the effective role must be in `allow`).
 *
 * INTERNAL: registered by module path, exposed only to the `tenantAction`
 * wrapper via the generated `internal` reference. Reads only the GLOBAL
 * users / userTenants tables (via `getCurrentActor`, the sanctioned ADR 0011
 * point) — no raw business `ctx.db` here.
 */
export const requireTenantActor = internalQuery({
  args: {
    tenantId: v.id("tenants"),
    allow: v.array(tenantRoleValidator),
  },
  returns: v.object({
    userId: v.id("users"),
    actorRole: v.union(
      v.literal("kb_admin"),
      v.literal("kb_manager"),
      v.literal("staff"),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    userId: Id<"users">;
    actorRole: "kb_admin" | "kb_manager" | "staff";
  }> => {
    const actor = await getCurrentActor(ctx, args.tenantId);
    if (actor === null) throw unauthenticated();

    // kb_admin (root) always passes regardless of `allow` — same as the
    // tenantQuery/tenantMutation gate (story 1.x-C).
    if (actor.effectiveRole === "kb_admin") {
      return { userId: actor.userId, actorRole: "kb_admin" };
    }
    if (actor.effectiveRole === null) {
      throw forbidden("no access to this tenant");
    }
    if (!args.allow.includes(actor.effectiveRole)) {
      throw forbidden(
        `role "${actor.effectiveRole}" not permitted (requires one of: ${args.allow.join(", ")})`,
      );
    }
    return { userId: actor.userId, actorRole: actor.effectiveRole };
  },
});
