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
 * the default `<slug>.kitchen-boost.fr`. In production, `customDomain` is set
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
      if (customer === null) {
        const customerId = await ctx.db.insert("customers", {
          userId: user._id,
          firstName: spec.firstName,
          createdAt: now,
          ...reachFields,
        });
        customer = await ctx.db.get(customerId);
        customersCreated += 1;
      } else {
        // Re-run: refresh reachability fields in case the spec evolved.
        await ctx.db.patch(customer._id, reachFields);
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
