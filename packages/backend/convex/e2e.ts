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
 *      → upserts `test-t1` + `test-t2` AND returns 2 URLs
 *      `/accept-invite?token=...` (+ a 3rd if customerEmail is also passed).
 *      The admin invite is legacy-shaped (no targetRole); the manager
 *      invite is stamped `targetRole: "kb_manager"` + `tenantId: test-t1`.
 *   2. Open each URL in the browser, create a password (same is fine).
 *      `acceptInvite` (B-AUTH-6 wired) routes to the right branch:
 *        - admin URL  → users.role = "kb_admin", no userTenants
 *        - manager URL → users untouched (no role/name patch) +
 *                        userTenants(kb_manager, test-t1) created.
 *                        The global role stays absent; getCurrentActor
 *                        defaults a missing role to "customer", which IS
 *                        the canonical global state for a manager (ADR
 *                        0011 — per-tenant roles live on userTenants).
 *      Log out between each (avatar menu) — or use a private window.
 *   3. Run the E2E-A1 → A5 checks in the browser using the right account.
 *      NO `seedE2EAuthAccounts` call needed for the nominal path — accept
 *      already sets the right role + attachment.
 *   4. Optional reset:
 *      `npx convex run e2e:wipeE2EAuthAccounts '{adminEmail, managerEmail}'`
 *      → fully wipes the test users (sessions, accounts, attachments) +
 *      the test tenants + the seed invites + the system seed user.
 *
 * `seedE2EAuthAccounts` is kept as a "force-correct roles on existing
 * accounts" utility (useful if you sign up by mistake with a non-bootstrap
 * flow, or to test the A6 customer-empty-state path by downgrading a
 * customer that came in via the legacy admin acceptInvite). It is NOT
 * required by the nominal A1 → A5 workflow above.
 *
 * Idempotent: re-running each command wipes prior state before re-creating it.
 */

import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
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
 * Step 1 of the E2E auth bootstrap: insert the test tenants AND the seed
 * invites in one shot.
 *
 * Tenants come FIRST because the manager invite needs to embed `tenantId`
 * (post-B-AUTH-3, `acceptInvite` discriminates on `targetRole` and a
 * manager invite without `tenantId` is a hard error — cf.
 * `convex/table/admin.ts`). Both tenants (`test-t1`, `test-t2`) are
 * upserted to `status: "active"`; `test-t1` is the one the manager invite
 * points at, `test-t2` stays orphan (used by E2E-A4 to test the
 * cross-tenant redirect).
 *
 * After the (admin, manager) flows are accepted via the returned URLs the
 * users are correctly typed END-TO-END (admin → role kb_admin, no
 * userTenants; manager → role customer + 1 active userTenants link to
 * `test-t1` as kb_manager). NO follow-up `seedE2EAuthAccounts` call is
 * required for the nominal path — the role/attachment grants happen at
 * accept-time, not as a separate seed step.
 *
 * Side effects:
 *   - Upserts the 2 test tenants (status active) — `test-t1` and `test-t2`.
 *   - Creates the system seed user (`__e2e_seed_system__@kb.test`) if absent.
 *   - Deletes any existing invite for the seeded emails (idempotence).
 *   - Inserts 2 (or 3 with `customerEmail`) fresh invites — admin invite
 *     legacy-shaped (no `targetRole`), manager invite stamped
 *     `targetRole: "kb_manager"` + `tenantId: test-t1`, optional customer
 *     invite legacy-shaped (used only for the A6 NoTenantEmptyState test).
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
    tenant1Id: v.id("tenants"),
    tenant2Id: v.id("tenants"),
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

    // Tenants FIRST — the manager invite below needs `tenant1Id` to stamp
    // its `tenantId` field (post-B-AUTH-3 acceptInvite contract). Tenant2
    // stays orphan (used by E2E-A4 cross-tenant redirect test).
    const tenant1Id = await upsertActiveTenantBySlug(ctx, {
      slug: "test-t1",
      name: "Test Restaurant 1",
      siret: "00000000000001",
    });
    const tenant2Id = await upsertActiveTenantBySlug(ctx, {
      slug: "test-t2",
      name: "Test Restaurant 2",
      siret: "00000000000002",
    });

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

    // Admin invite: legacy shape (no `targetRole`) so the acceptInvite
    // legacy branch fires → role kb_admin.
    const adminInviteId = await ctx.db.insert("adminInvites", {
      email: args.adminEmail,
      name: "E2E Admin",
      token: adminToken,
      invitedBy: systemSeedUserId,
      expiresAt,
    });
    // Manager invite: NEW shape (targetRole + tenantId) so the acceptInvite
    // manager branch fires → role customer + userTenants(kb_manager, test-t1).
    const managerInviteId = await ctx.db.insert("adminInvites", {
      email: args.managerEmail,
      name: "E2E Manager",
      token: managerToken,
      invitedBy: systemSeedUserId,
      expiresAt,
      targetRole: "kb_manager",
      tenantId: tenant1Id,
    });

    let customerInviteId: Id<"adminInvites"> | null = null;
    let customerAcceptUrl: string | null = null;
    const baseUrl = args.baseUrl ?? "http://localhost:3000";
    if (args.customerEmail !== undefined) {
      // Customer invite: also legacy shape (no targetRole) for the
      // historical A6 negative-path test. Becomes kb_admin if accepted —
      // the test runner has to call `seedE2EAuthAccounts` to downgrade
      // it to `customer` for the NoTenantEmptyState assertion to fire.
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
      tenant1Id,
      tenant2Id,
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

// -----------------------------------------------------------------------------
// bootstrapE2EA2A3Invites — extra accounts for A2 (multi-tenant) and A3 (orphan)
// -----------------------------------------------------------------------------

/**
 * Bootstrap the 2 extra accounts required by the current E2E A2 and A3
 * parcours (post-2026-06 audit pass renamed the original "A6 NoTenantEmptyState"
 * to A3 and added A2 multi-tenant cookie hint).
 *
 *   - **A2** (`multi-tenants : dernière resto restaurée`) needs a KB Manager
 *     attached to BOTH `test-t1` AND `test-t2`. The 2-account model only
 *     covers a mono-tenant manager — touching `manager@kb.test`'s attachments
 *     would break A4a (which requires a mono-tenant manager to forge `/t/T2/...`).
 *     Hence a separate `multiEmail` account.
 *
 *   - **A3** (`KB Manager sans tenant rattaché`) needs a user with role
 *     `"customer"` and 0 `userTenants` rows (UnauthorizedCard NoTenantEmptyState).
 *     This is the same shape as the legacy `customerEmail` opt-in of
 *     `bootstrapE2EInvites`, but kept here so the A2 + A3 bootstrap is one
 *     atomic step driven by the current doc names (not the historical ones).
 *
 * Side effects:
 *   - Requires `test-t1` AND `test-t2` to already exist (run
 *     `bootstrapE2EInvites` first; the seed-system user is also reused).
 *   - Wipes any existing invite for the 2 emails (idempotence).
 *   - Inserts 2 fresh invites:
 *       * multi   → new shape (`targetRole: "kb_manager"` + `tenantId: test-t1`)
 *                   so acceptInvite creates `userTenants(kb_manager, test-t1)`
 *                   at accept-time. `finalizeE2EA2A3Accounts` adds the 2nd
 *                   link to `test-t2` after the user signs up.
 *       * orphan  → legacy shape (no `targetRole`) so acceptInvite patches
 *                   `users.role = "kb_admin"`. `finalizeE2EA2A3Accounts`
 *                   downgrades it back to `"customer"` + wipes attachments,
 *                   landing on the NoTenantEmptyState shape.
 *
 * Workflow:
 *   1. `npx convex run e2e:bootstrapE2EA2A3Invites '{multiEmail, orphanEmail}'`
 *      → returns 2 URLs.
 *   2. Open each URL in a fresh browser session, create a password (same is fine).
 *   3. `npx convex run e2e:finalizeE2EA2A3Accounts '{multiEmail, orphanEmail}'`
 *      → multi has 2 `userTenants`, orphan has 0.
 *   4. `npx convex run e2e:inspectE2EState '{adminEmail, managerEmail}'` to
 *      sanity-check (manager attachments stays at 1, the multi/orphan rows
 *      need a separate lookup if you want the full picture).
 *
 * Idempotent: re-running before the user accepts wipes the previous invite
 * and re-issues a fresh URL. Re-running AFTER accept is harmless (the next
 * accept will hit the "Account already exists" guard of Convex Auth — the
 * user can simply log in instead).
 */
export const bootstrapE2EA2A3Invites = internalMutation({
  args: {
    multiEmail: v.string(),
    orphanEmail: v.string(),
    baseUrl: v.optional(v.string()),
    expiresInDays: v.optional(v.number()),
  },
  returns: v.object({
    multiAcceptUrl: v.string(),
    orphanAcceptUrl: v.string(),
    multiInviteId: v.id("adminInvites"),
    orphanInviteId: v.id("adminInvites"),
    tenant1Id: v.id("tenants"),
    tenant2Id: v.id("tenants"),
  }),
  handler: async (ctx, args) => {
    const tenant1 = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", "test-t1"))
      .unique();
    const tenant2 = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", "test-t2"))
      .unique();
    if (tenant1 === null || tenant2 === null) {
      throw new ConvexError({
        message:
          "test-t1 and/or test-t2 not found. Run `bootstrapE2EInvites` first to upsert the base tenants.",
      });
    }

    const systemSeedUserId = await getOrCreateSystemSeedUser(ctx);

    for (const email of [args.multiEmail, args.orphanEmail]) {
      const existing = await ctx.db
        .query("adminInvites")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect();
      for (const inv of existing) await ctx.db.delete(inv._id);
    }

    const expiresAt =
      Date.now() + (args.expiresInDays ?? 7) * 24 * 60 * 60 * 1000;
    const ts = Date.now().toString(36);
    const baseUrl = args.baseUrl ?? "http://localhost:3000";

    const multiToken = `e2e-multi-${ts}`;
    const multiInviteId = await ctx.db.insert("adminInvites", {
      email: args.multiEmail,
      name: "E2E Manager Multi",
      token: multiToken,
      invitedBy: systemSeedUserId,
      expiresAt,
      targetRole: "kb_manager",
      tenantId: tenant1._id,
    });

    const orphanToken = `e2e-orphan-${ts}`;
    const orphanInviteId = await ctx.db.insert("adminInvites", {
      email: args.orphanEmail,
      name: "E2E Manager Orphan",
      token: orphanToken,
      invitedBy: systemSeedUserId,
      expiresAt,
    });

    return {
      multiAcceptUrl: `${baseUrl}/accept-invite?token=${multiToken}`,
      orphanAcceptUrl: `${baseUrl}/accept-invite?token=${orphanToken}`,
      multiInviteId,
      orphanInviteId,
      tenant1Id: tenant1._id,
      tenant2Id: tenant2._id,
    };
  },
});

// -----------------------------------------------------------------------------
// finalizeE2EA2A3Accounts — step 2 after Alex accepts the 2 invites
// -----------------------------------------------------------------------------

/**
 * Finalize the A2 (multi-tenant manager) and A3 (orphan) accounts AFTER the
 * user has accepted the 2 invites from `bootstrapE2EA2A3Invites`.
 *
 * Idempotent: the multi attachments get wiped + re-inserted (2 rows, one per
 * tenant), and the orphan attachments get wiped (always 0 rows). Roles get
 * patched unconditionally.
 *
 * After running:
 *   - multiEmail  → role: "customer", 2 active userTenants
 *                   (test-t1 + test-t2, both kb_manager)
 *   - orphanEmail → role: "customer", 0 userTenants (UnauthorizedCard target)
 */
export const finalizeE2EA2A3Accounts = internalMutation({
  args: {
    multiEmail: v.string(),
    orphanEmail: v.string(),
  },
  returns: v.object({
    multiUserId: v.id("users"),
    orphanUserId: v.id("users"),
    multiAttachments: v.number(),
    orphanAttachments: v.number(),
  }),
  handler: async (ctx, args) => {
    const multi = await findUserByEmailOrThrow(
      ctx,
      args.multiEmail,
      "multi-tenant manager",
    );
    const orphan = await findUserByEmailOrThrow(
      ctx,
      args.orphanEmail,
      "orphan manager",
    );

    const tenant1 = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", "test-t1"))
      .unique();
    const tenant2 = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", "test-t2"))
      .unique();
    if (tenant1 === null || tenant2 === null) {
      throw new ConvexError({
        message: "test-t1 and/or test-t2 not found.",
      });
    }

    // Use the seed system user as `attachedBy` (mirrors the bootstrap pattern;
    // admin@kb.test would also work but isn't guaranteed to exist yet during
    // an isolated run).
    const seedSystemUserId = await getOrCreateSystemSeedUser(ctx);

    // === Multi ===
    await ctx.db.patch(multi._id, { role: "customer" });
    await wipeUserAttachments(ctx, multi._id);
    const now = Date.now();
    await ctx.db.insert("userTenants", {
      userId: multi._id,
      tenantId: tenant1._id,
      role: "kb_manager",
      attachedAt: now,
      attachedBy: seedSystemUserId,
    });
    await ctx.db.insert("userTenants", {
      userId: multi._id,
      tenantId: tenant2._id,
      role: "kb_manager",
      attachedAt: now,
      attachedBy: seedSystemUserId,
    });

    // === Orphan ===
    await ctx.db.patch(orphan._id, { role: "customer" });
    await wipeUserAttachments(ctx, orphan._id);

    return {
      multiUserId: multi._id,
      orphanUserId: orphan._id,
      multiAttachments: 2,
      orphanAttachments: 0,
    };
  },
});

// -----------------------------------------------------------------------------
// seedE2ETenantCustomDomain — set/clear customDomain on a test tenant
// -----------------------------------------------------------------------------

/**
 * Set (or clear) the `customDomain` field on one of the test tenants for the
 * QR E2E parcours.
 *
 * The QR2 parcours (`docs/tests/E2E-checklist.md` groupe QR) needs a tenant
 * with `customDomain` set so the regenerated QR PDF points at it instead of
 * the default `<slug>.kitchen-boost.com`. In production, `customDomain` is set
 * via the wizard step 2 (`/pipeline/[prospectId]/provision/step2-domain-form.tsx`,
 * #358) — but driving a fresh wizard run end-to-end just to seed one field is
 * heavy for an E2E spot-check on the already-existing test-t1 / test-t2
 * tenants. This shortcut patches the field directly via the sanctioned dev
 * seed path (eslint-disable at file top).
 *
 * Idempotent: re-running with the same `customDomain` is a no-op patch. Pass
 * `null` to clear (e.g. between runs).
 */
export const seedE2ETenantCustomDomain = internalMutation({
  args: {
    tenantSlug: v.string(),
    customDomain: v.union(v.string(), v.null()),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    customDomainBefore: v.union(v.string(), v.null()),
    customDomainAfter: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, args) => {
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", args.tenantSlug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant with slug "${args.tenantSlug}" not found.`,
      });
    }
    const customDomainBefore = tenant.customDomain ?? null;
    // `ctx.db.patch` with `undefined` is a no-op for that field; to actually
    // CLEAR the value we pass `undefined` after explicitly mapping `null` to
    // that — the schema stores `v.optional(v.string())` so absent == cleared.
    await ctx.db.patch(tenant._id, {
      customDomain: args.customDomain ?? undefined,
    });
    return {
      tenantId: tenant._id,
      customDomainBefore,
      customDomainAfter: args.customDomain,
    };
  },
});

// -----------------------------------------------------------------------------
// E2E-MC seed — populate the « Mes clients » KPI dashboard with non-zero
// aggregates so the 9 cards render instead of the empty-state. Inserts 6
// `customers` (each behind its own auth user) + their `customerOrdersPerTenant`
// links to the requested `tenantId`. Distribution covers every visible KPI:
//   - Segments        : 2 actif + 2 inactif + 2 vip
//   - Reachability    : 2 email-only + 2 phone-only + 2 with email+phone+push
//   - Macro / total   : 6 total ; 6 newThisMonth (links insérés maintenant) ;
//                       returnRate = 4/6 (4 customers have totalOrders >= 2)
//
// Sentinel email pattern (`*@kb-e2e-kpi.test`) lets `wipeE2ECustomerKPIs`
// delete *exactly* what this seed inserted without touching real data.
// -----------------------------------------------------------------------------

/** Email suffix tagging seeded MC customers (used by both seed + wipe). */
const E2E_KPI_EMAIL_SUFFIX = "@kb-e2e-kpi.test";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Tag for the seeded MC fixture rows. Pure data (no I/O), exported so the
 * wipe can apply the exact same filter without drift.
 */
type MCSeedSpec = {
  /** Local part of the seed email (full email = `${local}${E2E_KPI_EMAIL_SUFFIX}`). */
  local: string;
  /** Stored on `customers.firstName`. */
  firstName: string;
  /** Segment intent (drives totalOrders + lastOrderAt). */
  segment: "actif" | "inactif" | "vip";
  /** Reachability intent (drives email/phone/pushEnrollment). */
  reach: "email_only" | "phone_only" | "all_three";
};

const MC_SEED_SPECS: readonly MCSeedSpec[] = [
  // 2 actifs (lastOrder ≤ 30 j, totalOrders ≥ 1)
  {
    local: "actif-email",
    firstName: "Anne",
    segment: "actif",
    reach: "email_only",
  },
  {
    local: "actif-phone",
    firstName: "Bruno",
    segment: "actif",
    reach: "phone_only",
  },
  // 2 inactifs (lastOrder > 90 j, totalOrders ≥ 1)
  {
    local: "inactif-email",
    firstName: "Claire",
    segment: "inactif",
    reach: "email_only",
  },
  {
    local: "inactif-phone",
    firstName: "David",
    segment: "inactif",
    reach: "phone_only",
  },
  // 2 VIP (totalOrders ≥ 5 OU ltv ≥ 150)
  { local: "vip-1", firstName: "Emma", segment: "vip", reach: "all_three" },
  { local: "vip-2", firstName: "Farid", segment: "vip", reach: "all_three" },
];

/** Build the per-segment KPI fields (totalOrders / lastOrderAt / ltv). */
function mcSegmentFields(
  segment: MCSeedSpec["segment"],
  now: number,
): { totalOrders: number; lastOrderAt: number; ltv: number } {
  switch (segment) {
    case "actif":
      // Within 30 d window, ≥ 1 order, < 5 orders, < 150€ → "actif".
      return { totalOrders: 2, lastOrderAt: now - 7 * DAY_MS, ltv: 40 };
    case "inactif":
      // > 90 d since last order, ≥ 1 order → "inactif".
      return { totalOrders: 2, lastOrderAt: now - 120 * DAY_MS, ltv: 35 };
    case "vip":
      // ≥ 5 orders → "vip" (also satisfies LTV threshold redundantly).
      return { totalOrders: 6, lastOrderAt: now - 10 * DAY_MS, ltv: 220 };
  }
}

/** Build the reachability fields (email / phone / pushEnrollment). */
function mcReachabilityFields(
  reach: MCSeedSpec["reach"],
  email: string,
): {
  email?: string;
  phone?: string;
  pushEnrollment?: Doc<"customers">["pushEnrollment"];
} {
  switch (reach) {
    case "email_only":
      return { email };
    case "phone_only":
      return { phone: "+33600000000" };
    case "all_three":
      return {
        email,
        phone: "+33600000001",
        pushEnrollment: { webPushStatus: "enrolled" },
      };
  }
}

/**
 * Seed step for the « Mes clients » KPI dashboard of a specific tenant.
 *
 * Idempotent: if the seeded customers already exist (re-run), the existing
 * rows are reused and only the per-tenant link is upserted; no duplicates.
 * This lets the seed run twice across different tenants and keeps the global
 * fiches reusable (the link table carries the tenantId, ADR 0010 + PRD 90).
 *
 * Returns a small JSON report of how many rows were inserted vs reused, so
 * the operator can sanity-check the result from the CLI.
 */
export const seedE2ECustomerKPIs = internalMutation({
  args: {
    tenantId: v.id("tenants"),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    customersCreated: v.number(),
    customersReused: v.number(),
    linksCreated: v.number(),
    linksUpdated: v.number(),
  }),
  handler: async (ctx, args) => {
    const tenant = await ctx.db.get(args.tenantId);
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant ${String(args.tenantId)} not found — seed the tenants first (e2e:bootstrapE2EInvites).`,
      });
    }

    const now = Date.now();
    let customersCreated = 0;
    let customersReused = 0;
    let linksCreated = 0;
    let linksUpdated = 0;

    for (const spec of MC_SEED_SPECS) {
      const email = `${spec.local}${E2E_KPI_EMAIL_SUFFIX}`;

      // 1. The anonymous Convex Auth user that IS this customer (ADR 0008).
      //    We bypass the real signUp flow on purpose — the customer here exists
      //    purely to carry a userId for the `customers` fiche. No password,
      //    no session, no auth login from this account.
      let user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      if (user === null) {
        const userId = await ctx.db.insert("users", {
          email,
          name: spec.firstName,
        });
        user = await ctx.db.get(userId);
      }
      if (user === null) {
        throw new ConvexError({ message: "User insert failed (impossible)" });
      }

      // 2. The global customer fiche.
      let customer = await ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
      const reachFields = mcReachabilityFields(spec.reach, email);
      // Marketing-eligible : stamp `cgvAcceptedAt` (ADR 0007 — clic « Payer »
      // est le consentement). Sans ce champ, `marketingEligible()` retourne
      // false et tous les sends tombent dans `skippedIneligible` (MC14 bug
      // découvert 2026-06-02). Pas de `marketingOptOutDate` → eligible.
      const consentFields = { cgvAcceptedAt: now };
      if (customer === null) {
        const customerId = await ctx.db.insert("customers", {
          userId: user._id,
          firstName: spec.firstName,
          createdAt: now,
          ...reachFields,
          ...consentFields,
        });
        customer = await ctx.db.get(customerId);
        customersCreated += 1;
      } else {
        // Re-run: refresh reachability + consent fields in case the spec evolved.
        await ctx.db.patch(customer._id, { ...reachFields, ...consentFields });
        customersReused += 1;
      }
      if (customer === null) {
        throw new ConvexError({
          message: "Customer insert failed (impossible)",
        });
      }

      // 3. The per-tenant link — the only carrier of `tenantId` for this
      //    customer (ADR 0010 MOAT). Upsert by (tenantId, customerId).
      const segmentFields = mcSegmentFields(spec.segment, now);
      const existingLink = await ctx.db
        .query("customerOrdersPerTenant")
        .withIndex("by_tenant_customer", (q) =>
          q.eq("tenantId", args.tenantId).eq("customerId", customer._id),
        )
        .unique();
      if (existingLink === null) {
        await ctx.db.insert("customerOrdersPerTenant", {
          customerId: customer._id,
          tenantId: args.tenantId,
          ...segmentFields,
        });
        linksCreated += 1;
      } else {
        await ctx.db.patch(existingLink._id, segmentFields);
        linksUpdated += 1;
      }
    }

    return {
      tenantId: args.tenantId,
      customersCreated,
      customersReused,
      linksCreated,
      linksUpdated,
    };
  },
});

/**
 * Wipe the E2E-MC customer KPI seed.
 *
 * Filters by the sentinel email pattern (`*@kb-e2e-kpi.test`) — guarantees we
 * never touch a real customer row. Deletes : customers rows + their users +
 * every `customerOrdersPerTenant` link they own (on ANY tenant, not just the
 * caller's), since this seed is the only writer of these specific rows and
 * the link rows are 1-to-N off the customer.
 */
export const wipeE2ECustomerKPIs = internalMutation({
  args: {},
  returns: v.object({
    customersDeleted: v.number(),
    usersDeleted: v.number(),
    linksDeleted: v.number(),
  }),
  handler: async (ctx) => {
    let customersDeleted = 0;
    let usersDeleted = 0;
    let linksDeleted = 0;

    for (const spec of MC_SEED_SPECS) {
      const email = `${spec.local}${E2E_KPI_EMAIL_SUFFIX}`;
      const user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      if (user === null) continue;

      const customer = await ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();

      if (customer !== null) {
        // All per-tenant links owned by this customer (any tenant).
        const links = await ctx.db
          .query("customerOrdersPerTenant")
          .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
          .collect();
        for (const link of links) {
          await ctx.db.delete(link._id);
          linksDeleted += 1;
        }
        await ctx.db.delete(customer._id);
        customersDeleted += 1;
      }

      await ctx.db.delete(user._id);
      usersDeleted += 1;
    }

    return { customersDeleted, usersDeleted, linksDeleted };
  },
});

// -----------------------------------------------------------------------------
// E2E-MO seed — populate the `/monitoring` dashboard with non-zero incidents
// so MO1/MO3/MO4 are testable end-to-end. We insert 2 `prospects` whose
// integration milestones are in `pending_kyc` for > 48 h (PRD 70 §3.8 KYC
// pending threshold). The webhook-latency + paid-no-course incident kinds
// are NOT seedable from here — they are feature-flagged off by default and
// their live data sources live in the 2.5 / 2.6 chantiers ; testing them
// requires flipping `MONITORING_WEBHOOK_LATENCY_ENABLED` /
// `MONITORING_PAID_NO_COURSE_ENABLED` and seeding the underlying tables
// (out of scope of this MC/MO checklist).
//
// Sentinel name prefix (`[E2E Monitoring]`) lets `wipeE2EMonitoringIncidents`
// delete *exactly* what this seed inserted without touching real prospects.
// -----------------------------------------------------------------------------

const E2E_MONITORING_PROSPECT_PREFIX = "[E2E Monitoring] ";

/** The 2 monitoring prospects this seed always inserts (idempotent by name). */
const MO_SEED_SPECS: ReadonlyArray<{
  nameSuffix: string;
  provider: "stripeConnect" | "uberDirect";
  pendingSinceDays: number;
}> = [
  { nameSuffix: "Stripe KYC", provider: "stripeConnect", pendingSinceDays: 3 },
  {
    nameSuffix: "Uber Direct KYC",
    provider: "uberDirect",
    pendingSinceDays: 5,
  },
];

/**
 * Seed 2 prospects whose KYC has been `pending_kyc` for > 48 h (3 d and 5 d
 * respectively). `previewIncidents` reads these via `listProspects` and the
 * pure `detectKycPendingIncidents` returns one Incident per (prospect, provider).
 *
 * Idempotent: re-run = patches the existing prospects (refreshes the timestamps
 * so the incidents stay above threshold even if the clock has moved a lot since
 * the previous seed run).
 */
export const seedE2EMonitoringIncidents = internalMutation({
  args: {},
  returns: v.object({
    prospectsCreated: v.number(),
    prospectsUpdated: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    let prospectsCreated = 0;
    let prospectsUpdated = 0;

    for (const spec of MO_SEED_SPECS) {
      const name = `${E2E_MONITORING_PROSPECT_PREFIX}${spec.nameSuffix}`;
      const pendingSince = now - spec.pendingSinceDays * DAY_MS;

      const milestones =
        spec.provider === "stripeConnect"
          ? {
              stripeConnect: {
                current: "pending_kyc" as const,
                history: [{ status: "pending_kyc" as const, at: pendingSince }],
              },
            }
          : {
              uberDirect: {
                current: "pending_kyc" as const,
                history: [{ status: "pending_kyc" as const, at: pendingSince }],
              },
            };

      const existing = await ctx.db
        .query("prospects")
        .filter((q) => q.eq(q.field("name"), name))
        .first();

      if (existing === null) {
        await ctx.db.insert("prospects", {
          name,
          phone: "+33600000000",
          phase: "preparation",
          source: "cold_call",
          milestones,
          createdAt: now,
          updatedAt: now,
        });
        prospectsCreated += 1;
      } else {
        await ctx.db.patch(existing._id, {
          milestones,
          updatedAt: now,
        });
        prospectsUpdated += 1;
      }
    }

    return { prospectsCreated, prospectsUpdated };
  },
});

/**
 * Wipe the E2E-MO monitoring seed. Filters by the sentinel name prefix
 * (`[E2E Monitoring] *`) — guarantees we never touch a real prospect row.
 */
export const wipeE2EMonitoringIncidents = internalMutation({
  args: {},
  returns: v.object({ prospectsDeleted: v.number() }),
  handler: async (ctx) => {
    let prospectsDeleted = 0;
    for (const spec of MO_SEED_SPECS) {
      const name = `${E2E_MONITORING_PROSPECT_PREFIX}${spec.nameSuffix}`;
      const existing = await ctx.db
        .query("prospects")
        .filter((q) => q.eq(q.field("name"), name))
        .first();
      if (existing !== null) {
        await ctx.db.delete(existing._id);
        prospectsDeleted += 1;
      }
    }
    return { prospectsDeleted };
  },
});

// -----------------------------------------------------------------------------
// E2E-T-B seed — populate the supervision Kanban with multi-phase prospects so
// T9/T10/T11 are testable. The MO seed already inserts 2 prospects in
// `preparation` (Stripe KYC + Uber Direct KYC). To exercise the Kanban's 3
// columns (Acquisition / Préparation / Installation) we add 1 prospect in
// `acquisition` and 1 in `installation` — sentinel-prefixed `[E2E T-B]` so the
// wipe stays surgical and never touches real prospect rows.
// -----------------------------------------------------------------------------

const E2E_TB_PROSPECT_PREFIX = "[E2E T-B] ";

const TB_SEED_SPECS: ReadonlyArray<{
  nameSuffix: string;
  phase: "acquisition" | "installation";
  phone: string;
}> = [
  { nameSuffix: "Acquisition", phase: "acquisition", phone: "+33600000101" },
  { nameSuffix: "Installation", phase: "installation", phone: "+33600000102" },
];

/**
 * Seed 2 prospects (1 acquisition, 1 installation) so that combined with the
 * 2 MO seeded prospects (preparation), the supervision Kanban renders all 3
 * columns non-empty. Idempotent by name sentinel.
 */
export const seedE2ESupervisionProspects = internalMutation({
  args: {},
  returns: v.object({
    prospectsCreated: v.number(),
    prospectsUpdated: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    let prospectsCreated = 0;
    let prospectsUpdated = 0;

    for (const spec of TB_SEED_SPECS) {
      const name = `${E2E_TB_PROSPECT_PREFIX}${spec.nameSuffix}`;

      const existing = await ctx.db
        .query("prospects")
        .filter((q) => q.eq(q.field("name"), name))
        .first();

      if (existing === null) {
        await ctx.db.insert("prospects", {
          name,
          phone: spec.phone,
          phase: spec.phase,
          source: "cold_call",
          createdAt: now,
          updatedAt: now,
        });
        prospectsCreated += 1;
      } else {
        await ctx.db.patch(existing._id, {
          phase: spec.phase,
          updatedAt: now,
        });
        prospectsUpdated += 1;
      }
    }

    return { prospectsCreated, prospectsUpdated };
  },
});

/**
 * Wipe the E2E-T-B supervision Kanban seed. Filters by the sentinel name
 * prefix (`[E2E T-B] *`) — never touches real prospect rows.
 */
export const wipeE2ESupervisionProspects = internalMutation({
  args: {},
  returns: v.object({ prospectsDeleted: v.number() }),
  handler: async (ctx) => {
    let prospectsDeleted = 0;
    for (const spec of TB_SEED_SPECS) {
      const name = `${E2E_TB_PROSPECT_PREFIX}${spec.nameSuffix}`;
      const existing = await ctx.db
        .query("prospects")
        .filter((q) => q.eq(q.field("name"), name))
        .first();
      if (existing !== null) {
        await ctx.db.delete(existing._id);
        prospectsDeleted += 1;
      }
    }
    return { prospectsDeleted };
  },
});

// -----------------------------------------------------------------------------
// E2E-T-C seed — populate the supervision pipeline with prospects exercising
// the contract generation modal (T3 → T8). T6 needs a prospect with the 5
// juridique fields filled (name + siret + address + email + contactName) and
// NO contract yet ; T7 needs a prospect with ONLY name + phone (4 juridique
// fields missing) so the modal renders the disabled-CTA + "Champs absents"
// branch. T3/T4 reuse the contract generated by T6 ; T5 covers an empty-HTML
// branch that is harder to seed (typically a code-review / React DevTools
// spot-check ; not a deterministic e2e parcours in V1).
//
// Sentinel name prefix (`[E2E T-C]`) keeps the wipe surgical and never
// touches real prospect rows.
// -----------------------------------------------------------------------------

const E2E_TC_PROSPECT_PREFIX = "[E2E T-C] ";

type TCProspectSpec = {
  nameSuffix: string;
  phone: string;
  juridique: {
    siret?: string;
    address?: string;
    contactName?: string;
    email?: string;
  };
};

const TC_SEED_SPECS: ReadonlyArray<TCProspectSpec> = [
  {
    nameSuffix: "Juridique Complet",
    phone: "+33600000201",
    juridique: {
      siret: "81234567800015",
      address: "12 rue de la République, 75011 Paris",
      contactName: "Jean Dupont",
      email: "jean.dupont@e2e-juridique.test",
    },
  },
  {
    nameSuffix: "Juridique Incomplet",
    phone: "+33600000202",
    juridique: {}, // intentionally empty — exercises T7 disabled-CTA branch.
  },
];

/**
 * Seed 2 prospects for the contract generation parcours (T6 = complete /
 * T7 = incomplete). Idempotent by name sentinel: re-runs reset the juridique
 * fields back to their canonical state (so accidental edits between runs are
 * wiped).
 */
export const seedE2EContractProspects = internalMutation({
  args: {},
  returns: v.object({
    prospectsCreated: v.number(),
    prospectsUpdated: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    let prospectsCreated = 0;
    let prospectsUpdated = 0;

    for (const spec of TC_SEED_SPECS) {
      const name = `${E2E_TC_PROSPECT_PREFIX}${spec.nameSuffix}`;

      const existing = await ctx.db
        .query("prospects")
        .filter((q) => q.eq(q.field("name"), name))
        .first();

      if (existing === null) {
        await ctx.db.insert("prospects", {
          name,
          phone: spec.phone,
          phase: "acquisition",
          source: "cold_call",
          siret: spec.juridique.siret,
          address: spec.juridique.address,
          contactName: spec.juridique.contactName,
          email: spec.juridique.email,
          createdAt: now,
          updatedAt: now,
        });
        prospectsCreated += 1;
      } else {
        await ctx.db.patch(existing._id, {
          siret: spec.juridique.siret,
          address: spec.juridique.address,
          contactName: spec.juridique.contactName,
          email: spec.juridique.email,
          updatedAt: now,
        });
        prospectsUpdated += 1;
      }
    }

    return { prospectsCreated, prospectsUpdated };
  },
});

/**
 * Wipe the E2E-T-C contract-generation seed. Filters by the sentinel name
 * prefix (`[E2E T-C] *`) — never touches real prospect rows. Does NOT wipe
 * the generated `contracts` rows (those are cleaned via the existing
 * contract-wipe utilities or by re-running the seed on a fresh deployment).
 */
export const wipeE2EContractProspects = internalMutation({
  args: {},
  returns: v.object({ prospectsDeleted: v.number() }),
  handler: async (ctx) => {
    let prospectsDeleted = 0;
    for (const spec of TC_SEED_SPECS) {
      const name = `${E2E_TC_PROSPECT_PREFIX}${spec.nameSuffix}`;
      const existing = await ctx.db
        .query("prospects")
        .filter((q) => q.eq(q.field("name"), name))
        .first();
      if (existing !== null) {
        await ctx.db.delete(existing._id);
        prospectsDeleted += 1;
      }
    }
    return { prospectsDeleted };
  },
});

// -----------------------------------------------------------------------------
// E2E-T-D seed — populate the supervision Kanban with prospects exercising
// the search + filters + DnD + auto-bascule features (T11 → T13, T17 → T19).
// Inserts 7 sentinellés `[E2E T-D]` prospects covering:
//
//  - T11 (3 cols + 4 phases) + T12 (search Café / Pizza) : 3 named prospects
//    (« Café Vert » acquisition, « Pizza Roma » preparation, « Sushi Bar »
//    installation) — chosen to exercise the search test (accent-insensitive
//    `cafe` match + substring `pizz`).
//  - T13 (onglet Clients actifs + badge tenant ✓) : 1 prospect en phase
//    `operationnel` avec `tenantId` back-linké sur `test-t1` (la rangée
//    tenant doit déjà exister — créée par `bootstrapE2EInvites`).
//  - T17 (DnD clean Acquisition → Préparation) : 1 prospect en `acquisition`,
//    `tabletteMode = appareil_existant`, les 4 milestones Closing mandatory
//    cochés (timestamps = now), drag clean autorisé sans dialog bypass.
//  - T18 (DnD bypass + dialog) : 1 prospect en `acquisition`,
//    `tabletteMode = achat_kb`, 4 milestones cochés (manque
//    `factureTablettePayee`) — le drag déclenche le dialog « Confirmer le
//    bypass » avec le bullet `Facture tablette payée`.
//  - T19 (toast auto-bascule au check du dernier milestone) : 1 prospect en
//    `acquisition`, `tabletteMode = appareil_existant`, 3 des 4 milestones
//    mandatory cochés (manque `ribRecu`) — Alex coche `ribRecu` via la
//    fiche et la carte glisse en Préparation côté Kanban avec toast.
//
// Sentinel name prefix (`[E2E T-D]`) keeps the wipe surgical and never
// touches real prospect rows.
// -----------------------------------------------------------------------------

const E2E_TD_PROSPECT_PREFIX = "[E2E T-D] ";

type TDMilestoneKey =
  | "contratSigne"
  | "kbisRecu"
  | "pieceIdentiteRecue"
  | "ribRecu"
  | "factureTabletteEmise"
  | "factureTablettePayee";

type TDProspectSpec = {
  nameSuffix: string;
  phone: string;
  phase: "acquisition" | "preparation" | "installation" | "operationnel";
  tabletteMode?: "appareil_existant" | "achat_kb";
  cockedMilestones?: readonly TDMilestoneKey[];
  linkToTenantSlug?: string;
};

const TD_SEED_SPECS: ReadonlyArray<TDProspectSpec> = [
  // T11 + T12 — search test (3 prospects with distinguishable names + accents)
  { nameSuffix: "Café Vert", phone: "+33600000301", phase: "acquisition" },
  { nameSuffix: "Pizza Roma", phone: "+33600000302", phase: "preparation" },
  { nameSuffix: "Sushi Bar", phone: "+33600000303", phase: "installation" },
  // T13 — onglet Clients actifs (operationnel + tenantId backlink)
  {
    nameSuffix: "Resto Actif",
    phone: "+33600000304",
    phase: "operationnel",
    linkToTenantSlug: "test-t1",
  },
  // T17 — DnD clean Acquisition → Préparation (appareil_existant, 4/4 cocked)
  {
    nameSuffix: "DnD Clean",
    phone: "+33600000305",
    phase: "acquisition",
    tabletteMode: "appareil_existant",
    cockedMilestones: [
      "contratSigne",
      "kbisRecu",
      "pieceIdentiteRecue",
      "ribRecu",
    ],
  },
  // T18 — DnD bypass dialog (achat_kb, 4/5 cocked, missing factureTablettePayee)
  {
    nameSuffix: "DnD Bypass",
    phone: "+33600000306",
    phase: "acquisition",
    tabletteMode: "achat_kb",
    cockedMilestones: [
      "contratSigne",
      "kbisRecu",
      "pieceIdentiteRecue",
      "ribRecu",
      "factureTabletteEmise",
    ],
  },
  // T19 — auto-bascule on last milestone check (appareil_existant, 3/4 cocked, missing ribRecu)
  {
    nameSuffix: "Auto Bascule",
    phone: "+33600000307",
    phase: "acquisition",
    tabletteMode: "appareil_existant",
    cockedMilestones: ["contratSigne", "kbisRecu", "pieceIdentiteRecue"],
  },
];

/**
 * Build a `milestones` payload from a list of cocked milestone keys + a
 * common timestamp (so re-runs always produce the same shape). Empty list
 * returns `undefined` (no milestones field on the prospect).
 */
function buildTDMilestones(
  cocked: readonly TDMilestoneKey[] | undefined,
  ts: number,
): Record<string, number> | undefined {
  if (cocked === undefined || cocked.length === 0) return undefined;
  const out: Record<string, number> = {};
  for (const key of cocked) {
    out[key] = ts;
  }
  return out;
}

/**
 * Seed 7 prospects for the Kanban DnD parcours (T11/T12/T13/T17/T18/T19).
 * Idempotent by name sentinel : re-runs reset phase + tabletteMode +
 * milestones + tenantId backlink to their canonical state.
 */
export const seedE2EKanbanDnDProspects = internalMutation({
  args: {},
  returns: v.object({
    prospectsCreated: v.number(),
    prospectsUpdated: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    let prospectsCreated = 0;
    let prospectsUpdated = 0;

    for (const spec of TD_SEED_SPECS) {
      const name = `${E2E_TD_PROSPECT_PREFIX}${spec.nameSuffix}`;

      // Resolve the optional tenantId backlink first so the patch is atomic.
      let tenantId: Id<"tenants"> | undefined = undefined;
      if (spec.linkToTenantSlug !== undefined) {
        const tenant = await ctx.db
          .query("tenants")
          .withIndex("by_slug", (q) =>
            q.eq("slug", spec.linkToTenantSlug as string),
          )
          .unique();
        if (tenant === null) {
          throw new ConvexError({
            message: `Tenant with slug "${spec.linkToTenantSlug}" not found (required by T-D seed for "${name}").`,
          });
        }
        tenantId = tenant._id;
      }

      const milestones = buildTDMilestones(spec.cockedMilestones, now);

      const existing = await ctx.db
        .query("prospects")
        .filter((q) => q.eq(q.field("name"), name))
        .first();

      if (existing === null) {
        await ctx.db.insert("prospects", {
          name,
          phone: spec.phone,
          phase: spec.phase,
          source: "cold_call",
          tabletteMode: spec.tabletteMode,
          milestones,
          tenantId,
          createdAt: now,
          updatedAt: now,
        });
        prospectsCreated += 1;
      } else {
        await ctx.db.patch(existing._id, {
          phase: spec.phase,
          tabletteMode: spec.tabletteMode,
          milestones,
          tenantId,
          updatedAt: now,
        });
        prospectsUpdated += 1;
      }
    }

    return { prospectsCreated, prospectsUpdated };
  },
});

/**
 * Wipe the E2E-T-D Kanban DnD seed. Filters by the sentinel name prefix
 * (`[E2E T-D] *`) — never touches real prospect rows.
 */
export const wipeE2EKanbanDnDProspects = internalMutation({
  args: {},
  returns: v.object({ prospectsDeleted: v.number() }),
  handler: async (ctx) => {
    let prospectsDeleted = 0;
    for (const spec of TD_SEED_SPECS) {
      const name = `${E2E_TD_PROSPECT_PREFIX}${spec.nameSuffix}`;
      const existing = await ctx.db
        .query("prospects")
        .filter((q) => q.eq(q.field("name"), name))
        .first();
      if (existing !== null) {
        await ctx.db.delete(existing._id);
        prospectsDeleted += 1;
      }
    }
    return { prospectsDeleted };
  },
});

// -----------------------------------------------------------------------------
// E2E-T-E seed — populate the fiche prospect détaillée (T14-T16, T20-T25).
// Inserts 7 sentinellés `[E2E T-E]` prospects covering :
//
//  - T14 (auto-bascule via fiche checkbox)     : `Auto Bascule Fiche` (acquisition,
//    appareil_existant, 3/4 Closing milestones cocked — manque `ribRecu`).
//  - T15 (Stripe Connect status update)        : `Intégrations Vierges` (no
//    integration milestones initialised → dropdown shows `not_started`).
//  - T16 (KB Manager refused on deep-link)     : ANY prospect works ; reuse one
//    of the T-E rows (the test is purely RBAC, no specific state needed).
//  - T20 (log interaction → timeline top)      : `Interactions` (1 historical
//    `Premier contact` interaction logged ~30 days ago).
//  - T21 (edit identity via modal)             : `Identity Edit` (name='L'Artisan'-ish,
//    contactName='Jean Dupont', no SIRET — Alex saisit pendant le parcours).
//  - T22 (ExternalLinksPanel — wa.me + uber)   : `External Links` (phone EXACTLY
//    '06 12 34 56 78' so deep-link should normalise to `https://wa.me/33612345678`).
//  - T23 (TenantPanel absent si non provisionné): `No Tenant` (acquisition, no
//    `tenantId` back-link — confirms the conditional render absence).
//  - T24 (TenantPanel + bouton Ouvrir vue resto): reuses `[E2E T-D] Resto Actif`
//    (operationnel + tenantId backlinké à test-t1, déjà seedé par T-D).
//  - T25 (TenantPanel dégradé tenant supprimé) : `Ghost Tenant` — prospect with
//    `tenantId` pointing to a tenant we INSERT then DELETE in the same handler,
//    leaving a dangling pointer the panel must surface as "Tenant introuvable".
//
// Sentinel name prefix (`[E2E T-E]`) keeps the wipe surgical.
// -----------------------------------------------------------------------------

const E2E_TE_PROSPECT_PREFIX = "[E2E T-E] ";
const E2E_TE_GHOST_TENANT_SLUG = "e2e-te-ghost-tenant";
const DAY_30_MS = 30 * DAY_MS;

/**
 * T-E specs — discriminated union to cover every "shape" the fiche tests need.
 * The handler dispatches on `kind` to build the correct insert payload.
 */
type TEProspectSpec =
  | { kind: "auto_bascule_fiche"; nameSuffix: string; phone: string }
  | { kind: "integrations_vierges"; nameSuffix: string; phone: string }
  | { kind: "interactions"; nameSuffix: string; phone: string }
  | { kind: "identity_edit"; nameSuffix: string; phone: string }
  | { kind: "external_links"; nameSuffix: string; phone: string }
  | { kind: "no_tenant"; nameSuffix: string; phone: string }
  | { kind: "ghost_tenant"; nameSuffix: string; phone: string };

const TE_SEED_SPECS: ReadonlyArray<TEProspectSpec> = [
  {
    kind: "auto_bascule_fiche",
    nameSuffix: "Auto Bascule Fiche",
    phone: "+33600000401",
  },
  {
    kind: "integrations_vierges",
    nameSuffix: "Intégrations Vierges",
    phone: "+33600000402",
  },
  { kind: "interactions", nameSuffix: "Interactions", phone: "+33600000403" },
  { kind: "identity_edit", nameSuffix: "Identity Edit", phone: "+33600000404" },
  // External Links uses the EXACT human-typed shape "06 12 34 56 78" (with
  // spaces) so we exercise the wa.me normalisation rather than feeding the
  // panel a pre-cleaned phone.
  {
    kind: "external_links",
    nameSuffix: "External Links",
    phone: "06 12 34 56 78",
  },
  { kind: "no_tenant", nameSuffix: "No Tenant", phone: "+33600000406" },
  { kind: "ghost_tenant", nameSuffix: "Ghost Tenant", phone: "+33600000407" },
];

/**
 * Seed 7 prospects for the fiche prospect détaillée parcours (T14-T16, T20-T25).
 * Idempotent by name sentinel : re-runs reset the prospect state to canonical.
 *
 * Special case for T25 (`ghost_tenant`) : we INSERT a sentinellé tenant
 * (slug = `e2e-te-ghost-tenant`), assign its `_id` to the prospect, then
 * DELETE the tenant — leaving a dangling `tenantId` pointer that exercises
 * the TenantPanel "Tenant introuvable" fallback. Re-runs first wipe any
 * existing ghost tenant left over from a previous run (defensive).
 */
export const seedE2EFicheProspectDetails = internalMutation({
  args: {},
  returns: v.object({
    prospectsCreated: v.number(),
    prospectsUpdated: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    let prospectsCreated = 0;
    let prospectsUpdated = 0;

    for (const spec of TE_SEED_SPECS) {
      const name = `${E2E_TE_PROSPECT_PREFIX}${spec.nameSuffix}`;

      // Build the per-kind payload.
      let payload: {
        name: string;
        phone: string;
        phase: "acquisition" | "preparation" | "installation" | "operationnel";
        source: "cold_call" | "whatsapp" | "referral" | "visite_physique";
        tabletteMode?: "appareil_existant" | "achat_kb";
        siret?: string;
        address?: string;
        contactName?: string;
        email?: string;
        milestones?: Doc<"prospects">["milestones"];
        interactions?: Doc<"prospects">["interactions"];
        tenantId?: Id<"tenants">;
      };

      switch (spec.kind) {
        case "auto_bascule_fiche":
          payload = {
            name,
            phone: spec.phone,
            phase: "acquisition",
            source: "cold_call",
            tabletteMode: "appareil_existant",
            milestones: {
              contratSigne: now,
              kbisRecu: now,
              pieceIdentiteRecue: now,
              // ribRecu absent on purpose — Alex coche depuis la fiche pour déclencher la bascule.
            },
          };
          break;
        case "integrations_vierges":
          payload = {
            name,
            phone: spec.phone,
            phase: "preparation",
            source: "cold_call",
            // Aucun milestone d'intégration : Stripe/Uber/Hubrise tous absents.
          };
          break;
        case "interactions":
          payload = {
            name,
            phone: spec.phone,
            phase: "acquisition",
            source: "cold_call",
            interactions: [
              {
                note: "Premier contact",
                date: now - DAY_30_MS,
                canal: "cold_call",
              },
            ],
          };
          break;
        case "identity_edit":
          payload = {
            name,
            phone: spec.phone,
            phase: "acquisition",
            source: "cold_call",
            contactName: "Jean Dupont",
            // SIRET absent : Alex le saisit pendant T21.
          };
          break;
        case "external_links":
          payload = {
            name,
            phone: spec.phone, // "06 12 34 56 78" — la normalisation wa.me se fait côté panel.
            phase: "acquisition",
            source: "cold_call",
          };
          break;
        case "no_tenant":
          payload = {
            name,
            phone: spec.phone,
            phase: "acquisition",
            source: "cold_call",
            // tenantId absent : confirme l'absence conditionnelle du TenantPanel.
          };
          break;
        case "ghost_tenant": {
          // Wipe any leftover ghost tenant from a previous run first.
          const stale = await ctx.db
            .query("tenants")
            .withIndex("by_slug", (q) => q.eq("slug", E2E_TE_GHOST_TENANT_SLUG))
            .unique();
          if (stale !== null) await ctx.db.delete(stale._id);

          // Insert a fresh ghost tenant (minimum viable shape — schema enforces
          // required fields). We immediately delete it after backlinking so the
          // prospect ends with a dangling `tenantId` pointer.
          const ghostTenantId = await ctx.db.insert("tenants", {
            slug: E2E_TE_GHOST_TENANT_SLUG,
            name: "Ghost Tenant (E2E T-E)",
            siret: "00000000000000",
            status: "active",
            createdAt: now,
          });

          payload = {
            name,
            phone: spec.phone,
            phase: "operationnel",
            source: "cold_call",
            tenantId: ghostTenantId,
          };
          break;
        }
      }

      const existing = await ctx.db
        .query("prospects")
        .filter((q) => q.eq(q.field("name"), name))
        .first();

      if (existing === null) {
        await ctx.db.insert("prospects", {
          ...payload,
          createdAt: now,
          updatedAt: now,
        });
        prospectsCreated += 1;
      } else {
        await ctx.db.patch(existing._id, {
          phase: payload.phase,
          tabletteMode: payload.tabletteMode,
          siret: payload.siret,
          address: payload.address,
          contactName: payload.contactName,
          email: payload.email,
          milestones: payload.milestones,
          interactions: payload.interactions,
          tenantId: payload.tenantId,
          updatedAt: now,
        });
        prospectsUpdated += 1;
      }

      // Post-insert cleanup for ghost_tenant : delete the tenant we just
      // backlinked to leave the prospect with a dangling pointer (T25).
      if (spec.kind === "ghost_tenant") {
        const ghost = await ctx.db
          .query("tenants")
          .withIndex("by_slug", (q) => q.eq("slug", E2E_TE_GHOST_TENANT_SLUG))
          .unique();
        if (ghost !== null) await ctx.db.delete(ghost._id);
      }
    }

    return { prospectsCreated, prospectsUpdated };
  },
});

/**
 * Wipe the E2E-T-E fiche prospect détaillée seed. Filters by the sentinel
 * name prefix (`[E2E T-E] *`) — never touches real prospect rows. Also wipes
 * any lingering ghost tenant (slug = `e2e-te-ghost-tenant`) defensively.
 */
export const wipeE2EFicheProspectDetails = internalMutation({
  args: {},
  returns: v.object({
    prospectsDeleted: v.number(),
    ghostTenantsDeleted: v.number(),
  }),
  handler: async (ctx) => {
    let prospectsDeleted = 0;
    let ghostTenantsDeleted = 0;

    for (const spec of TE_SEED_SPECS) {
      const name = `${E2E_TE_PROSPECT_PREFIX}${spec.nameSuffix}`;
      const existing = await ctx.db
        .query("prospects")
        .filter((q) => q.eq(q.field("name"), name))
        .first();
      if (existing !== null) {
        await ctx.db.delete(existing._id);
        prospectsDeleted += 1;
      }
    }

    const stale = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", E2E_TE_GHOST_TENANT_SLUG))
      .unique();
    if (stale !== null) {
      await ctx.db.delete(stale._id);
      ghostTenantsDeleted += 1;
    }

    return { prospectsDeleted, ghostTenantsDeleted };
  },
});

// -----------------------------------------------------------------------------
// E2E-MC-B seed — populate the campagnes picker (MC5-MC9) with active
// templates scoped to `test-t1`. `test-t2` stays empty to exercise the
// empty-state CSM card (MC8). Sentinel `key` prefix (`e2e_mc_b_`) lets
// `wipeE2ECampagnesTemplates` delete *exactly* what this seed inserted
// without touching real templates.
//
// 2 templates inserted on `test-t1` :
//
//  - `e2e_mc_b_welcome_back` (texte-only, simple variables) — exerce le
//    formulaire MC10 « texte seul » + l'affichage par défaut MC7.
//  - `e2e_mc_b_weekend_promo` (texte + slider + time) — exerce MC10
//    « formulaire mixte 5 champs » + MC12 « preview live + counter ».
//
// Les 2 templates respectent les bounds (ADR 0006 / PRD 80 §4) :
// `language: "fr"`, `containsAlcohol: false`, body < 200 chars,
// `maxDiscountPercent ≤ 50`, variables ∈ ALLOWED_TEMPLATE_VARIABLES.
// -----------------------------------------------------------------------------

const E2E_MC_B_TEMPLATE_KEY_PREFIX = "e2e_mc_b_";

type CampagnesTemplateSpec = {
  key: string;
  label: string;
  body: string;
  variables: ReadonlyArray<
    | "prenom_client"
    | "nom_resto"
    | "item_hero"
    | "discount"
    | "nom_plat"
    | "heure_debut"
    | "heure_fin"
    | "jour"
  >;
  deepLinkTarget: "catalogue" | "home";
  maxDiscountPercent: number;
};

const MC_B_TEMPLATE_SPECS: ReadonlyArray<CampagnesTemplateSpec> = [
  {
    key: `${E2E_MC_B_TEMPLATE_KEY_PREFIX}welcome_back`,
    label: "On t'a manqué",
    body: "Bonjour {prenom_client}, on a une nouvelle offre rien que pour toi chez {nom_resto} !",
    variables: ["prenom_client", "nom_resto"],
    deepLinkTarget: "catalogue",
    maxDiscountPercent: 0,
  },
  {
    key: `${E2E_MC_B_TEMPLATE_KEY_PREFIX}weekend_promo`,
    label: "Promo weekend",
    body: "Le {jour}, -{discount}% sur le {nom_plat} de {heure_debut} à {heure_fin} chez {nom_resto} !",
    variables: [
      "jour",
      "discount",
      "nom_plat",
      "heure_debut",
      "heure_fin",
      "nom_resto",
    ],
    deepLinkTarget: "catalogue",
    maxDiscountPercent: 50,
  },
];

/**
 * Seed 2 `notificationTemplates` scope=tenant active sur `test-t1` pour
 * exercer le picker campagnes (MC5-MC9) et le formulaire dynamique
 * (MC10/MC12). Idempotent par `key` sentinellé : re-runs patchent les
 * rangées existantes (label/body/variables réinitialisés au shape canonique).
 *
 * Optionnel arg `tenantSlug` (default `test-t1`) permet de seeder un autre
 * tenant en cas de besoin futur (ex. seed multi-tenant pour MC6 isolation).
 */
export const seedE2ECampagnesTemplates = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    templatesCreated: v.number(),
    templatesUpdated: v.number(),
  }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant with slug "${slug}" not found.`,
      });
    }

    const now = Date.now();
    let templatesCreated = 0;
    let templatesUpdated = 0;

    for (const spec of MC_B_TEMPLATE_SPECS) {
      const existing = await ctx.db
        .query("notificationTemplates")
        .withIndex("by_key", (q) => q.eq("key", spec.key))
        .unique();

      const payload = {
        key: spec.key,
        label: spec.label,
        body: spec.body,
        variables:
          spec.variables as unknown as Doc<"notificationTemplates">["variables"],
        deepLinkTarget: spec.deepLinkTarget,
        scope: "tenant" as const,
        maxDiscountPercent: spec.maxDiscountPercent,
        language: "fr" as const,
        containsAlcohol: false,
        active: true,
        tenantId: tenant._id,
      };

      if (existing === null) {
        await ctx.db.insert("notificationTemplates", {
          ...payload,
          createdAt: now,
        });
        templatesCreated += 1;
      } else {
        await ctx.db.patch(existing._id, payload);
        templatesUpdated += 1;
      }
    }

    return {
      tenantId: tenant._id,
      templatesCreated,
      templatesUpdated,
    };
  },
});

/**
 * Wipe the E2E-MC-B campagnes templates seed. Filters by the sentinel `key`
 * prefix (`e2e_mc_b_*`) — never touches real templates.
 */
export const wipeE2ECampagnesTemplates = internalMutation({
  args: {},
  returns: v.object({ templatesDeleted: v.number() }),
  handler: async (ctx) => {
    let templatesDeleted = 0;
    for (const spec of MC_B_TEMPLATE_SPECS) {
      const existing = await ctx.db
        .query("notificationTemplates")
        .withIndex("by_key", (q) => q.eq("key", spec.key))
        .unique();
      if (existing !== null) {
        await ctx.db.delete(existing._id);
        templatesDeleted += 1;
      }
    }
    return { templatesDeleted };
  },
});

// -----------------------------------------------------------------------------
// E2E-MC-C seed — populate the campagnes form + violation parcours (MC10-MC13).
// MC10 / MC12 réutilisent les templates MC-B (`weekend_promo` pour le form
// dynamique + `welcome_back` pour la preview live simple), MC11 ne nécessite
// AUCUN seed (URL forgée vers un templateId inexistant). MC13 demande UN
// template « corrompu » avec `containsAlcohol: true` actif (défense en
// profondeur — l'écran doit surfacer la bannière même si le schema l'a laissé
// passer). Sentinel `key = e2e_mc_c_alcohol_violation` pour wipe surgical.
// -----------------------------------------------------------------------------

const E2E_MC_C_ALCOHOL_TEMPLATE_KEY = "e2e_mc_c_alcohol_violation";

/**
 * Seed 1 `notificationTemplate` scope=tenant active sur `test-t1` avec
 * `containsAlcohol: true` — exerce le path défensif de `CampaignPreview` qui
 * doit surfacer la bannière FR « Mention d'alcool interdite » et désactiver
 * le bouton « Envoyer maintenant » MÊME si le template a réussi à se
 * persister (cas de régression d'un check backend amont).
 *
 * Idempotent par `key` sentinellé.
 */
export const seedE2ECampagnesCorruptedTemplate = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    templateCreated: v.boolean(),
    templateUpdated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant with slug "${slug}" not found.`,
      });
    }

    const now = Date.now();
    const payload = {
      key: E2E_MC_C_ALCOHOL_TEMPLATE_KEY,
      label: "[CORROMPU] Apéro vin rouge",
      body: "Bonjour {prenom_client}, ce soir on offre un verre de vin rouge avec le {nom_plat} !",
      variables: [
        "prenom_client",
        "nom_plat",
      ] as unknown as Doc<"notificationTemplates">["variables"],
      deepLinkTarget: "catalogue" as const,
      scope: "tenant" as const,
      maxDiscountPercent: 0,
      language: "fr" as const,
      containsAlcohol: true, // ← le flag défensif que MC13 vérifie
      active: true,
      tenantId: tenant._id,
    };

    const existing = await ctx.db
      .query("notificationTemplates")
      .withIndex("by_key", (q) => q.eq("key", E2E_MC_C_ALCOHOL_TEMPLATE_KEY))
      .unique();

    if (existing === null) {
      await ctx.db.insert("notificationTemplates", {
        ...payload,
        createdAt: now,
      });
      return {
        tenantId: tenant._id,
        templateCreated: true,
        templateUpdated: false,
      };
    }
    await ctx.db.patch(existing._id, payload);
    return {
      tenantId: tenant._id,
      templateCreated: false,
      templateUpdated: true,
    };
  },
});

/**
 * Wipe the E2E-MC-C corrupted template seed. Filtre par `key` sentinellé.
 */
export const wipeE2ECampagnesCorruptedTemplate = internalMutation({
  args: {},
  returns: v.object({ templateDeleted: v.boolean() }),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("notificationTemplates")
      .withIndex("by_key", (q) => q.eq("key", E2E_MC_C_ALCOHOL_TEMPLATE_KEY))
      .unique();
    if (existing !== null) {
      await ctx.db.delete(existing._id);
      return { templateDeleted: true };
    }
    return { templateDeleted: false };
  },
});

// -----------------------------------------------------------------------------
// E2E-MC-D seed — populate the campagnes SEND parcours (MC14-MC16).
// Adds 4 push-enrolled customers to the existing 6 seedés par MC-A so le
// tenant atteint la borne du parcours (≥10 clients, ≥5 push-enrolled,
// ≥3 email-eligible). Insère aussi (optionnel) UN row campaignLaunches
// daté il y a 1 h pour exercer le path anti-anomaly TOO_FREQUENT_48H
// (MC15). MC16 (cross-tenant) ne demande aucun seed supplémentaire.
//
// Sentinel email suffix (`@kb-e2e-mc-d.test`) pour wipe surgical séparé
// de MC-A. Sentinel `templateId` du launch = celui de welcome_back MC-B
// (donc le wipe MC-B ne le casse pas, car la fk vers templateId est
// optionnelle côté schema).
// -----------------------------------------------------------------------------

const E2E_MC_D_EMAIL_SUFFIX = "@kb-e2e-mc-d.test";

const MC_D_PUSH_CUSTOMER_SPECS: ReadonlyArray<{
  local: string;
  firstName: string;
  phone: string;
}> = [
  { local: "push-1", firstName: "Gabriel", phone: "+33600000501" },
  { local: "push-2", firstName: "Hugo", phone: "+33600000502" },
  { local: "push-3", firstName: "Ines", phone: "+33600000503" },
  { local: "push-4", firstName: "Jasmine", phone: "+33600000504" },
];

/**
 * Seed 4 customers all-three-reach (email + phone + push) linkés à
 * `test-t1` (ou tenant arg) — combinés aux 6 customers déjà seedés par
 * MC-A, on atteint 10 customers totaux avec 6 push + 4 email + 6 phone.
 * Idempotent par `users.email` sentinellé.
 */
export const seedE2EMCSendCustomers = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    customersCreated: v.number(),
    customersReused: v.number(),
    linksCreated: v.number(),
    linksUpdated: v.number(),
  }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant with slug "${slug}" not found.`,
      });
    }

    const now = Date.now();
    let customersCreated = 0;
    let customersReused = 0;
    let linksCreated = 0;
    let linksUpdated = 0;

    for (const spec of MC_D_PUSH_CUSTOMER_SPECS) {
      const email = `${spec.local}${E2E_MC_D_EMAIL_SUFFIX}`;

      // 1. users row.
      let user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      if (user === null) {
        const userId = await ctx.db.insert("users", {
          email,
          name: spec.firstName,
        });
        user = await ctx.db.get(userId);
      }
      if (user === null) {
        throw new ConvexError({ message: "User insert failed (impossible)" });
      }

      // 2. customers fiche (all-three-reach : email + phone + push enrolled
      // + cgvAcceptedAt pour marketing-eligible, cf. consent.ts).
      const reachFields = {
        email,
        phone: spec.phone,
        pushEnrollment: {
          webPushStatus: "enrolled" as const,
        },
      };
      const consentFields = { cgvAcceptedAt: now };
      let customer = await ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
      if (customer === null) {
        const customerId = await ctx.db.insert("customers", {
          userId: user._id,
          firstName: spec.firstName,
          createdAt: now,
          ...reachFields,
          ...consentFields,
        });
        customer = await ctx.db.get(customerId);
        customersCreated += 1;
      } else {
        await ctx.db.patch(customer._id, { ...reachFields, ...consentFields });
        customersReused += 1;
      }
      if (customer === null) {
        throw new ConvexError({
          message: "Customer insert failed (impossible)",
        });
      }

      // 3. customerOrdersPerTenant link (segment actif : commandé < 30 j).
      const segmentFields = {
        totalOrders: 2,
        lastOrderAt: now - 7 * DAY_MS,
        ltv: 40,
      };
      const existingLink = await ctx.db
        .query("customerOrdersPerTenant")
        .withIndex("by_tenant_customer", (q) =>
          q.eq("tenantId", tenant._id).eq("customerId", customer._id),
        )
        .unique();
      if (existingLink === null) {
        await ctx.db.insert("customerOrdersPerTenant", {
          customerId: customer._id,
          tenantId: tenant._id,
          ...segmentFields,
        });
        linksCreated += 1;
      } else {
        await ctx.db.patch(existingLink._id, segmentFields);
        linksUpdated += 1;
      }
    }

    return {
      tenantId: tenant._id,
      customersCreated,
      customersReused,
      linksCreated,
      linksUpdated,
    };
  },
});

/**
 * Wipe the E2E-MC-D push customers seed. Filtre par sentinel email suffix
 * `@kb-e2e-mc-d.test` — ne touche pas le seed MC-A.
 */
export const wipeE2EMCSendCustomers = internalMutation({
  args: {},
  returns: v.object({
    customersDeleted: v.number(),
    usersDeleted: v.number(),
    linksDeleted: v.number(),
  }),
  handler: async (ctx) => {
    let customersDeleted = 0;
    let usersDeleted = 0;
    let linksDeleted = 0;

    for (const spec of MC_D_PUSH_CUSTOMER_SPECS) {
      const email = `${spec.local}${E2E_MC_D_EMAIL_SUFFIX}`;
      const user = await ctx.db
        .query("users")
        .withIndex("email", (q) => q.eq("email", email))
        .first();
      if (user === null) continue;

      const customer = await ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();
      if (customer !== null) {
        for await (const link of ctx.db
          .query("customerOrdersPerTenant")
          .withIndex("by_customer", (q) => q.eq("customerId", customer._id))) {
          await ctx.db.delete(link._id);
          linksDeleted += 1;
        }
        await ctx.db.delete(customer._id);
        customersDeleted += 1;
      }

      await ctx.db.delete(user._id);
      usersDeleted += 1;
    }

    return { customersDeleted, usersDeleted, linksDeleted };
  },
});

/**
 * Seed 1 `campaignLaunches` row daté il y a 1 h pour le tenant — exerce
 * la branche anti-anomaly TOO_FREQUENT_48H (MC15) : tout nouvel envoi
 * dans les 48 h suivant cette ligne doit ouvrir le `CampaignAnomalyDialog`.
 *
 * Idempotent : si un row récent (< 48 h) existe déjà pour ce tenant avec
 * `recipients: 10`, on retourne sans rien réinsérer. Sinon on inserts.
 *
 * Pour RE-TESTER MC14 (envoi nominal qui DOIT passer), il faut d'abord
 * appeler `wipeE2EMCAnomalyLaunch` puis re-déclencher MC15 séparément.
 */
export const seedE2EMCAnomalyLaunch = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    launchCreated: v.boolean(),
    launchReused: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant with slug "${slug}" not found.`,
      });
    }

    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Idempotence : si un row récent (< 48 h) avec recipients=10 et templateId absent existe déjà, réutiliser.
    const recent = await ctx.db
      .query("campaignLaunches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .collect();
    const sentinel = recent.find(
      (r) =>
        r.launchedAt > now - 48 * 60 * 60 * 1000 &&
        r.recipients === 10 &&
        r.templateId === undefined,
    );
    if (sentinel !== undefined) {
      return { tenantId: tenant._id, launchCreated: false, launchReused: true };
    }

    await ctx.db.insert("campaignLaunches", {
      tenantId: tenant._id,
      scope: "tenant",
      launchedAt: oneHourAgo,
      recipients: 10,
      // templateId omis volontairement (legacy-shape) pour distinguer du « vrai » launch
      // que MC14 produira (qui carry templateId + 6 counters).
    });
    return { tenantId: tenant._id, launchCreated: true, launchReused: false };
  },
});

/**
 * Wipe the E2E-MC-D anomaly launch seed. Supprime UNIQUEMENT les rows
 * avec recipients=10 et templateId absent (notre sentinellé legacy-shape).
 * Préserve les vrais launches produits par MC14 / MC17 (qui carry
 * templateId + counters).
 */
export const wipeE2EMCAnomalyLaunch = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({ launchesDeleted: v.number() }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) return { launchesDeleted: 0 };

    let launchesDeleted = 0;
    const launches = await ctx.db
      .query("campaignLaunches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .collect();
    for (const row of launches) {
      if (row.recipients === 10 && row.templateId === undefined) {
        await ctx.db.delete(row._id);
        launchesDeleted += 1;
      }
    }
    return { launchesDeleted };
  },
});

// -----------------------------------------------------------------------------
// E2E-MC-E seed — populate l'historique campagnes de test-t2 pour MC18.
// Le parcours MC18 demande à forger l'URL `/t/T1/campagnes/historique/<launchId_T2>`
// pour vérifier que le manager de T1 voit « Lancement introuvable » et NON
// la fiche du launch de T2. Pour ça il nous faut UN vrai launchId qui
// appartient à T2 — d'où ce seed. Retourne le launchId pour qu'on puisse
// le réutiliser dans l'URL forgée.
//
// MC17 réutilise le launch réel produit par MC14 sur test-t1 (pas besoin
// de seed). MC19 demande au contraire un tenant SANS launch — on testera
// MC19 sur test-t2 AVANT de lancer ce seed (séquence imposée).
//
// Sentinellé par `recipients: 42` + `templateId: undefined` (la combinaison
// est unique à ce seed — un vrai launch carry les 6 counters + un
// templateId).
// -----------------------------------------------------------------------------

/**
 * Seed 1 `campaignLaunches` row sur test-t2 (ou tenant arg) avec un shape
 * historique complet (6 counters), daté d'il y a 6 h. Retourne le `launchId`
 * pour qu'Alex puisse le coller dans l'URL forgée MC18.
 *
 * Idempotent : si un row sentinellé existe déjà sur ce tenant, retourne
 * son _id sans rien réinsérer.
 */
export const seedE2EMCT2Launch = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    launchId: v.id("campaignLaunches"),
    launchCreated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t2";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant with slug "${slug}" not found.`,
      });
    }

    const now = Date.now();
    const sixHoursAgo = now - 6 * 60 * 60 * 1000;

    // Idempotence : si un launch sentinellé (recipients=42 + sans templateId)
    // existe déjà, le réutiliser.
    const existing = await ctx.db
      .query("campaignLaunches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .collect();
    const sentinel = existing.find(
      (r) => r.recipients === 42 && r.templateId === undefined,
    );
    if (sentinel !== undefined) {
      return {
        tenantId: tenant._id,
        launchId: sentinel._id,
        launchCreated: false,
      };
    }

    const launchId = await ctx.db.insert("campaignLaunches", {
      tenantId: tenant._id,
      scope: "tenant",
      launchedAt: sixHoursAgo,
      recipients: 42, // sentinellé (jamais produit par un vrai send dans la run)
      sent: 38,
      queued: 2,
      skippedIneligible: 1,
      skippedRateLimited: 1,
      skippedUnreachable: 0,
      // templateId omis : le legacy-shape, valide côté schema (optional).
    });

    return { tenantId: tenant._id, launchId, launchCreated: true };
  },
});

/**
 * Wipe the E2E-MC-E T2 launch seed. Supprime UNIQUEMENT les rows
 * sentinellés (recipients=42 + templateId absent). Préserve les vrais
 * launches.
 */
export const wipeE2EMCT2Launch = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({ launchesDeleted: v.number() }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t2";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) return { launchesDeleted: 0 };

    let launchesDeleted = 0;
    const launches = await ctx.db
      .query("campaignLaunches")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .collect();
    for (const row of launches) {
      if (row.recipients === 42 && row.templateId === undefined) {
        await ctx.db.delete(row._id);
        launchesDeleted += 1;
      }
    }
    return { launchesDeleted };
  },
});

// -----------------------------------------------------------------------------
// E2E-MC-F seed — populate `orders` payées sur 90 jours pour exercer le
// Dashboard 4 KPI cards (MC20/MC21) + Stats RangePicker (MC22/MC23/MC24) +
// LineChart Revenus par jour (MC25/MC26/MC27).
//
// Sentinellé par `restaurantNote` qui commence par `[E2E MC-F]` (champ peu
// utilisé en V1, on peut filtrer dessus pour le wipe sans toucher de vrais
// orders).
//
// Distribution sur test-t1 (15 orders) :
//   - 2 orders aujourd'hui (1 livrée paid + 1 en préparation paid)
//   - 3 orders dans les 7 derniers jours (livrée paid)
//   - 5 orders entre J-8 et J-30 (livrée paid)
//   - 5 orders entre J-31 et J-90 (livrée paid)
//
// Distribution sur test-t2 (2 orders) :
//   - 2 orders aujourd'hui (livrée paid) avec totaux TRÈS différents de T1
//     pour exercer MC21 (isolation cross-tenant via switcher).
//
// MC27 (empty state LineChart) → testable sur test-t2 AVANT le run du seed
// T2 (séquence imposée, comme MC18/MC19).
// -----------------------------------------------------------------------------

const E2E_MC_F_NOTE_PREFIX = "[E2E MC-F] ";

type MCFOrderSpec = {
  /** Position de l'order dans le passé (daysAgo = 0 → aujourd'hui). */
  daysAgo: number;
  /** Cents — pricingSnapshot.total. */
  totalCents: number;
  /** Si true, l'order reste en « en préparation » (1 « en cours »). Sinon livrée. */
  enCours?: boolean;
};

const MC_F_T1_ORDER_SPECS: ReadonlyArray<MCFOrderSpec> = [
  // 2 aujourd'hui
  { daysAgo: 0, totalCents: 2450 }, // 24,50 €
  { daysAgo: 0, totalCents: 1890, enCours: true }, // 18,90 € en cours
  // 3 dans les 7 derniers jours
  { daysAgo: 1, totalCents: 3200 }, // 32,00 €
  { daysAgo: 3, totalCents: 2100 }, // 21,00 €
  { daysAgo: 5, totalCents: 4550 }, // 45,50 €
  // 5 entre J-8 et J-30
  { daysAgo: 9, totalCents: 1850 },
  { daysAgo: 13, totalCents: 2700 },
  { daysAgo: 18, totalCents: 3950 },
  { daysAgo: 22, totalCents: 2350 },
  { daysAgo: 28, totalCents: 3100 },
  // 5 entre J-31 et J-90
  { daysAgo: 38, totalCents: 2200 },
  { daysAgo: 47, totalCents: 4100 },
  { daysAgo: 60, totalCents: 1750 },
  { daysAgo: 74, totalCents: 5200 },
  { daysAgo: 87, totalCents: 2850 },
];

const MC_F_T2_ORDER_SPECS: ReadonlyArray<MCFOrderSpec> = [
  // 2 aujourd'hui avec totaux très distincts de T1 → MC21 « CA distinct »
  { daysAgo: 0, totalCents: 9800 }, // 98,00 €
  { daysAgo: 0, totalCents: 10200 }, // 102,00 €
];

/**
 * Helper interne : insère 1 order sur (tenantId, customerId) à partir d'un
 * spec. Idempotent par `restaurantNote` sentinellé.
 */
async function insertMCFOrder(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
  spec: MCFOrderSpec,
  sentinelTag: string,
  now: number,
): Promise<"created" | "reused"> {
  const createdAt = now - spec.daysAgo * DAY_MS;
  const paidAt = createdAt + 60 * 1000; // payé 60 s après création.
  const note = `${E2E_MC_F_NOTE_PREFIX}${sentinelTag}`;

  // Idempotence : si un order avec exactement cette note existe déjà sur
  // ce tenant, le réutiliser. Pas d'index dédié `restaurantNote` — on
  // filtre côté handler (le seed n'est pas hot path).
  const existing = await ctx.db
    .query("orders")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .filter((q) => q.eq(q.field("restaurantNote"), note))
    .first();
  if (existing !== null) return "reused";

  await ctx.db.insert("orders", {
    tenantId,
    customerId,
    status: spec.enCours ? "en préparation" : "livrée",
    mode: "delivery",
    source: "direct",
    address: "12 rue de la République, 75011 Paris",
    restaurantNote: note,
    pricingSnapshot: {
      subtotal: Math.round(spec.totalCents * 0.85),
      deliveryFee: Math.round(spec.totalCents * 0.15),
      total: spec.totalCents,
    },
    createdAt,
    paidAt,
    acceptedAt: spec.enCours ? createdAt + 5 * 60 * 1000 : undefined,
    readyAt: spec.enCours ? undefined : createdAt + 25 * 60 * 1000,
    handedOverAt: spec.enCours ? undefined : createdAt + 35 * 60 * 1000,
    completedAt: spec.enCours ? undefined : createdAt + 55 * 60 * 1000,
  });
  return "created";
}

/**
 * Seed 15 orders payées sur test-t1 réparties 7/30/90j + 1 en cours
 * (status="en préparation"). Réutilise les customers déjà seedés sur
 * test-t1 (`seedE2ECustomerKPIs` + `seedE2EMCSendCustomers`) en rotation
 * round-robin. Idempotent par `restaurantNote` sentinellé.
 */
export const seedE2EOrdersT1 = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    ordersCreated: v.number(),
    ordersReused: v.number(),
  }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant with slug "${slug}" not found.`,
      });
    }

    // Récupérer les customers linkés à ce tenant via customerOrdersPerTenant.
    const links = await ctx.db
      .query("customerOrdersPerTenant")
      .withIndex("by_tenant_customer", (q) => q.eq("tenantId", tenant._id))
      .collect();
    if (links.length === 0) {
      throw new ConvexError({
        message: `No customers linked to tenant "${slug}" — run seedE2ECustomerKPIs first.`,
      });
    }
    const customerIds = links.map((l) => l.customerId);

    const now = Date.now();
    let ordersCreated = 0;
    let ordersReused = 0;

    for (let i = 0; i < MC_F_T1_ORDER_SPECS.length; i++) {
      const spec = MC_F_T1_ORDER_SPECS[i];
      // Round-robin sur les customers linkés.
      const customerId = customerIds[i % customerIds.length];
      const tag = `T1-${i.toString().padStart(2, "0")}`;
      const outcome = await insertMCFOrder(
        ctx,
        tenant._id,
        customerId,
        spec,
        tag,
        now,
      );
      if (outcome === "created") ordersCreated += 1;
      else ordersReused += 1;
    }

    return { tenantId: tenant._id, ordersCreated, ordersReused };
  },
});

/**
 * Seed 2 orders payées aujourd'hui sur test-t2 (totaux distincts de T1)
 * pour exercer MC21 (isolation cross-tenant via switcher). Réutilise les
 * customers de test-t1 (link partagé via customerOrdersPerTenant insertion
 * directe — les customers eux-mêmes sont GLOBAL, ADR 0010).
 *
 * Idempotent par `restaurantNote` sentinellé.
 */
export const seedE2EOrdersT2 = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    ordersCreated: v.number(),
    ordersReused: v.number(),
    linksCreated: v.number(),
  }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t2";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant with slug "${slug}" not found.`,
      });
    }

    // Pour T2 on a besoin d'au moins 2 customers linkés. Vérifier le link
    // pour les 2 premiers customers globaux et le créer s'il manque.
    const allCustomers = await ctx.db.query("customers").collect();
    const seededCustomers = allCustomers
      .filter(
        (c) =>
          c.email?.endsWith("@kb-e2e-kpi.test") ||
          c.email?.endsWith("@kb-e2e-mc-d.test"),
      )
      .slice(0, 2);
    if (seededCustomers.length < 2) {
      throw new ConvexError({
        message: `Not enough seeded customers — run seedE2ECustomerKPIs + seedE2EMCSendCustomers first.`,
      });
    }

    const now = Date.now();
    let linksCreated = 0;
    for (const customer of seededCustomers) {
      const existing = await ctx.db
        .query("customerOrdersPerTenant")
        .withIndex("by_tenant_customer", (q) =>
          q.eq("tenantId", tenant._id).eq("customerId", customer._id),
        )
        .unique();
      if (existing === null) {
        await ctx.db.insert("customerOrdersPerTenant", {
          customerId: customer._id,
          tenantId: tenant._id,
          totalOrders: 1,
          lastOrderAt: now,
          ltv: 100,
        });
        linksCreated += 1;
      }
    }

    let ordersCreated = 0;
    let ordersReused = 0;
    for (let i = 0; i < MC_F_T2_ORDER_SPECS.length; i++) {
      const spec = MC_F_T2_ORDER_SPECS[i];
      const customerId = seededCustomers[i % seededCustomers.length]._id;
      const tag = `T2-${i.toString().padStart(2, "0")}`;
      const outcome = await insertMCFOrder(
        ctx,
        tenant._id,
        customerId,
        spec,
        tag,
        now,
      );
      if (outcome === "created") ordersCreated += 1;
      else ordersReused += 1;
    }

    return { tenantId: tenant._id, ordersCreated, ordersReused, linksCreated };
  },
});

/**
 * Insert UNE order `nouvelle` directement payée sur test-t1 pour exercer le
 * happy path KB Orders (#401 direct livraison / #402 click & collect).
 * Sentinellé `[E2E KBO-CMD]` pour wipe ciblé.
 *
 * Idempotent par compteur — recrée si déjà supprimée par wipe.
 */
export const seedE2EKBOrdersNouvelleCmd = internalMutation({
  args: {
    mode: v.union(v.literal("delivery"), v.literal("pickup")),
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({
    orderId: v.id("orders"),
    customerName: v.string(),
  }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({ message: `Tenant "${slug}" not found.` });
    }
    const links = await ctx.db
      .query("customerOrdersPerTenant")
      .withIndex("by_tenant_customer", (q) => q.eq("tenantId", tenant._id))
      .first();
    if (links === null) {
      throw new ConvexError({
        message: `No customer linked to "${slug}" — run seedE2ECustomerKPIs first.`,
      });
    }
    const customer = await ctx.db.get(links.customerId);
    if (customer === null) {
      throw new ConvexError({ message: "Customer missing." });
    }

    const now = Date.now();
    const note = `[E2E KBO-CMD] ${args.mode} ${now}`;
    const orderId = await ctx.db.insert("orders", {
      tenantId: tenant._id,
      customerId: customer._id,
      status: "nouvelle",
      mode: args.mode,
      source: "direct",
      address:
        args.mode === "delivery" ? "12 rue de la Paix, 75002 Paris" : undefined,
      lat: args.mode === "delivery" ? 48.8694 : undefined,
      lng: args.mode === "delivery" ? 2.3318 : undefined,
      customerPhone: customer.phone ?? "0612345678",
      restaurantNote: note,
      pricingSnapshot: {
        subtotal: 2400, // 24,00 €
        deliveryFee: args.mode === "delivery" ? 350 : 0,
        total: args.mode === "delivery" ? 2750 : 2400,
      },
      paymentRef: `pi_e2e_kbocmd_${now}`,
      createdAt: now,
      paidAt: now,
    });
    await ctx.db.insert("orderItems", {
      tenantId: tenant._id,
      orderId,
      itemName: "Burger maison",
      unitPrice: 1200,
      quantity: 1,
      modifiers: [
        { groupName: "Cuisson", optionName: "À point", priceDelta: 0 },
      ],
      allergens: ["gluten", "œufs", "lait"],
    });
    await ctx.db.insert("orderItems", {
      tenantId: tenant._id,
      orderId,
      itemName: "Frites",
      unitPrice: 600,
      quantity: 2,
      modifiers: [],
      allergens: [],
    });
    await ctx.db.insert("orderEvents", {
      tenantId: tenant._id,
      orderId,
      status: "nouvelle",
      at: now,
    });

    return {
      orderId,
      customerName: customer.firstName ?? "Client E2E",
    };
  },
});

/**
 * #404 — Déclenche manuellement le tick `expireIfNotAcknowledged` pour
 * simuler le timeout 5 min sans attendre. Utilise le SCHEDULER comme en
 * production (`runAfter(0, ...)`) pour rester fidèle au chemin réel — le tick
 * ré-évalue l'état courant donc reste idempotent (no-op si déjà acceptée /
 * refusée / déjà auto_expired).
 *
 * Helper E2E uniquement, sentinellé par usage explicite via convex CLI.
 */
export const triggerE2EAutoExpireKbOrder = internalMutation({
  args: { orderId: v.id("orders") },
  returns: v.object({ scheduled: v.boolean() }),
  handler: async (ctx, args) => {
    const order = await ctx.db.get(args.orderId);
    if (order === null) {
      throw new ConvexError({
        message: `Order ${args.orderId} not found.`,
      });
    }
    await ctx.scheduler.runAfter(
      0,
      internal.lib.orders.workflow.expireIfNotAcknowledged,
      { tenantId: order.tenantId, orderId: args.orderId },
    );
    return { scheduled: true };
  },
});

/**
 * Mix terminaux pour KBO-OPS3 — historique des cmds (#417).
 *
 * Insère 8 orders sentinellées `[E2E KBO-OPS3]` sur le tenant arg (default
 * `test-t1`) avec un panachage des 4 statuts terminaux (livrée /
 * collectée / refusée / auto_expired) et des dates variées (today / -3j /
 * -10j / -40j) pour exercer les 4 onglets PRD 20 §8 + les 4 filtres période.
 *
 * Pas de events / pas de refusalReason — la liste historique n'en a pas
 * besoin (le badge utilise `status` directement), le détail lit les events
 * via `getOrder` mais en V1 il rend gracieusement même sans events
 * (read-only sur les terminaux).
 *
 * Idempotent par compteur — recrée si déjà supprimé par wipe.
 */
export const seedE2EKBOrdersHistoryMix = internalMutation({
  args: { tenantSlug: v.optional(v.string()) },
  returns: v.object({ created: v.number() }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({ message: `Tenant "${slug}" not found.` });
    }
    const link = await ctx.db
      .query("customerOrdersPerTenant")
      .withIndex("by_tenant_customer", (q) => q.eq("tenantId", tenant._id))
      .first();
    if (link === null) {
      throw new ConvexError({
        message: `No customer linked to "${slug}" — run seedE2ECustomerKPIs first.`,
      });
    }
    const customer = await ctx.db.get(link.customerId);
    if (customer === null) {
      throw new ConvexError({ message: "Customer missing." });
    }

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    // (status, mode, addressNeeded, daysAgo, total, itemName)
    const fixtures = [
      // Today — exerce le filtre "Aujourd'hui"
      {
        status: "livrée",
        mode: "delivery",
        daysAgo: 0,
        total: 2750,
        item: "Burger maison",
      },
      {
        status: "livrée",
        mode: "delivery",
        daysAgo: 0,
        total: 1450,
        item: "Salade César",
      },
      {
        status: "collectée",
        mode: "pickup",
        daysAgo: 0,
        total: 1800,
        item: "Pizza Margherita",
      },
      {
        status: "refusée",
        mode: "delivery",
        daysAgo: 0,
        total: 3200,
        item: "Bowl saumon",
      },
      {
        status: "auto_expired",
        mode: "pickup",
        daysAgo: 0,
        total: 1100,
        item: "Sandwich poulet",
      },
      // -3j — toujours visible sur 7 jours, hors aujourd'hui
      {
        status: "livrée",
        mode: "pickup",
        daysAgo: 3,
        total: 2100,
        item: "Pâtes carbonara",
      },
      {
        status: "refusée",
        mode: "delivery",
        daysAgo: 3,
        total: 1900,
        item: "Wrap végé",
      },
      // -10j — visible sur 30j seulement
      {
        status: "collectée",
        mode: "pickup",
        daysAgo: 10,
        total: 1300,
        item: "Quiche lorraine",
      },
      // -40j — visible uniquement sur "Tout"
      {
        status: "livrée",
        mode: "delivery",
        daysAgo: 40,
        total: 2500,
        item: "Risotto champignons",
      },
    ] as const;

    let created = 0;
    for (const f of fixtures) {
      const createdAt = now - f.daysAgo * DAY;
      const note = `[E2E KBO-OPS3] ${f.status} ${f.daysAgo}j ${createdAt}`;
      const orderId = await ctx.db.insert("orders", {
        tenantId: tenant._id,
        customerId: customer._id,
        status: f.status,
        mode: f.mode,
        source: "direct",
        address:
          f.mode === "delivery" ? "12 rue de la Paix, 75002 Paris" : undefined,
        lat: f.mode === "delivery" ? 48.8694 : undefined,
        lng: f.mode === "delivery" ? 2.3318 : undefined,
        customerPhone: customer.phone ?? "0612345678",
        restaurantNote: note,
        pricingSnapshot: {
          subtotal: f.total - (f.mode === "delivery" ? 350 : 0),
          deliveryFee: f.mode === "delivery" ? 350 : 0,
          total: f.total,
        },
        paymentRef: `pi_e2e_ops3_${createdAt}`,
        createdAt,
        paidAt: createdAt,
        // Stamp les transitions appropriées au statut final pour que le détail
        // affiche un timestamp cohérent.
        ...(f.status === "livrée" || f.status === "collectée"
          ? {
              acceptedAt: createdAt + 60_000,
              readyAt: createdAt + 600_000,
              handedOverAt: createdAt + 900_000,
              completedAt: createdAt + 1_200_000,
            }
          : {}),
        ...(f.status === "refusée" ? { refusedAt: createdAt + 30_000 } : {}),
        ...(f.status === "auto_expired"
          ? { autoExpiredAt: createdAt + 300_000 }
          : {}),
      });
      await ctx.db.insert("orderItems", {
        tenantId: tenant._id,
        orderId,
        itemName: f.item,
        unitPrice: f.total - (f.mode === "delivery" ? 350 : 0),
        quantity: 1,
        modifiers: [],
        allergens: [],
      });
      created += 1;
    }
    return { created };
  },
});

/**
 * Wipe toutes les orders sentinellées `[E2E KBO-OPS3] *`.
 */
export const wipeE2EKBOrdersHistoryMix = internalMutation({
  args: {},
  returns: v.object({ ordersDeleted: v.number() }),
  handler: async (ctx) => {
    let deleted = 0;
    const all = await ctx.db.query("orders").collect();
    for (const row of all) {
      if (row.restaurantNote?.startsWith("[E2E KBO-OPS3] ")) {
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) =>
            q.eq("tenantId", row.tenantId).eq("orderId", row._id),
          )
          .collect();
        for (const it of items) await ctx.db.delete(it._id);
        const events = await ctx.db
          .query("orderEvents")
          .withIndex("by_order", (q) =>
            q.eq("tenantId", row.tenantId).eq("orderId", row._id),
          )
          .collect();
        for (const ev of events) await ctx.db.delete(ev._id);
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { ordersDeleted: deleted };
  },
});

/**
 * Wipe toutes les orders sentinellées `[E2E KBO-CMD] *` (toutes les cmds
 * créées par `seedE2EKBOrdersNouvelleCmd`).
 */
export const wipeE2EKBOrdersNouvelleCmd = internalMutation({
  args: {},
  returns: v.object({ ordersDeleted: v.number() }),
  handler: async (ctx) => {
    let deleted = 0;
    const all = await ctx.db.query("orders").collect();
    for (const row of all) {
      if (row.restaurantNote?.startsWith("[E2E KBO-CMD] ")) {
        const items = await ctx.db
          .query("orderItems")
          .withIndex("by_order", (q) =>
            q.eq("tenantId", row.tenantId).eq("orderId", row._id),
          )
          .collect();
        for (const it of items) await ctx.db.delete(it._id);
        const events = await ctx.db
          .query("orderEvents")
          .withIndex("by_order", (q) =>
            q.eq("tenantId", row.tenantId).eq("orderId", row._id),
          )
          .collect();
        for (const ev of events) await ctx.db.delete(ev._id);
        await ctx.db.delete(row._id);
        deleted += 1;
      }
    }
    return { ordersDeleted: deleted };
  },
});

/**
 * Wipe les orders sentinellés `[E2E MC-F] *` du tenant arg (default test-t1
 * ET test-t2). Filtre par `restaurantNote.startsWith("[E2E MC-F] ")` — ne
 * touche pas des vrais orders.
 */
export const wipeE2EOrders = internalMutation({
  args: {},
  returns: v.object({ ordersDeleted: v.number() }),
  handler: async (ctx) => {
    let ordersDeleted = 0;
    const all = await ctx.db.query("orders").collect();
    for (const row of all) {
      if (row.restaurantNote?.startsWith(E2E_MC_F_NOTE_PREFIX) === true) {
        await ctx.db.delete(row._id);
        ordersDeleted += 1;
      }
    }
    return { ordersDeleted };
  },
});

/**
 * Récupère le token de l'invite la plus récente pour `wizard-e2e@kb-e2e.test`
 * (gérant invité par le wizard step 7). Utilisé pendant les tests AC2 / AC2bis
 * pour shortcircuiter Resend en dev : on copie le token et on forge l'URL
 * `/accept-invite?token=<token>` directement.
 */
export const getWizardManagerInviteToken = internalQuery({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      token: v.string(),
      acceptedAt: v.optional(v.number()),
      expiresAt: v.number(),
      createdAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const invites = await ctx.db
      .query("adminInvites")
      .withIndex("by_email", (q) => q.eq("email", "wizard-e2e@kb-e2e.test"))
      .collect();
    if (invites.length === 0) return null;
    // Most recent first. `adminInvites` has no app-level `createdAt` column —
    // we use Convex's system `_creationTime` (table/adminInvites.ts), surfaced
    // to the caller as `createdAt` in the returns shape.
    const latest = invites.reduce((a, b) =>
      a._creationTime > b._creationTime ? a : b,
    );
    return {
      token: latest.token,
      acceptedAt: latest.acceptedAt,
      expiresAt: latest.expiresAt,
      createdAt: latest._creationTime,
    };
  },
});

// -----------------------------------------------------------------------------
// E2E-W seed — populate 1 prospect prêt pour le Wizard Provisioning (W1-W10).
// Le prospect a :
//   - tous les 5 champs juridiques renseignés (W3 step 1 va les lire),
//   - 4/4 milestones Closing cochés (W2 launcher button visibility +
//     auto-bascule déjà passée → phase preparation),
//   - tabletteMode = appareil_existant (pas de facture tablette à gérer),
//   - PAS de tenantId (W3 step 1 va le créer),
//   - phase preparation (l'état attendu après Closing complet).
//
// Sentinel name = `[E2E W] Wizard Test`. Le wipe supprime le prospect ET
// les tenants potentiellement créés pendant le test (filtre par slug
// préfixé `e2e-w-` — Alex doit utiliser ce préfixe lors du step 1).
// -----------------------------------------------------------------------------

const E2E_W_PROSPECT_NAME = "[E2E W] Wizard Test";
const E2E_W_TENANT_SLUG_PREFIX = "e2e-w-";

/**
 * Seed 1 prospect prêt pour le Wizard Provisioning (W1-W10). Idempotent
 * par nom sentinellé : re-runs réinitialisent l'état (suppression du
 * tenantId backlink + reset milestones + juridique).
 */
export const seedE2EWizardProspect = internalMutation({
  args: {},
  returns: v.object({
    prospectId: v.id("prospects"),
    prospectCreated: v.boolean(),
    tenantsWiped: v.number(),
    invitedUserWiped: v.boolean(),
    managerInvitesWiped: v.number(),
  }),
  handler: async (ctx) => {
    const now = Date.now();
    const invitedEmail = "wizard-e2e@kb-e2e.test";

    // 1. Wipe any tenant created during a previous wizard run (filter by slug
    // prefix sentinellé `e2e-w-`). Important pour idempotence : sans ça,
    // re-run = duplicate tenants.
    let tenantsWiped = 0;
    const allTenants = await ctx.db.query("tenants").collect();
    for (const t of allTenants) {
      if (t.slug.startsWith(E2E_W_TENANT_SLUG_PREFIX)) {
        await ctx.db.delete(t._id);
        tenantsWiped += 1;
      }
    }

    // 1bis. Wipe l'user gérant invité par tests AC précédents — sinon, lors d'un
    // re-test AC2, `inviteManager` lève `ALREADY_MEMBER` parce qu'une
    // `userTenants` link orpheline subsiste (ou pire, parce qu'au prochain
    // accept-invite l'user va re-pointer vers le NOUVEAU tenant). Reset
    // complet : auth (sessions/refresh/accounts/verif) + userTenants + le row
    // `users`. Plus tous les `managerInvites` pour cet email (peu importe le
    // tenant), pour que le path nominal "Envoyer l'invitation" soit toujours
    // l'unique row côté UI.
    let invitedUserWiped = false;
    const invitedUser = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", invitedEmail))
      .first();
    if (invitedUser !== null) {
      await wipeUserAttachments(ctx, invitedUser._id);
      await wipeUserCompletely(ctx, invitedUser._id);
      invitedUserWiped = true;
    }
    let managerInvitesWiped = 0;
    const allManagerInvites = await ctx.db
      .query("adminInvites")
      .withIndex("by_email", (q) => q.eq("email", invitedEmail))
      .collect();
    for (const inv of allManagerInvites) {
      await ctx.db.delete(inv._id);
      managerInvitesWiped += 1;
    }

    // 2. Upsert le prospect avec l'état initial pour le wizard.
    const existing = await ctx.db
      .query("prospects")
      .filter((q) => q.eq(q.field("name"), E2E_W_PROSPECT_NAME))
      .first();

    const milestones = {
      contratSigne: now,
      kbisRecu: now,
      pieceIdentiteRecue: now,
      ribRecu: now,
    };
    const juridiquePayload = {
      siret: "81234567800015",
      address: "12 rue de la République, 75011 Paris",
      contactName: "Jean Dupont",
      email: "wizard-e2e@kb-e2e.test",
    };

    if (existing === null) {
      const prospectId = await ctx.db.insert("prospects", {
        name: E2E_W_PROSPECT_NAME,
        phone: "+33600000601",
        phase: "preparation",
        source: "cold_call",
        tabletteMode: "appareil_existant",
        milestones,
        ...juridiquePayload,
        createdAt: now,
        updatedAt: now,
      });
      return {
        prospectId,
        prospectCreated: true,
        tenantsWiped,
        invitedUserWiped,
        managerInvitesWiped,
      };
    }

    // Re-run : reset state (incl. tenantId backlink à undefined pour
    // permettre de re-tester W3 step 1 from scratch).
    await ctx.db.patch(existing._id, {
      phase: "preparation",
      tabletteMode: "appareil_existant",
      milestones,
      ...juridiquePayload,
      tenantId: undefined,
      updatedAt: now,
    });
    return {
      prospectId: existing._id,
      prospectCreated: false,
      tenantsWiped,
      invitedUserWiped,
      managerInvitesWiped,
    };
  },
});

/**
 * Wipe the E2E-W wizard seed : supprime le prospect sentinellé + tous les
 * tenants dont le slug commence par `e2e-w-` (créés pendant les tests
 * wizard).
 */
export const wipeE2EWizardProspect = internalMutation({
  args: {},
  returns: v.object({
    prospectsDeleted: v.number(),
    tenantsDeleted: v.number(),
  }),
  handler: async (ctx) => {
    let prospectsDeleted = 0;
    let tenantsDeleted = 0;

    const prospect = await ctx.db
      .query("prospects")
      .filter((q) => q.eq(q.field("name"), E2E_W_PROSPECT_NAME))
      .first();
    if (prospect !== null) {
      await ctx.db.delete(prospect._id);
      prospectsDeleted += 1;
    }

    const allTenants = await ctx.db.query("tenants").collect();
    for (const t of allTenants) {
      if (t.slug.startsWith(E2E_W_TENANT_SLUG_PREFIX)) {
        await ctx.db.delete(t._id);
        tenantsDeleted += 1;
      }
    }

    return { prospectsDeleted, tenantsDeleted };
  },
});

// -----------------------------------------------------------------------------
// E2E-M seed — populate `test-t1` avec un menu (mode "full") OU le vider
// (mode "blank") pour le groupe M (M1-M9ter).
//
// Deux modes :
//   - "blank" : wipe COMPLET du menu test-t1 (categories + items + groups +
//     link table + publishedMenus). Utile pour M1 (catégories CRUD from
//     scratch), M6 (DnD catégories sur tenant frais), M7 (groupes vides),
//     M9bis (publish first time).
//   - "full"  : wipe d'abord, puis seed un menu riche prêt pour les autres
//     parcours (3 catégories, 5 items, 1 modifier group attaché à Smash
//     Burger, 1 snapshot publishedMenus aligné sur le brouillon — pour M9
//     « modifier le prix → badge ‹ modifications non publiées › »).
//
// Sentinel : on opère TOUJOURS sur `test-t1` (jamais sur un slug arbitraire
// pour éviter de wiper le menu d'un tenant non-e2e par accident). Le wipe
// passe par l'index `by_tenant` exclusivement.
// -----------------------------------------------------------------------------

const E2E_M_TENANT_SLUG = "test-t1";

async function wipeMenuForTenant(
  ctx: MutationCtx,
  tenantId: Id<"tenants">,
): Promise<{
  publishedDeleted: number;
  linksDeleted: number;
  groupsDeleted: number;
  itemsDeleted: number;
  categoriesDeleted: number;
}> {
  // Ordre : snapshot → link table → groups → items → categories (FK-safe).
  let publishedDeleted = 0;
  const snapshots = await ctx.db
    .query("publishedMenus")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  for (const s of snapshots) {
    await ctx.db.delete(s._id);
    publishedDeleted += 1;
  }

  let linksDeleted = 0;
  // No `by_tenant` index on menuItemModifierGroups — scan + filter.
  const allLinks = await ctx.db.query("menuItemModifierGroups").collect();
  for (const l of allLinks) {
    if (l.tenantId === tenantId) {
      await ctx.db.delete(l._id);
      linksDeleted += 1;
    }
  }

  let groupsDeleted = 0;
  const groups = await ctx.db
    .query("modifierGroups")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  for (const g of groups) {
    await ctx.db.delete(g._id);
    groupsDeleted += 1;
  }

  let itemsDeleted = 0;
  const items = await ctx.db
    .query("menuItems")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  for (const it of items) {
    await ctx.db.delete(it._id);
    itemsDeleted += 1;
  }

  let categoriesDeleted = 0;
  const categories = await ctx.db
    .query("menuCategories")
    .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
    .collect();
  for (const c of categories) {
    await ctx.db.delete(c._id);
    categoriesDeleted += 1;
  }

  return {
    publishedDeleted,
    linksDeleted,
    groupsDeleted,
    itemsDeleted,
    categoriesDeleted,
  };
}

/**
 * Seed le menu de `test-t1` en deux modes :
 *  - `"blank"` (défaut) : wipe complet, 0 catégorie / 0 item / 0 groupe /
 *    0 publishedMenu. Prêt pour M1/M6/M7/M9bis.
 *  - `"full"` : wipe puis populate (3 cat, 5 items, 1 group attaché Smash
 *    Burger, snapshot publié aligné). Prêt pour M2/M3/M4/M5/M8/M8bis/M8ter/
 *    M9/M9ter.
 *
 * Idempotent (wipe avant populate).
 */
export const seedE2EMenuT1 = internalMutation({
  args: {
    mode: v.optional(v.union(v.literal("blank"), v.literal("full"))),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    mode: v.union(v.literal("blank"), v.literal("full")),
    wiped: v.object({
      publishedDeleted: v.number(),
      linksDeleted: v.number(),
      groupsDeleted: v.number(),
      itemsDeleted: v.number(),
      categoriesDeleted: v.number(),
    }),
    categoriesCreated: v.number(),
    itemsCreated: v.number(),
    groupsCreated: v.number(),
    linksCreated: v.number(),
    publishedCreated: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const mode = args.mode ?? "blank";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", E2E_M_TENANT_SLUG))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant "${E2E_M_TENANT_SLUG}" not found — run bootstrapE2EInvites first.`,
      });
    }
    const tenantId = tenant._id;
    const wiped = await wipeMenuForTenant(ctx, tenantId);

    if (mode === "blank") {
      return {
        tenantId,
        mode,
        wiped,
        categoriesCreated: 0,
        itemsCreated: 0,
        groupsCreated: 0,
        linksCreated: 0,
        publishedCreated: false,
      };
    }

    // --- mode === "full" ----------------------------------------------------
    const now = Date.now();

    const entreesId = await ctx.db.insert("menuCategories", {
      tenantId,
      name: "Entrées",
      order: 1,
      createdAt: now,
    });
    const platsId = await ctx.db.insert("menuCategories", {
      tenantId,
      name: "Plats",
      order: 2,
      createdAt: now,
    });
    const dessertsId = await ctx.db.insert("menuCategories", {
      tenantId,
      name: "Desserts",
      order: 3,
      createdAt: now,
    });

    const saladeId = await ctx.db.insert("menuItems", {
      tenantId,
      categoryId: entreesId,
      name: "Salade verte",
      description: "Mesclun, vinaigrette maison",
      basePrice: 800,
      allergens: [],
      available: true,
      order: 1,
      createdAt: now,
    });
    const smashBurgerId = await ctx.db.insert("menuItems", {
      tenantId,
      categoryId: platsId,
      name: "Smash Burger",
      description: "Bœuf 150g, cheddar, oignons confits, pain brioché",
      basePrice: 1290,
      allergens: ["gluten", "lait"],
      available: true,
      order: 1,
      createdAt: now,
    });
    const pizzaId = await ctx.db.insert("menuItems", {
      tenantId,
      categoryId: platsId,
      name: "Pizza Margherita",
      description: "Tomate, mozzarella, basilic frais",
      basePrice: 1100,
      allergens: ["gluten", "lait"],
      available: true,
      order: 2,
      createdAt: now,
    });
    const tartareId = await ctx.db.insert("menuItems", {
      tenantId,
      categoryId: platsId,
      name: "Tartare de bœuf",
      description: "Bœuf coupé au couteau, frites maison",
      basePrice: 1500,
      allergens: ["œufs"],
      available: true,
      order: 3,
      createdAt: now,
    });
    const tiramisuId = await ctx.db.insert("menuItems", {
      tenantId,
      categoryId: dessertsId,
      name: "Tiramisu",
      description: "Mascarpone, café, cacao",
      basePrice: 650,
      allergens: ["gluten", "lait", "œufs"],
      available: true,
      order: 1,
      createdAt: now,
    });

    const supplementsId = await ctx.db.insert("modifierGroups", {
      tenantId,
      name: "Suppléments",
      minSelect: 0,
      maxSelect: 3,
      options: [
        { label: "Bacon", priceDelta: 100 },
        { label: "Fromage", priceDelta: 50 },
        { label: "Œuf", priceDelta: 80 },
      ],
      createdAt: now,
    });

    await ctx.db.insert("menuItemModifierGroups", {
      tenantId,
      itemId: smashBurgerId,
      modifierGroupId: supplementsId,
      order: 1,
    });

    // Snapshot publié aligné sur le brouillon — ainsi le badge « modifications
    // non publiées » n'apparaît que QUAND Alex modifiera quelque chose (M9).
    await ctx.db.insert("publishedMenus", {
      tenantId,
      publishedAt: now,
      payload: {
        categories: [
          {
            _id: entreesId,
            name: "Entrées",
            items: [
              {
                _id: saladeId,
                name: "Salade verte",
                description: "Mesclun, vinaigrette maison",
                basePrice: 800,
                allergens: [],
                modifierGroups: [],
              },
            ],
          },
          {
            _id: platsId,
            name: "Plats",
            items: [
              {
                _id: smashBurgerId,
                name: "Smash Burger",
                description:
                  "Bœuf 150g, cheddar, oignons confits, pain brioché",
                basePrice: 1290,
                allergens: ["gluten", "lait"],
                modifierGroups: [
                  {
                    _id: supplementsId,
                    name: "Suppléments",
                    minSelect: 0,
                    maxSelect: 3,
                    options: [
                      { label: "Bacon", priceDelta: 100 },
                      { label: "Fromage", priceDelta: 50 },
                      { label: "Œuf", priceDelta: 80 },
                    ],
                  },
                ],
              },
              {
                _id: pizzaId,
                name: "Pizza Margherita",
                description: "Tomate, mozzarella, basilic frais",
                basePrice: 1100,
                allergens: ["gluten", "lait"],
                modifierGroups: [],
              },
              {
                _id: tartareId,
                name: "Tartare de bœuf",
                description: "Bœuf coupé au couteau, frites maison",
                basePrice: 1500,
                allergens: ["œufs"],
                modifierGroups: [],
              },
            ],
          },
          {
            _id: dessertsId,
            name: "Desserts",
            items: [
              {
                _id: tiramisuId,
                name: "Tiramisu",
                description: "Mascarpone, café, cacao",
                basePrice: 650,
                allergens: ["gluten", "lait", "œufs"],
                modifierGroups: [],
              },
            ],
          },
        ],
      },
    });

    return {
      tenantId,
      mode,
      wiped,
      categoriesCreated: 3,
      itemsCreated: 5,
      groupsCreated: 1,
      linksCreated: 1,
      publishedCreated: true,
    };
  },
});

/**
 * Wipe complet du menu de `test-t1`. Idempotent.
 */
export const wipeE2EMenuT1 = internalMutation({
  args: {},
  returns: v.object({
    publishedDeleted: v.number(),
    linksDeleted: v.number(),
    groupsDeleted: v.number(),
    itemsDeleted: v.number(),
    categoriesDeleted: v.number(),
  }),
  handler: async (ctx) => {
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", E2E_M_TENANT_SLUG))
      .unique();
    if (tenant === null) {
      return {
        publishedDeleted: 0,
        linksDeleted: 0,
        groupsDeleted: 0,
        itemsDeleted: 0,
        categoriesDeleted: 0,
      };
    }
    return wipeMenuForTenant(ctx, tenant._id);
  },
});

// -----------------------------------------------------------------------------
// E2E-CMD seed — populate les états de commande qui manquent dans
// `seedE2EOrdersT1` pour exercer le groupe CMD (Commandes admin) :
//   - CMD4bis : 1 order `en attente de paiement` SANS `pricingSnapshot`
//   - CMD5    : 1 order payée 27,50 € (status `livrée`, pricingSnapshot 2750)
//   - CMD5ter : 1 order `refusée` avec `refusedAt` + reason
//
// Sentinel `restaurantNote` préfixe `[E2E CMD] ` (distinct du préfixe MC-F)
// pour wipe surgical séparé. Réutilise les customers déjà linkés à test-t1
// (round-robin sur `customerOrdersPerTenant`). Idempotent par tag sentinellé.
// -----------------------------------------------------------------------------

const E2E_CMD_NOTE_PREFIX = "[E2E CMD] ";

type CMDOrderSpec = {
  tag: string;
  status:
    | "en attente de paiement"
    | "nouvelle"
    | "en préparation"
    | "prête"
    | "remise"
    | "livrée"
    | "collectée"
    | "refusée";
  totalCents?: number; // si absent → pas de pricingSnapshot (CMD4bis path)
  refusalReason?: "rupture" | "fermeture" | "surcharge" | "autre";
};

const CMD_ORDER_SPECS: ReadonlyArray<CMDOrderSpec> = [
  // CMD4bis — en attente de paiement, pricingSnapshot absent
  { tag: "pending-payment", status: "en attente de paiement" },
  // CMD5 — payée 27,50 € pile, status livrée (refund cible)
  { tag: "refund-target-2750", status: "livrée", totalCents: 2750 },
  // CMD5ter — déjà refusée (bouton refund doit être masqué)
  {
    tag: "already-refused",
    status: "refusée",
    totalCents: 1890,
    refusalReason: "rupture",
  },
];

/**
 * Seed 3 orders sentinellées sur test-t1 pour les états non couverts par
 * `seedE2EOrdersT1` (en attente de paiement / livrée 27,50 € / refusée).
 * Idempotent par tag sentinellé dans `restaurantNote`.
 */
export const seedE2ECMDOrders = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    ordersCreated: v.number(),
    ordersReused: v.number(),
  }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant with slug "${slug}" not found.`,
      });
    }

    const links = await ctx.db
      .query("customerOrdersPerTenant")
      .withIndex("by_tenant_customer", (q) => q.eq("tenantId", tenant._id))
      .collect();
    if (links.length === 0) {
      throw new ConvexError({
        message: `No customers linked to "${slug}" — run seedE2ECustomerKPIs first.`,
      });
    }
    const customerIds = links.map((l) => l.customerId);

    const now = Date.now();
    let ordersCreated = 0;
    let ordersReused = 0;

    for (let i = 0; i < CMD_ORDER_SPECS.length; i++) {
      const spec = CMD_ORDER_SPECS[i];
      const customerId = customerIds[i % customerIds.length];
      const note = `${E2E_CMD_NOTE_PREFIX}${spec.tag}`;

      const existing = await ctx.db
        .query("orders")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
        .filter((q) => q.eq(q.field("restaurantNote"), note))
        .first();
      if (existing !== null) {
        ordersReused += 1;
        continue;
      }

      const createdAt = now - 30 * 60 * 1000; // 30 min ago
      const paidAt =
        spec.status !== "en attente de paiement"
          ? createdAt + 60 * 1000
          : undefined;
      const refusedAt =
        spec.status === "refusée" ? createdAt + 5 * 60 * 1000 : undefined;

      const pricingSnapshot =
        spec.totalCents !== undefined
          ? {
              subtotal: Math.round(spec.totalCents * 0.85),
              deliveryFee: Math.round(spec.totalCents * 0.15),
              total: spec.totalCents,
            }
          : undefined;

      await ctx.db.insert("orders", {
        tenantId: tenant._id,
        customerId,
        status: spec.status,
        mode: "delivery",
        source: "direct",
        address: "12 rue de la République, 75011 Paris",
        restaurantNote: note,
        pricingSnapshot,
        createdAt,
        paidAt,
        refusedAt,
      });

      // Pour la commande `refusée`, ajouter aussi un orderEvent qui matérialise
      // la transition (CMD5ter pin que l'historique modal montre la transition).
      if (spec.status === "refusée" && spec.refusalReason !== undefined) {
        const orderRow = await ctx.db
          .query("orders")
          .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
          .filter((q) => q.eq(q.field("restaurantNote"), note))
          .unique();
        if (orderRow !== null) {
          await ctx.db.insert("orderEvents", {
            tenantId: tenant._id,
            orderId: orderRow._id,
            status: "refusée",
            reason: spec.refusalReason,
            at: refusedAt ?? createdAt,
          });
        }
      }

      ordersCreated += 1;
    }

    return { tenantId: tenant._id, ordersCreated, ordersReused };
  },
});

// -----------------------------------------------------------------------------
// E2E-PR seed — populate les `pricingRules` de test-t1 pour le groupe PR
// (Pricing admin) :
//   - PR1 : ≥ 2 règles (1 active, 1 inactive, actions variées)
//   - PR3 : 1 règle exactement « panier ≥ 25 EUR + première commande →
//           livraison offerte resto » (pour vérifier le préfillage modal)
//   - PR5 : ≥ 2 règles actives (pour le delete + reste-en-vie)
//
// On seed 3 règles totales : 2 actives + 1 inactive — satisfait PR1 + PR3 +
// PR5 d'un coup. test-t2 reste NATURELLEMENT vierge (aucun autre seed ne
// touche `pricingRules`), ce qui couvre PR1 « tenant B vierge ».
//
// Idempotent par sentinelle : on filtre les règles déjà créées par leur
// signature [conditions + action] hash. Pas d'index dédié — le seed n'est
// pas hot path.
// -----------------------------------------------------------------------------

const PR_RULES_SPECS: ReadonlyArray<{
  conditions: Doc<"pricingRules">["conditions"];
  action: Doc<"pricingRules">["action"];
  active: boolean;
}> = [
  // Règle A (active) — PR3 préfillage : panier ≥ 25 € + 1ère commande
  // → livraison offerte par le resto.
  {
    conditions: [
      { kind: "total_panier", operator: "gte", valueCents: 2500 },
      { kind: "premiere_cmd_client", value: true },
    ],
    action: { kind: "livraison_offerte_resto" },
    active: true,
  },
  // Règle B (inactive) — PR1 ligne grisée + PR4 toggle round-trip.
  {
    conditions: [{ kind: "total_panier", operator: "gte", valueCents: 5000 }],
    action: {
      kind: "frais_livraison_part_resto_pourcentage_panier",
      percent: 50,
    },
    active: false,
  },
  // Règle C (active) — PR5 (≥ 2 actives requis pour le delete-and-rest).
  {
    conditions: [{ kind: "jour_semaine", days: ["VE", "SA", "DI"] }],
    action: {
      kind: "frais_livraison_part_resto_fixe",
      valueCents: 200, // 2,00 €
    },
    active: true,
  },
];

/**
 * Helper : compare deux specs de règle (mêmes conditions ordonnées + même
 * action) — sert d'idempotence sentinelle (pas d'index dédié sur
 * `pricingRules`, le seed n'est pas hot path).
 */
function pricingRuleSignature(rule: {
  conditions: Doc<"pricingRules">["conditions"];
  action: Doc<"pricingRules">["action"];
}): string {
  return JSON.stringify({ conditions: rule.conditions, action: rule.action });
}

/**
 * Seed 3 pricingRules sur test-t1 (2 actives + 1 inactive) — satisfait
 * PR1 / PR3 / PR4 / PR5. test-t2 reste naturellement vide.
 * Idempotent par signature [conditions + action].
 */
export const seedE2EPricingRules = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({
    tenantId: v.id("tenants"),
    rulesCreated: v.number(),
    rulesReused: v.number(),
  }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) {
      throw new ConvexError({
        message: `Tenant with slug "${slug}" not found.`,
      });
    }

    const now = Date.now();
    let rulesCreated = 0;
    let rulesReused = 0;

    const existing = await ctx.db
      .query("pricingRules")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .collect();
    const existingSigs = new Set(existing.map((r) => pricingRuleSignature(r)));

    for (const spec of PR_RULES_SPECS) {
      if (existingSigs.has(pricingRuleSignature(spec))) {
        rulesReused += 1;
        continue;
      }
      await ctx.db.insert("pricingRules", {
        tenantId: tenant._id,
        conditions: spec.conditions,
        action: spec.action,
        active: spec.active,
        createdAt: now,
        updatedAt: now,
      });
      rulesCreated += 1;
    }

    return { tenantId: tenant._id, rulesCreated, rulesReused };
  },
});

/**
 * Wipe TOUTES les pricingRules d'un tenant (par slug, défaut test-t1).
 * Pas de sentinelle « préfixe » possible sur cette table (la signature
 * conditions+action peut clash avec une vraie règle si on la mappe), donc on
 * propose un wipe explicite par tenant : à n'utiliser que sur test-t1 / test-t2.
 */
export const wipeE2EPricingRules = internalMutation({
  args: {
    tenantSlug: v.optional(v.string()),
  },
  returns: v.object({ rulesDeleted: v.number() }),
  handler: async (ctx, args) => {
    const slug = args.tenantSlug ?? "test-t1";
    const tenant = await ctx.db
      .query("tenants")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (tenant === null) return { rulesDeleted: 0 };

    let rulesDeleted = 0;
    const rules = await ctx.db
      .query("pricingRules")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenant._id))
      .collect();
    for (const r of rules) {
      await ctx.db.delete(r._id);
      rulesDeleted += 1;
    }
    return { rulesDeleted };
  },
});

/**
 * Wipe surgical des 3 orders sentinellées CMD + leurs orderEvents.
 * Filtre par `restaurantNote` préfixe `[E2E CMD] `.
 */
export const wipeE2ECMDOrders = internalMutation({
  args: {},
  returns: v.object({
    ordersDeleted: v.number(),
    eventsDeleted: v.number(),
  }),
  handler: async (ctx) => {
    let ordersDeleted = 0;
    let eventsDeleted = 0;
    const all = await ctx.db.query("orders").collect();
    for (const row of all) {
      if (row.restaurantNote?.startsWith(E2E_CMD_NOTE_PREFIX) === true) {
        // Drop matching events first (FK on orderId).
        const events = await ctx.db
          .query("orderEvents")
          .withIndex("by_order", (q) =>
            q.eq("tenantId", row.tenantId).eq("orderId", row._id),
          )
          .collect();
        for (const e of events) {
          await ctx.db.delete(e._id);
          eventsDeleted += 1;
        }
        await ctx.db.delete(row._id);
        ordersDeleted += 1;
      }
    }
    return { ordersDeleted, eventsDeleted };
  },
});
