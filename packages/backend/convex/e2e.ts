/* eslint-disable kitchenboost/no-untenanted-query --
 * This file is dev-only seed helpers, NEVER imported from business code (see
 * docstring below). The intentional `ctx.db.*` bypass of the ADR 0010 tenancy
 * wrappers is the whole point — we're seeding fresh users / tenants / invites
 * BEFORE the wrappers have anything to gate. The rule's
 * SANCTIONED_CTX_DB_PATHS allowlist exempts the wrappers themselves, the
 * webhook ledger, etc.; we don't fit any of those buckets, so the local
 * disable is the cleanest way to document intent without modifying the
 * shared eslint config for one dev utility. */

/**
 * E2E seed helpers — manual end-to-end testing of the apps/admin shell.
 *
 * NOT production code. Lives at the convex root (not lib/) on purpose: it's a
 * dev-only utility that intentionally bypasses the ADR 0010 tenancy wrappers
 * (direct `ctx.db` access). Do NOT import it from business code.
 *
 * The apps/admin shell is invitation-only (no /signup page). Bootstrap
 * therefore goes through the existing `accept-invite` flow, which goes through
 * Convex Auth's `signIn("password", { flow: "signUp" })` — the only sanctioned
 * way to create users + `authAccounts` rows in this template.
 *
 * Workflow (orchestrator session 3, E2E-A1 → A5):
 *   1. `npx convex run e2e:bootstrapE2EInvites '{adminEmail, managerEmail, customerEmail}'`
 *      → returns 3 URLs `/accept-invite?token=...`.
 *   2. Open each URL in the browser, create a password (same for all 3 is fine).
 *      The existing `acceptInvite` mutation stamps `role: "kb_admin"` on all 3
 *      (its current default behaviour, B-AUTH-3 extension is not wired yet).
 *      Log out between each (avatar menu).
 *   3. `npx convex run e2e:seedE2EAuthAccounts '{adminEmail, managerEmail, customerEmail}'`
 *      → corrects the roles (admin stays kb_admin, manager+customer drop to
 *      customer) + creates 2 tenants + attaches manager to tenant1.
 *   4. Run the E2E-A1 → A5 checks in the browser using the right account.
 *   5. Optional reset:
 *      `npx convex run e2e:wipeE2EAuthAccounts '{adminEmail, managerEmail, customerEmail}'`
 *      → drops roles to `customer`, removes the test tenants/links, removes the
 *      seed invites + the system seed user.
 *
 * Idempotent: re-running each command wipes prior state before re-creating it.
 */

import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function findUserByEmailOrThrow(
  ctx: QueryCtx | MutationCtx,
  email: string,
  label: string,
): Promise<Doc<"users">> {
  const user = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", email))
    .first();
  if (user === null) {
    throw new ConvexError({
      message: `${label} user not found for email '${email}'. Sign in once via magic-link OTP in apps/admin to create the user row first.`,
    });
  }
  return user;
}

async function upsertActiveTenantBySlug(
  ctx: MutationCtx,
  body: { slug: string; name: string; siret: string },
): Promise<Id<"tenants">> {
  const existing = await ctx.db
    .query("tenants")
    .withIndex("by_slug", (q) => q.eq("slug", body.slug))
    .unique();
  if (existing !== null) {
    // Force status to active and refresh name/siret in case the seed shape
    // evolved between runs.
    await ctx.db.patch(existing._id, {
      name: body.name,
      siret: body.siret,
      status: "active",
    });
    return existing._id;
  }
  return ctx.db.insert("tenants", {
    slug: body.slug,
    name: body.name,
    siret: body.siret,
    status: "active",
    createdAt: Date.now(),
  });
}

async function wipeUserAttachments(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const links = await ctx.db
    .query("userTenants")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  for (const link of links) {
    await ctx.db.delete(link._id);
  }
  return links.length;
}

// -----------------------------------------------------------------------------
// bootstrapE2EInvites — step 1: create 3 adminInvites rows with known tokens
// -----------------------------------------------------------------------------

/** Email of the "system" user used as `invitedBy` for seeded invites. Never
 *  loginable (no authAccount row) — pure referent. */
const SEED_SYSTEM_USER_EMAIL = "__e2e_seed_system__@kb.test";

async function getOrCreateSystemSeedUser(
  ctx: MutationCtx,
): Promise<Id<"users">> {
  const existing = await ctx.db
    .query("users")
    .withIndex("email", (q) => q.eq("email", SEED_SYSTEM_USER_EMAIL))
    .first();
  if (existing !== null) return existing._id;
  // Insert a bare user row. No authAccount, no userTenants — never loginable,
  // never appears in any role-scoped query. Purely a referent for invitedBy.
  return ctx.db.insert("users", {
    email: SEED_SYSTEM_USER_EMAIL,
    name: "E2E Seed System (not loginable)",
    role: "kb_admin",
  });
}

/**
 * Step 1 of the E2E auth bootstrap: insert 3 `adminInvites` rows for the given
 * emails, each with a deterministic token, so Alex can open the 3
 * `/accept-invite?token=...` URLs and complete the signup via Convex Auth's
 * official `signIn("password", { flow: "signUp" })` flow.
 *
 * Side effects:
 *   - Creates the system seed user (`__e2e_seed_system__@kb.test`) if absent.
 *   - Deletes any existing invite for these 3 emails (idempotence).
 *   - Inserts 3 fresh invites with `expiresAt = now + 7d` (or `expiresInDays`).
 *
 * After Alex completes the 3 accept-invite flows, the 3 users will have role
 * `kb_admin` (the current `acceptInvite` behaviour). Run
 * `seedE2EAuthAccounts` next to correct the roles + add tenants.
 */
export const bootstrapE2EInvites = internalMutation({
  args: {
    adminEmail: v.string(),
    managerEmail: v.string(),
    customerEmail: v.string(),
    baseUrl: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
  },
  returns: v.object({
    systemSeedUserId: v.id("users"),
    adminAcceptUrl: v.string(),
    managerAcceptUrl: v.string(),
    customerAcceptUrl: v.string(),
    adminInviteId: v.id("adminInvites"),
    managerInviteId: v.id("adminInvites"),
    customerInviteId: v.id("adminInvites"),
  }),
  handler: async (ctx, args) => {
    const systemSeedUserId = await getOrCreateSystemSeedUser(ctx);

    // Wipe any existing invite for each email (idempotence).
    for (const email of [
      args.adminEmail,
      args.managerEmail,
      args.customerEmail,
    ]) {
      const existing = await ctx.db
        .query("adminInvites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect();
      for (const inv of existing) await ctx.db.delete(inv._id);
    }

    const expiresAt =
      Date.now() + (args.expiresInDays ?? 7) * 24 * 60 * 60 * 1000;

    // Deterministic-but-unique tokens (timestamp suffix avoids collision across
    // runs while keeping them URL-safe and copy-pasteable).
    const ts = Date.now().toString(36);
    const adminToken = `e2e-admin-${ts}`;
    const managerToken = `e2e-manager-${ts}`;
    const customerToken = `e2e-customer-${ts}`;

    const adminInviteId = await ctx.db.insert("adminInvites", {
      email: args.adminEmail,
      name: "E2E Admin",
      token: adminToken,
      invitedBy: systemSeedUserId,
      expiresAt,
    });
    const managerInviteId = await ctx.db.insert("adminInvites", {
      email: args.managerEmail,
      name: "E2E Manager",
      token: managerToken,
      invitedBy: systemSeedUserId,
      expiresAt,
    });
    const customerInviteId = await ctx.db.insert("adminInvites", {
      email: args.customerEmail,
      name: "E2E Customer",
      token: customerToken,
      invitedBy: systemSeedUserId,
      expiresAt,
    });

    const baseUrl = args.baseUrl ?? "http://localhost:3000";
    return {
      systemSeedUserId,
      adminInviteId,
      managerInviteId,
      customerInviteId,
      adminAcceptUrl: `${baseUrl}/accept-invite?token=${adminToken}`,
      managerAcceptUrl: `${baseUrl}/accept-invite?token=${managerToken}`,
      customerAcceptUrl: `${baseUrl}/accept-invite?token=${customerToken}`,
    };
  },
});

// -----------------------------------------------------------------------------
// seedE2EAuthAccounts
// -----------------------------------------------------------------------------

/**
 * Configure 3 existing user rows + 2 tenants + 1 userTenants link for the
 * E2E-A1 → A5 manual test checklist. The 3 emails MUST already exist as `users`
 * rows (sign in once via magic-link to create them).
 *
 * After running:
 *   - adminEmail  → role: "kb_admin", no userTenants row
 *   - managerEmail → role: "customer", 1 active userTenants link to tenant1 (kb_manager)
 *   - customerEmail → role: "customer", no userTenants row
 *   - tenant1 (slug `test-t1`) and tenant2 (slug `test-t2`) exist with status `active`
 *
 * tenant2 is NOT linked to anyone — it's used by E2E-A4 to test the cross-tenant
 * redirect (KB Manager attaché à T1 tape `/t/<T2>/...` → redirect vers T1).
 */
export const seedE2EAuthAccounts = internalMutation({
  args: {
    adminEmail: v.string(),
    managerEmail: v.string(),
    customerEmail: v.string(),
    tenantSlug1: v.optional(v.string()),
    tenantName1: v.optional(v.string()),
    tenantSlug2: v.optional(v.string()),
    tenantName2: v.optional(v.string()),
  },
  returns: v.object({
    adminUserId: v.id("users"),
    managerUserId: v.id("users"),
    customerUserId: v.id("users"),
    tenant1Id: v.id("tenants"),
    tenant2Id: v.id("tenants"),
    managerLinkId: v.id("userTenants"),
    wipedAttachmentsManager: v.number(),
    wipedAttachmentsCustomer: v.number(),
  }),
  handler: async (ctx, args) => {
    const admin = await findUserByEmailOrThrow(ctx, args.adminEmail, "admin");
    const manager = await findUserByEmailOrThrow(
      ctx,
      args.managerEmail,
      "manager",
    );
    const customer = await findUserByEmailOrThrow(
      ctx,
      args.customerEmail,
      "customer",
    );

    // 1. Roles
    await ctx.db.patch(admin._id, { role: "kb_admin" });
    await ctx.db.patch(manager._id, { role: "customer" });
    await ctx.db.patch(customer._id, { role: "customer" });

    // 2. Tenants (idempotent upsert by slug)
    const tenant1Id = await upsertActiveTenantBySlug(ctx, {
      slug: args.tenantSlug1 ?? "test-t1",
      name: args.tenantName1 ?? "Test Restaurant 1",
      siret: "00000000000001",
    });
    const tenant2Id = await upsertActiveTenantBySlug(ctx, {
      slug: args.tenantSlug2 ?? "test-t2",
      name: args.tenantName2 ?? "Test Restaurant 2",
      siret: "00000000000002",
    });

    // 3. Wipe pre-existing attachments on manager + customer to guarantee a
    // clean slate (idempotence on re-run).
    const wipedAttachmentsManager = await wipeUserAttachments(ctx, manager._id);
    const wipedAttachmentsCustomer = await wipeUserAttachments(
      ctx,
      customer._id,
    );

    // 4. Manager → tenant1 as kb_manager. Customer stays un-attached.
    const managerLinkId = await ctx.db.insert("userTenants", {
      userId: manager._id,
      tenantId: tenant1Id,
      role: "kb_manager",
      attachedAt: Date.now(),
      attachedBy: admin._id,
    });

    return {
      adminUserId: admin._id,
      managerUserId: manager._id,
      customerUserId: customer._id,
      tenant1Id,
      tenant2Id,
      managerLinkId,
      wipedAttachmentsManager,
      wipedAttachmentsCustomer,
    };
  },
});

// -----------------------------------------------------------------------------
// inspectE2EState — debug helper
// -----------------------------------------------------------------------------

/**
 * Dump the state of the 3 E2E accounts + the 2 test tenants. Useful to check
 * the seed worked and to diagnose `getSession` behaviour mid-test.
 */
export const inspectE2EState = internalQuery({
  args: {
    adminEmail: v.string(),
    managerEmail: v.string(),
    customerEmail: v.string(),
  },
  returns: v.object({
    admin: v.union(
      v.null(),
      v.object({
        userId: v.id("users"),
        email: v.optional(v.string()),
        role: v.optional(v.string()),
        attachmentsCount: v.number(),
      }),
    ),
    manager: v.union(
      v.null(),
      v.object({
        userId: v.id("users"),
        email: v.optional(v.string()),
        role: v.optional(v.string()),
        attachments: v.array(
          v.object({
            tenantId: v.id("tenants"),
            tenantSlug: v.string(),
            tenantName: v.string(),
            tenantStatus: v.string(),
            role: v.string(),
            detached: v.boolean(),
          }),
        ),
      }),
    ),
    customer: v.union(
      v.null(),
      v.object({
        userId: v.id("users"),
        email: v.optional(v.string()),
        role: v.optional(v.string()),
        attachmentsCount: v.number(),
      }),
    ),
    testTenants: v.array(
      v.object({
        tenantId: v.id("tenants"),
        slug: v.string(),
        name: v.string(),
        status: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    async function loadUser(email: string) {
      const u = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      return u;
    }

    async function loadAttachments(userId: Id<"users">) {
      const links = await ctx.db
        .query("userTenants")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      return links;
    }

    const adminUser = await loadUser(args.adminEmail);
    const managerUser = await loadUser(args.managerEmail);
    const customerUser = await loadUser(args.customerEmail);

    const admin =
      adminUser === null
        ? null
        : {
            userId: adminUser._id,
            email: adminUser.email,
            role: adminUser.role,
            attachmentsCount: (await loadAttachments(adminUser._id)).length,
          };

    const customer =
      customerUser === null
        ? null
        : {
            userId: customerUser._id,
            email: customerUser.email,
            role: customerUser.role,
            attachmentsCount: (await loadAttachments(customerUser._id)).length,
          };

    let manager = null as null | {
      userId: Id<"users">;
      email: string | undefined;
      role: string | undefined;
      attachments: Array<{
        tenantId: Id<"tenants">;
        tenantSlug: string;
        tenantName: string;
        tenantStatus: string;
        role: string;
        detached: boolean;
      }>;
    };
    if (managerUser !== null) {
      const links = await loadAttachments(managerUser._id);
      const attachments: Array<{
        tenantId: Id<"tenants">;
        tenantSlug: string;
        tenantName: string;
        tenantStatus: string;
        role: string;
        detached: boolean;
      }> = [];
      for (const link of links) {
        const tenant = await ctx.db.get(link.tenantId);
        if (tenant === null) continue;
        attachments.push({
          tenantId: link.tenantId,
          tenantSlug: tenant.slug,
          tenantName: tenant.name,
          tenantStatus: tenant.status,
          role: link.role,
          detached: link.detachedAt !== undefined,
        });
      }
      manager = {
        userId: managerUser._id,
        email: managerUser.email,
        role: managerUser.role,
        attachments,
      };
    }

    const tenantsByTestSlug = [];
    for (const slug of ["test-t1", "test-t2"]) {
      const t = await ctx.db
        .query("tenants")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (t === null) continue;
      tenantsByTestSlug.push({
        tenantId: t._id,
        slug: t.slug,
        name: t.name,
        status: t.status,
      });
    }

    return { admin, manager, customer, testTenants: tenantsByTestSlug };
  },
});

// -----------------------------------------------------------------------------
// wipeE2EAuthAccounts — reset between runs
// -----------------------------------------------------------------------------

/**
 * Reset E2E state. Cleans up everything that `bootstrapE2EInvites` +
 * `seedE2EAuthAccounts` created:
 *   - roles dropped to "customer" on the 3 emails
 *   - userTenants links of the 3 emails removed
 *   - test tenants (`test-t1`, `test-t2`) deleted (+ any lingering links to them)
 *   - adminInvites rows for the 3 emails deleted
 *   - the system seed user (`__e2e_seed_system__@kb.test`) deleted
 *
 * The 3 main user rows + their authAccounts are LEFT ALONE — Convex Auth manages
 * those and removing them safely requires its own flow. To re-test from
 * scratch, change the email addresses or manually delete via the Convex
 * dashboard.
 */
export const wipeE2EAuthAccounts = internalMutation({
  args: {
    adminEmail: v.string(),
    managerEmail: v.string(),
    customerEmail: v.string(),
  },
  returns: v.object({
    wipedAttachments: v.number(),
    deletedTestTenants: v.number(),
    deletedInvites: v.number(),
    deletedSeedUsers: v.number(),
  }),
  handler: async (ctx, args) => {
    let wipedAttachments = 0;
    for (const email of [
      args.adminEmail,
      args.managerEmail,
      args.customerEmail,
    ]) {
      const user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      if (user === null) continue;
      await ctx.db.patch(user._id, { role: "customer" });
      wipedAttachments += await wipeUserAttachments(ctx, user._id);
    }

    let deletedTestTenants = 0;
    for (const slug of ["test-t1", "test-t2"]) {
      const tenant = await ctx.db
        .query("tenants")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (tenant === null) continue;
      // Safety: also clean any lingering userTenants links to this tenant.
      const links = await ctx.db
        .query("userTenants")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
        .collect();
      for (const link of links) await ctx.db.delete(link._id);
      await ctx.db.delete(tenant._id);
      deletedTestTenants += 1;
    }

    let deletedInvites = 0;
    for (const email of [
      args.adminEmail,
      args.managerEmail,
      args.customerEmail,
    ]) {
      const invites = await ctx.db
        .query("adminInvites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect();
      for (const inv of invites) {
        await ctx.db.delete(inv._id);
        deletedInvites += 1;
      }
    }

    let deletedSeedUsers = 0;
    const seedUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", SEED_SYSTEM_USER_EMAIL))
      .first();
    if (seedUser !== null) {
      await ctx.db.delete(seedUser._id);
      deletedSeedUsers = 1;
    }

    return {
      wipedAttachments,
      deletedTestTenants,
      deletedInvites,
      deletedSeedUsers,
    };
  },
});
