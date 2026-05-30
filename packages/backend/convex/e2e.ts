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
 * Two-account model (A1 → A5):
 *   - `adminEmail`   → kb_admin, no tenant link.
 *   - `managerEmail` → customer (global), 1 active userTenants link to tenant1
 *     as `kb_manager` (the per-tenant role lives on the link, not on `users`).
 *
 * `customerEmail` is OPTIONAL — kept as an opt-in for the « customer logs in
 * to the admin shell » negative-path test (NoTenantEmptyState, A6) but NOT
 * required for A1 → A5. A customer has nothing to do in the admin app: the
 * shell is invitation-only, a customer ends up on the NoTenantEmptyState
 * screen (« Pas de resto rattaché ») with only Logout + Support CTAs — which
 * is the correct behaviour (SessionGuard, ADR 0014 §3). Don't pass it unless
 * you specifically want to test that empty-state.
 *
 * Workflow (E2E-A1 → A5):
 *   1. `npx convex run e2e:bootstrapE2EInvites '{adminEmail, managerEmail}'`
 *      → returns 2 URLs `/accept-invite?token=...` (+ a 3rd if customerEmail
 *      is also passed).
 *   2. Open each URL in the browser, create a password (same for all is fine).
 *      The existing `acceptInvite` mutation stamps `role: "kb_admin"` on
 *      every account (its current default behaviour). Log out between each
 *      (avatar menu) — or use a private window.
 *   3. `npx convex run e2e:seedE2EAuthAccounts '{adminEmail, managerEmail}'`
 *      → corrects the roles (admin stays kb_admin, manager drops to customer
 *      because the per-tenant role lives on the link) + creates 2 tenants
 *      + attaches manager to tenant1.
 *   4. Run the E2E-A1 → A5 checks in the browser using the right account.
 *   5. Optional reset:
 *      `npx convex run e2e:wipeE2EAuthAccounts '{adminEmail, managerEmail}'`
 *      → drops roles to `customer`, removes the test tenants/links, removes
 *      the seed invites + the system seed user.
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
    // Opt-in: only pass it if you specifically want to test the
    // NoTenantEmptyState negative path (A6). Not needed for A1 → A5.
    customerEmail: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
  },
  returns: v.object({
    systemSeedUserId: v.id("users"),
    adminAcceptUrl: v.string(),
    managerAcceptUrl: v.string(),
    // `null` when `customerEmail` wasn't supplied. The shape stays stable
    // across both modes (no missing keys to special-case downstream).
    customerAcceptUrl: v.union(v.string(), v.null()),
    adminInviteId: v.id("adminInvites"),
    managerInviteId: v.id("adminInvites"),
    customerInviteId: v.union(v.id("adminInvites"), v.null()),
  }),
  handler: async (ctx, args) => {
    const systemSeedUserId = await getOrCreateSystemSeedUser(ctx);

    // Wipe any existing invite for each email (idempotence). `customerEmail`
    // is treated optionally — absent means "do not seed the negative-path
    // account at all" (cf. file-header doc).
    const emailsToWipe = [args.adminEmail, args.managerEmail];
    if (args.customerEmail !== undefined) emailsToWipe.push(args.customerEmail);
    for (const email of emailsToWipe) {
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

    let customerInviteId: Id<"adminInvites"> | null = null;
    let customerAcceptUrl: string | null = null;
    const baseUrl = args.baseUrl ?? "http://localhost:3000";
    if (args.customerEmail !== undefined) {
      const customerToken = `e2e-customer-${ts}`;
      customerInviteId = await ctx.db.insert("adminInvites", {
        email: args.customerEmail,
        name: "E2E Customer",
        token: customerToken,
        invitedBy: systemSeedUserId,
        expiresAt,
      });
      customerAcceptUrl = `${baseUrl}/accept-invite?token=${customerToken}`;
    }

    return {
      systemSeedUserId,
      adminInviteId,
      managerInviteId,
      customerInviteId,
      adminAcceptUrl: `${baseUrl}/accept-invite?token=${adminToken}`,
      managerAcceptUrl: `${baseUrl}/accept-invite?token=${managerToken}`,
      customerAcceptUrl,
    };
  },
});

// -----------------------------------------------------------------------------
// seedE2EAuthAccounts
// -----------------------------------------------------------------------------

/**
 * Configure 2 (or 3) existing user rows + 2 tenants + 1 userTenants link for
 * the E2E-A1 → A5 manual test checklist. The emails MUST already exist as
 * `users` rows (sign up once via the accept-invite flow to create them).
 *
 * After running:
 *   - adminEmail   → role: "kb_admin", no userTenants row
 *   - managerEmail → role: "customer", 1 active userTenants link to tenant1
 *                    (per-tenant role: `kb_manager` — global role stays
 *                    `customer` because per-tenant roles live on the link,
 *                    not on `users`)
 *   - customerEmail (optional) → role: "customer", no userTenants row
 *                                (NoTenantEmptyState negative-path account,
 *                                only needed for A6)
 *   - tenant1 (slug `test-t1`) and tenant2 (slug `test-t2`) exist with status
 *     `active`
 *
 * tenant2 is NOT linked to anyone — it's used by E2E-A4 to test the cross-tenant
 * redirect (KB Manager attaché à T1 tape `/t/<T2>/...` → redirect vers T1).
 */
export const seedE2EAuthAccounts = internalMutation({
  args: {
    adminEmail: v.string(),
    managerEmail: v.string(),
    // Opt-in, mirrors `bootstrapE2EInvites` — only pass it if you also seeded
    // an invite for it and want to drive the A6 NoTenantEmptyState test.
    customerEmail: v.optional(v.string()),
    tenantSlug1: v.optional(v.string()),
    tenantName1: v.optional(v.string()),
    tenantSlug2: v.optional(v.string()),
    tenantName2: v.optional(v.string()),
  },
  returns: v.object({
    adminUserId: v.id("users"),
    managerUserId: v.id("users"),
    customerUserId: v.union(v.id("users"), v.null()),
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
    const customer =
      args.customerEmail !== undefined
        ? await findUserByEmailOrThrow(ctx, args.customerEmail, "customer")
        : null;

    // 1. Roles
    await ctx.db.patch(admin._id, { role: "kb_admin" });
    await ctx.db.patch(manager._id, { role: "customer" });
    if (customer !== null) {
      await ctx.db.patch(customer._id, { role: "customer" });
    }

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

    // 3. Wipe pre-existing attachments on manager (+ customer when present)
    //    to guarantee a clean slate (idempotence on re-run). 0 when the user
    //    wasn't seeded.
    const wipedAttachmentsManager = await wipeUserAttachments(ctx, manager._id);
    const wipedAttachmentsCustomer =
      customer !== null ? await wipeUserAttachments(ctx, customer._id) : 0;

    // 4. Manager → tenant1 as kb_manager. Customer (if any) stays un-attached.
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
      customerUserId: customer?._id ?? null,
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
    // Mirrors the rest of the API — opt-in. Absent → `customer: null` in the
    // result (the field stays present for shape stability).
    customerEmail: v.optional(v.string()),
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
    const customerUser =
      args.customerEmail !== undefined
        ? await loadUser(args.customerEmail)
        : null;

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
 * Fully wipe one user from all Convex Auth tables. Mirrors the public
 * `deleteAccount` mutation in `convex/table/users.ts` but covers ALL the
 * tables defined by Convex Auth (sessions, refresh tokens, verification codes,
 * accounts) so a half-completed signUp doesn't leave a fantom `authAccount`
 * blocking a retry with "Account already exists".
 *
 * Order matters: refresh tokens reference sessions, verification codes
 * reference accounts. Sessions and accounts then reference the user row.
 *
 * Tables: cf. `node_modules/@convex-dev/auth/src/server/implementation/types.ts`.
 */
async function wipeUserCompletely(
  ctx: MutationCtx,
  userId: Id<"users">,
): Promise<void> {
  // 1. authSessions for this user, and the authRefreshTokens that point to
  //    each session (indexed by sessionId).
  const sessions = await ctx.db
    .query("authSessions")
    .withIndex("userId", (q) => q.eq("userId", userId))
    .collect();
  for (const session of sessions) {
    const refreshTokens = await ctx.db
      .query("authRefreshTokens")
      .withIndex("sessionId", (q) => q.eq("sessionId", session._id))
      .collect();
    for (const rt of refreshTokens) await ctx.db.delete(rt._id);
    await ctx.db.delete(session._id);
  }

  // 2. authAccounts for this user, and the authVerificationCodes pointing to
  //    each account (indexed by accountId).
  const accounts = await ctx.db
    .query("authAccounts")
    .withIndex("userIdAndProvider", (q) => q.eq("userId", userId))
    .collect();
  for (const account of accounts) {
    const codes = await ctx.db
      .query("authVerificationCodes")
      .withIndex("accountId", (q) => q.eq("accountId", account._id))
      .collect();
    for (const c of codes) await ctx.db.delete(c._id);
    await ctx.db.delete(account._id);
  }

  // 3. Finally the user row itself.
  await ctx.db.delete(userId);
}

/**
 * Full reset of E2E state. Cleans up everything bootstrap + seed touch, AND
 * the underlying Convex Auth rows (sessions / refresh tokens / verification
 * codes / accounts) for the 3 emails so you can retry a fresh signUp without
 * tripping on "Account already exists" from a half-completed previous run.
 *
 * What gets wiped:
 *   - 3 main user rows + all their authSessions / authRefreshTokens /
 *     authVerificationCodes / authAccounts (full Convex Auth wipe)
 *   - test tenants (`test-t1`, `test-t2`) + any lingering userTenants links to them
 *   - adminInvites rows for the 3 emails
 *   - the system seed user (`__e2e_seed_system__@kb.test`)
 *
 * Idempotent: re-running on already-clean state is a no-op (zero counters).
 */
export const wipeE2EAuthAccounts = internalMutation({
  args: {
    adminEmail: v.string(),
    managerEmail: v.string(),
    // Mirrors the rest of the API — opt-in. Absent → the customer account is
    // simply not part of the wipe (no-op if no such row exists).
    customerEmail: v.optional(v.string()),
  },
  returns: v.object({
    fullyWipedUsers: v.number(),
    deletedTestTenants: v.number(),
    deletedInvites: v.number(),
    deletedSeedUsers: v.number(),
  }),
  handler: async (ctx, args) => {
    const targetEmails = [args.adminEmail, args.managerEmail];
    if (args.customerEmail !== undefined) targetEmails.push(args.customerEmail);

    // 1. Full Convex Auth wipe of the target users (sessions, refresh tokens,
    //    verification codes, accounts, then the user row).
    let fullyWipedUsers = 0;
    for (const email of targetEmails) {
      const user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      if (user === null) continue;
      // Clean userTenants attachments before deleting the user (FK hygiene).
      await wipeUserAttachments(ctx, user._id);
      await wipeUserCompletely(ctx, user._id);
      fullyWipedUsers += 1;
    }

    // 2. Test tenants + any lingering userTenants links to them (in case a
    //    link survived a partial earlier wipe).
    let deletedTestTenants = 0;
    for (const slug of ["test-t1", "test-t2"]) {
      const tenant = await ctx.db
        .query("tenants")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (tenant === null) continue;
      const links = await ctx.db
        .query("userTenants")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
        .collect();
      for (const link of links) await ctx.db.delete(link._id);
      await ctx.db.delete(tenant._id);
      deletedTestTenants += 1;
    }

    // 3. adminInvites rows for these emails.
    let deletedInvites = 0;
    for (const email of targetEmails) {
      const invites = await ctx.db
        .query("adminInvites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect();
      for (const inv of invites) {
        await ctx.db.delete(inv._id);
        deletedInvites += 1;
      }
    }

    // 4. The system seed user — purely a referent for `invitedBy`, no auth
    //    rows to clean.
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
      fullyWipedUsers,
      deletedTestTenants,
      deletedInvites,
      deletedSeedUsers,
    };
  },
});
