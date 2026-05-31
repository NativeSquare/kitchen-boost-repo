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
 * Consume the invite and apply the role grant that matches its `targetRole`.
 *
 * Two acceptance shapes, discriminated on `invite.targetRole`
 * (B-AUTH-3 schema extension, branched by B-AUTH-6 #230):
 *
 *   1. **KB Admin invite** — `targetRole === "kb_admin"` OR ABSENT (legacy
 *      rows from before B-AUTH-3 carry neither `targetRole` nor `tenantId`;
 *      they're implicitly admin invites — rétrocompat 100 %).
 *      Effect: patches `users.role = "kb_admin"` + `users.name = invite.name`.
 *      No `userTenants` row (the root has no per-tenant attachment).
 *
 *   2. **KB Manager invite** — `targetRole === "kb_manager"` + `tenantId` set
 *      (issued by `lib/admin/managerInvites.ts:inviteManager`, B-AUTH-4).
 *      Effect: creates an active `userTenants(userId, tenantId,
 *      role: "kb_manager", attachedBy: invite.invitedBy)` row. The user
 *      row itself is LEFT UNTOUCHED — no `users.role` patch, no
 *      `users.name` patch (issue #230). Rationale: the gérant qualification
 *      lives entirely on the `userTenants` link; the global `users.role`
 *      stays at its sign-up default (absent → `getCurrentActor` reads it
 *      as "customer"), so an explicit `customer` patch would be a no-op
 *      semantically AND a silent contradiction of the spec ("NE PAS
 *      patcher users.role"). If a soft-detached attachment already exists
 *      on that (user, tenant), it is RE-ACTIVATED (`detachedAt → undefined`,
 *      fresh `attachedAt`) — mirrors `inviteManager`'s "detached ⇒
 *      re-invitable" rule. If an ACTIVE attachment already exists, throws
 *      « Vous êtes déjà rattaché à ce resto » so a double-click on the
 *      magic-link, or an out-of-flow attachment created by another path,
 *      surfaces loudly instead of silently no-op'ing. Throws if the
 *      linked tenant has been deleted between invite creation and
 *      acceptance, or if the manager invite is missing its `tenantId`
 *      (incoherent row — shouldn't happen given the `inviteManager`
 *      validator, but the guard is cheap and surfaces a clearer error
 *      than a Convex null-deref).
 *
 * Preconditions enforced before the role branch:
 *   - caller IS authenticated (the accept-invite form awaits OTP verif +
 *     auth-context propagation before calling — see
 *     `apps/admin/src/components/app/auth/accept-invite-form.tsx`);
 *   - the token matches an existing, non-expired, non-consumed invite;
 *   - the authenticated user's email matches `invite.email` exactly
 *     (defence: an attacker reusing someone else's magic link must not be
 *     able to claim the role under their own signed-up address).
 *
 * Stamps `adminInvites.acceptedAt = now` in BOTH branches. Replays of an
 * already-consumed token hit the "already used" guard. The
 * « déjà rattaché » throw rolls back the whole mutation including the
 * `acceptedAt` stamp — the magic-link can be replayed once the
 * conflicting attachment is cleaned up.
 *
 * History — before B-AUTH-3 wiring the mutation hard-coded
 * `role: "kb_admin"` ignoring `targetRole`, which meant ANY manager
 * invite silently promoted the recipient to root admin. The first wiring
 * (commit 5ec2906) closed that escalation by branching on `targetRole`
 * but patched `users.role = "customer"` and treated active duplicates as
 * idempotent no-ops. B-AUTH-6 (#230) tightens both: NO `users.role`
 * patch on the manager branch, and active duplicates throw.
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

    // ----- Role branch (B-AUTH-3 wiring) ------------------------------------

    if (invite.targetRole === "kb_manager") {
      // Manager invite — REQUIRES a tenantId (validator on `inviteManager`
      // already guarantees this, but we re-check for defence in depth and to
      // surface a clean error rather than a null deref on a malformed row).
      const tenantId = invite.tenantId;
      if (tenantId === undefined) {
        throw new ConvexError({
          message:
            "Manager invite is missing tenantId — invite row is incoherent.",
        });
      }

      // Tenant must still exist. A tenant deletion between invite creation
      // and acceptance is a rare-but-possible race (admin un-provisions a
      // resto while the gérant has the magic-link in their inbox); we throw
      // with a clear message rather than create a dangling userTenants row.
      const tenant = await ctx.db.get(tenantId);
      if (tenant === null) {
        throw new ConvexError({
          message:
            "The tenant associated with this invite no longer exists. Ask the admin to re-invite you.",
        });
      }

      // Issue #230 — the manager branch DOES NOT patch users.role or
      // users.name. The gérant qualification lives entirely on the
      // userTenants link below. `users.role` stays at its sign-up default
      // (absent → getCurrentActor reads it as "customer", which IS the
      // canonical global role for a manager). Patching `users.role =
      // "customer"` would be a semantic no-op AND violate the spec.

      // userTenants link: by (userId, tenantId). The `by_user_tenant`
      // compound index gives us O(1) uniqueness lookup. Three sub-cases:
      //   - no row             → fresh insert (common path);
      //   - soft-detached row  → re-activation (mirrors `inviteManager`'s
      //                          "detached ⇒ re-invitable" rule, B-AUTH-4);
      //   - active row         → throw « déjà rattaché » (double-click
      //                          safety / out-of-flow attachment defence).
      const existing = await ctx.db
        .query("userTenants")
        .withIndex("by_user_tenant", (q) =>
          q.eq("userId", userId).eq("tenantId", tenantId),
        )
        .unique();

      if (existing === null) {
        // Fresh attachment — common path.
        await ctx.db.insert("userTenants", {
          userId,
          tenantId,
          role: "kb_manager",
          attachedAt: Date.now(),
          attachedBy: invite.invitedBy,
        });
      } else if (existing.detachedAt !== undefined) {
        // Soft-detach re-activation (admin had revoked, now re-invites).
        // Bumps `attachedAt` so the revocation history is preserved if
        // needed (surfaced via auditLog) but the row is live again.
        await ctx.db.patch(existing._id, {
          detachedAt: undefined,
          attachedAt: Date.now(),
          attachedBy: invite.invitedBy,
          role: "kb_manager",
        });
      } else {
        // Active attachment already exists — surface clearly rather than
        // silently no-op. The accept-invite form is normally gated by
        // `inviteManager`'s ALREADY_MEMBER check, so this branch fires
        // only on out-of-flow attachments (manual DB inserts, parallel
        // bootstrap scripts) or on accidental double-clicks of a stale
        // magic-link. The throw rolls the WHOLE mutation back including
        // the `acceptedAt` stamp, so the magic-link can be replayed once
        // the conflicting attachment is cleaned up.
        throw new ConvexError({
          message:
            "Vous êtes déjà rattaché à ce resto. Si vous pensez qu'il s'agit d'une erreur, contactez KB.",
        });
      }
    } else {
      // Admin invite — legacy default. Covers `targetRole === "kb_admin"`
      // AND `targetRole === undefined` (pre-B-AUTH-3 rows).
      await ctx.db.patch(userId, {
        role: "kb_admin",
        name: invite.name,
      });
    }

    await ctx.db.patch(invite._id, {
      acceptedAt: Date.now(),
    });

    return null;
  },
});
