import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, mutation, MutationCtx, query, QueryCtx } from "../_generated/server";
import { adminInviteValidator } from "./adminInvites";

/**
 * Helper function to verify the current user is an admin.
 * Throws an error if not authenticated or not an admin.
 */
export async function requireAdmin(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new ConvexError({ message: "Not authenticated" });
  }

  const user = await ctx.db.get(userId);
  if (!user) {
    throw new ConvexError({ message: "User not found" });
  }

  if (user.role !== "admin") {
    throw new ConvexError({ message: "Access denied. Admin role required." });
  }

  return { userId, user };
}

/**
 * Generate a secure random token for admin invites.
 */
function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 32; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

/**
 * Get the current admin user. Returns null if not authenticated or not an admin.
 * Used for auth guard on the frontend.
 */
export const currentAdmin = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.id("users"),
      _creationTime: v.number(),
      name: v.optional(v.string()),
      image: v.optional(v.string()),
      email: v.optional(v.string()),
      emailVerificationTime: v.optional(v.number()),
      phone: v.optional(v.string()),
      phoneVerificationTime: v.optional(v.number()),
      isAnonymous: v.optional(v.boolean()),
      bio: v.optional(v.string()),
      birthDate: v.optional(v.string()),
      hasCompletedOnboarding: v.optional(v.boolean()),
      role: v.optional(v.union(v.literal("user"), v.literal("admin"))),
      banned: v.optional(v.boolean()),
      banReason: v.optional(v.string()),
      banExpires: v.optional(v.number()),
    }),
    v.null()
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const user = await ctx.db.get(userId);
    if (!user) return null;

    if (user.role !== "admin") return null;

    return user;
  },
});

/**
 * List all users with pagination. Admin only.
 */
export const listUsers = query({
  args: {
    paginationOpts: paginationOptsValidator,
  },
  // returns: v.object({
  //   page: v.array(
  //     v.object({
  //       _id: v.id("users"),
  //       _creationTime: v.number(),
  //       name: v.optional(v.string()),
  //       image: v.optional(v.string()),
  //       email: v.optional(v.string()),
  //       emailVerificationTime: v.optional(v.number()),
  //       phone: v.optional(v.string()),
  //       phoneVerificationTime: v.optional(v.number()),
  //       isAnonymous: v.optional(v.boolean()),
  //       bio: v.optional(v.string()),
  //       birthDate: v.optional(v.string()),
  //       hasCompletedOnboarding: v.optional(v.boolean()),
  //       role: v.optional(v.union(v.literal("user"), v.literal("admin"))),
  //     })
  //   ),
  //   isDone: v.boolean(),
  //   continueCursor: v.string(),
  //   pageStatus: v.union(v.literal("SplitRecommended"), v.literal("SplitRequired"), v.null()),
  //   splitCursor: v.union(v.string(), v.null()),
  // }),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const results = await ctx.db
      .query("users")
      .order("desc")
      .paginate(args.paginationOpts);

    return results;
  },
});

/**
 * Get user statistics for the admin dashboard. Admin only.
 */
export const getUserStats = query({
  args: {},
  returns: v.object({
    totalUsers: v.number(),
    verifiedUsers: v.number(),
    adminUsers: v.number(),
    recentUsers: v.number(),
  }),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const allUsers = await ctx.db.query("users").collect();

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    const stats = {
      totalUsers: allUsers.length,
      verifiedUsers: allUsers.filter((u) => u.emailVerificationTime).length,
      adminUsers: allUsers.filter((u) => u.role === "admin").length,
      recentUsers: allUsers.filter((u) => u._creationTime > sevenDaysAgo).length,
    };

    return stats;
  },
});

// =============================================================================
// Admin Invite System
// =============================================================================

/**
 * Invite a new admin. Sends an email with an invite link. Admin only.
 */
export const inviteAdmin = mutation({
  args: {
    email: v.string(),
    name: v.string(),
  },
  returns: v.id("adminInvites"),
  handler: async (ctx, args) => {
    const { userId } = await requireAdmin(ctx);

    // Check if user already exists with this email
    const existingUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", args.email))
      .first();

    if (existingUser) {
      throw new ConvexError({ message: "A user with this email already exists" });
    }

    // Check if there's already a pending invite for this email
    const existingInvite = await ctx.db
      .query("adminInvites")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .first();

    if (existingInvite && !existingInvite.acceptedAt && existingInvite.expiresAt > Date.now()) {
      throw new ConvexError({ message: "An invite has already been sent to this email" });
    }

    // Delete expired invite if it exists
    if (existingInvite) {
      await ctx.db.delete(existingInvite._id);
    }

    // Create the invite
    const token = generateToken();
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    const inviteId = await ctx.db.insert("adminInvites", {
      email: args.email,
      name: args.name,
      token,
      invitedBy: userId,
      expiresAt,
    });

    // Schedule email sending
    await ctx.scheduler.runAfter(0, internal.emails.sendAdminInviteEmail, {
      to: args.email,
      name: args.name,
      token,
    });

    return inviteId;
  },
});

/**
 * Get invite details by token. Used on the accept-invite page.
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
    v.null()
  ),
  handler: async (ctx, args) => {
    const invite = await ctx.db
      .query("adminInvites")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();

    if (!invite) {
      return null;
    }

    // Check if expired
    if (invite.expiresAt < Date.now()) {
      return null;
    }

    // Check if already accepted
    if (invite.acceptedAt) {
      return null;
    }

    // Get inviter name
    const inviter = await ctx.db.get(invite.invitedBy);

    return {
      invite,
      inviterName: inviter?.name,
    };
  },
});

/**
 * List all pending admin invites. Admin only.
 */
export const listInvites = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("adminInvites"),
      _creationTime: v.number(),
      email: v.string(),
      name: v.string(),
      expiresAt: v.number(),
      inviterName: v.optional(v.string()),
    })
  ),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const now = Date.now();
    const invites = await ctx.db.query("adminInvites").collect();

    // Filter to only pending (not accepted, not expired)
    const pendingInvites = invites.filter(
      (invite) => !invite.acceptedAt && invite.expiresAt > now
    );

    // Enrich with inviter names
    const result = await Promise.all(
      pendingInvites.map(async (invite) => {
        const inviter = await ctx.db.get(invite.invitedBy);
        return {
          _id: invite._id,
          _creationTime: invite._creationTime,
          email: invite.email,
          name: invite.name,
          expiresAt: invite.expiresAt,
          inviterName: inviter?.name,
        };
      })
    );

    return result;
  },
});

/**
 * Cancel/delete a pending admin invite. Admin only.
 */
export const cancelInvite = mutation({
  args: {
    inviteId: v.id("adminInvites"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const invite = await ctx.db.get(args.inviteId);
    if (!invite) {
      throw new ConvexError({ message: "Invite not found" });
    }

    if (invite.acceptedAt) {
      throw new ConvexError({ message: "Cannot cancel an already accepted invite" });
    }

    await ctx.db.delete(args.inviteId);
    return null;
  },
});

/**
 * Accept an admin invite. Called after the user has signed up via the auth system.
 * This sets the user's role to admin and marks the invite as accepted.
 */
export const acceptInvite = mutation({
  args: {
    token: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Get the currently authenticated user
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new ConvexError({ message: "Not authenticated. Please sign up first." });
    }

    const user = await ctx.db.get(userId);
    if (!user) {
      throw new ConvexError({ message: "User not found" });
    }

    // Validate the invite token
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

    // Verify the email matches
    if (user.email !== invite.email) {
      throw new ConvexError({
        message: "Email mismatch. Please sign up with the email address the invite was sent to.",
      });
    }

    // Set the user's role to admin
    await ctx.db.patch(userId, {
      role: "admin",
      name: invite.name,
    });

    // Mark the invite as accepted
    await ctx.db.patch(invite._id, {
      acceptedAt: Date.now(),
    });

    return null;
  },
});

// =============================================================================
// User Management CRUD
// =============================================================================

const userValidator = v.object({
  _id: v.id("users"),
  _creationTime: v.number(),
  name: v.optional(v.string()),
  image: v.optional(v.string()),
  email: v.optional(v.string()),
  emailVerificationTime: v.optional(v.number()),
  phone: v.optional(v.string()),
  phoneVerificationTime: v.optional(v.number()),
  isAnonymous: v.optional(v.boolean()),
  bio: v.optional(v.string()),
  birthDate: v.optional(v.string()),
  hasCompletedOnboarding: v.optional(v.boolean()),
  role: v.optional(v.union(v.literal("user"), v.literal("admin"))),
  banned: v.optional(v.boolean()),
  banReason: v.optional(v.string()),
  banExpires: v.optional(v.number()),
});

/**
 * Get a single user by ID. Admin only.
 */
export const getUser = query({
  args: {
    userId: v.id("users"),
  },
  returns: v.union(userValidator, v.null()),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    return await ctx.db.get(args.userId);
  },
});

/**
 * Update a user's information. Admin only.
 */
export const updateUser = mutation({
  args: {
    userId: v.id("users"),
    updates: v.object({
      name: v.optional(v.string()),
      bio: v.optional(v.string()),
      role: v.optional(v.union(v.literal("user"), v.literal("admin"))),
    }),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireAdmin(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError({ message: "User not found" });
    }

    // Prevent admin from demoting themselves
    if (args.userId === adminId && args.updates.role === "user") {
      throw new ConvexError({ message: "You cannot demote yourself" });
    }

    await ctx.db.patch(args.userId, args.updates);
    return null;
  },
});

/**
 * Delete a user and their associated auth data. Admin only.
 */
export const deleteUser = mutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireAdmin(ctx);

    // Prevent admin from deleting themselves
    if (args.userId === adminId) {
      throw new ConvexError({ message: "You cannot delete your own account from the admin panel" });
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError({ message: "User not found" });
    }

    // Delete all auth sessions for this user
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }

    // Delete all auth accounts for this user
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId))
      .collect();
    for (const account of accounts) {
      await ctx.db.delete(account._id);
    }

    // Delete the user document
    await ctx.db.delete(args.userId);

    return null;
  },
});

/**
 * List all admin users. Admin only.
 */
export const listAdmins = query({
  args: {},
  returns: v.array(userValidator),
  handler: async (ctx) => {
    await requireAdmin(ctx);

    const allUsers = await ctx.db.query("users").collect();
    return allUsers.filter((user) => user.role === "admin");
  },
});

// =============================================================================
// User Banning
// =============================================================================

/**
 * Ban a user, preventing them from signing in and revoking all active sessions.
 * Optionally specify a reason and expiration duration.
 */
export const banUser = mutation({
  args: {
    userId: v.id("users"),
    banReason: v.optional(v.string()),
    banExpiresIn: v.optional(v.number()), // duration in seconds, undefined = permanent
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { userId: adminId } = await requireAdmin(ctx);

    // Prevent banning yourself
    if (args.userId === adminId) {
      throw new ConvexError({ message: "You cannot ban yourself" });
    }

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError({ message: "User not found" });
    }

    // Prevent banning other admins
    if (user.role === "admin") {
      throw new ConvexError({ message: "You cannot ban another admin" });
    }

    // Compute ban expiration timestamp
    const banExpires = args.banExpiresIn
      ? Date.now() + args.banExpiresIn * 1000
      : undefined;

    // Update user with ban fields
    await ctx.db.patch(args.userId, {
      banned: true,
      banReason: args.banReason,
      banExpires,
    });

    // Schedule session revocation with a short delay so the client
    // can detect the ban and show an alert before being signed out
    await ctx.scheduler.runAfter(
      3000,
      internal.table.admin.revokeUserSessions,
      { userId: args.userId }
    );

    return null;
  },
});

/**
 * Internal mutation to revoke all sessions for a user.
 * Used by banUser via scheduler to allow a brief window for the client
 * to detect the ban before sessions are deleted.
 */
export const revokeUserSessions = internalMutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", args.userId))
      .collect();
    for (const session of sessions) {
      await ctx.db.delete(session._id);
    }
    return null;
  },
});

/**
 * Remove the ban from a user, allowing them to sign in again.
 */
export const unbanUser = mutation({
  args: {
    userId: v.id("users"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireAdmin(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) {
      throw new ConvexError({ message: "User not found" });
    }

    if (!user.banned) {
      throw new ConvexError({ message: "User is not banned" });
    }

    // Clear all ban fields
    await ctx.db.patch(args.userId, {
      banned: undefined,
      banReason: undefined,
      banExpires: undefined,
    });

    return null;
  },
});
