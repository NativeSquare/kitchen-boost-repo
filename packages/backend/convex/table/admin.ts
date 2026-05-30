import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError, v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { adminInviteValidator } from "./adminInvites";

/**
 * Admin-invite acceptance flow, surviving slice of the legacy root-only
 * scaffold.
 *
 * History — the original scaffold shipped a full root-only admin module on
 * `apps/admin` (Users/Team CRUD, listAdmins, banUser, getUserStats…) backed
 * by this file. ADR 0014 (2026-05-27) replaced that surface with the new
 * shell architecture: a single `(app)` group whose sidebar adapts by role,
 * driven by `getSession` (`packages/backend/convex/lib/auth/getSession.ts`),
 * with NO Users/Team pages at all (§1, §56). The scaffold's queries
 * (currentAdmin, listUsers, listAdmins, getUser, updateUser, deleteUser,
 * banUser, unbanUser, inviteAdmin, listInvites, cancelInvite,
 * revokeUserSessions, getUserStats) became dead code — they were removed in
 * the cleanup that lands with this slice.
 *
 * What stays here is the bootstrap flow for KB Admin accounts themselves:
 *   - `getInvite(token)`   — UNAUTHENTICATED read used by the accept-invite
 *                            page to display the invite (recipient name +
 *                            inviter name) before sign-up.
 *   - `acceptInvite(token)` — called by the accept-invite form AFTER the
 *                             user has signed up (password + OTP) and the
 *                             Convex Auth context has propagated. Patches
 *                             the user's `role` to `"kb_admin"` and marks
 *                             the invite consumed.
 *
 * Both touch the legacy `adminInvites` table (the only invite mechanism that
 * exists today for KB Admin accounts — manager invites have their own table
 * via `userTenants` attachments). When the broader KB-side invite/admin
 * surface gets its own backend module (separate slice — provisioning &
 * onboarding of admins is its own epic), this file is expected to be folded
 * into it or replaced wholesale. Until then it stays minimal and self-
 * contained, with no cross-file dependencies beyond the schema validator.
 *
 * Note: this is the LAST sanctioned `getAuthUserId` site outside of
 * `convex/lib/auth/getCurrentActor.ts` (ADR 0011). It survives because the
 * acceptance flow is fundamentally a "stamp a role on the newly-signed-up
 * user row" operation — there is no `tenantId` to scope it against and no
 * `actor` to derive from `getCurrentActor` (the user is by definition not yet
 * a KB Admin when they call this). When the admin-onboarding epic refactors
 * this, the call must move into `getCurrentActor`'s perimeter.
 */

/**
 * Read an invite by its token. Returns the invite + the inviter's display
 * name, or `null` when the token is unknown / expired / already accepted.
 * No auth gate — the caller is, by construction, an unauthenticated visitor
 * arriving from the email link.
 */
export const getInvite = query({
  args: {
    token: v.string(),
  },
  returns: v.union(
    v.object({
      invite: adminInviteValidator,
      inviterName: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("adminInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invite) {
      return null;
    }

    // Expired → behaves like unknown (the front renders the « Invalid /
    // expired » fallback — no need to distinguish for the user).
    if (invite.expiresAt < Date.now()) {
      return null;
    }

    // Already consumed → same fallback (one-shot tokens).
    if (invite.acceptedAt) {
      return null;
    }

    const inviter = await ctx.db.get(invite.invitedBy);

    return {
      invite,
      inviterName: inviter?.name,
    };
  },
});

/**
 * Consume the invite and promote the calling user to `kb_admin`.
 *
 * Preconditions enforced by the handler:
 *   - the caller IS authenticated (the accept-invite-form guarantees this by
 *     awaiting the OTP verification + the auth-context propagation before
 *     calling — see `apps/admin/src/components/app/auth/accept-invite-form.tsx`
 *     for the full race-condition handling);
 *   - the token matches an existing, non-expired, non-consumed invite;
 *   - the authenticated user's email matches the invite's email (defence
 *     against an attacker forwarding the link to themselves and signing up
 *     with their own address).
 *
 * On success: patches `users.role = "kb_admin"` + `users.name = invite.name`,
 * stamps `adminInvites.acceptedAt = now`. Idempotent enough — replays of an
 * already-accepted token hit the « already used » branch.
 */
export const acceptInvite = mutation({
  args: {
    token: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError({
        message: "Not authenticated. Please sign up first.",
      });
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new ConvexError({ message: "User not found" });
    }

    const invite = await ctx.db
      .query("adminInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invite) {
      throw new ConvexError({ message: "Invalid invite token" });
    }

    if (invite.expiresAt < Date.now()) {
      throw new ConvexError({ message: "This invite has expired" });
    }

    if (invite.acceptedAt) {
      throw new ConvexError({ message: "This invite has already been used" });
    }

    // Defence: an attacker who reuses someone else's invite link must NOT be
    // able to claim the role under their own email. The signed-up email must
    // match the invited email exactly.
    if (user.email !== invite.email) {
      throw new ConvexError({
        message:
          "Email mismatch. Please sign up with the email address the invite was sent to.",
      });
    }

    await ctx.db.patch(userId, {
      role: "kb_admin",
      name: invite.name,
    });

    await ctx.db.patch(invite._id, {
      acceptedAt: Date.now(),
    });

    return null;
  },
});
