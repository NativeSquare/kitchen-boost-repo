import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import schema from "../schema";

/**
 * B-AUTH-6 (#230) — `acceptInvite` extension: branche kb_manager qui crée
 * `userTenants`, rétrocompat 100% côté kb_admin.
 *
 * Pins the contract documented in `convex/table/admin.ts:acceptInvite`:
 *
 *   - **Legacy admin invite** (no `targetRole`) → user becomes `kb_admin`
 *     + `name = invite.name`, no `userTenants` row. Pre-B-AUTH-3 rétrocompat
 *     — these rows still exist in any DB that ran the schema before the
 *     extension landed.
 *   - **Explicit admin invite** (`targetRole: "kb_admin"`) → identical to
 *     the legacy case; the explicit literal is supported because callers
 *     (incl. test seeds) may set it for clarity.
 *   - **Manager invite** (`targetRole: "kb_manager"` + `tenantId`) → a fresh
 *     `userTenants(userId, tenantId, role: "kb_manager")` row is created.
 *     `attachedBy` mirrors `invite.invitedBy`. **`users.role` is NOT
 *     patched** (le gérant reste `customer` globalement — c'est sa ligne
 *     `userTenants` qui le qualifie comme gérant sur ce tenant, cf. issue
 *     #230). `users.name` is also left untouched (manager branch does not
 *     mutate the user profile — the display name comes from the signup
 *     flow / NavUser footer).
 *   - **Manager invite, soft-detached attachment exists** → the existing
 *     row is RE-ACTIVATED (`detachedAt → undefined`, fresh `attachedAt`,
 *     role re-stamped) rather than creating a duplicate. Spec
 *     (B-AUTH-4 `inviteManager`) explicitly allows re-invitation of a
 *     soft-detached ex-gérant; the acceptance must mirror that.
 *   - **Manager invite, active attachment exists** → throws « Vous êtes
 *     déjà rattaché à ce resto » (double-click safety / out-of-flow
 *     attachment defence-in-depth, cf. issue #230 acceptance criteria).
 *   - **Manager invite missing tenantId** → throws a clean message
 *     (defence-in-depth; `inviteManager` validator already guarantees it).
 *   - **Manager invite, tenant deleted between issue & accept** → throws,
 *     does NOT create a dangling attachment.
 *
 * Pre-existing guards (email mismatch, expired, already accepted, unknown
 * token) keep their behaviour; the two role-mismatch cases (admin/manager)
 * are pinned independently so a regression on either branch surfaces here.
 */

// convex-test needs the function modules; array-negation glob form is required.
// `table/admin.test.ts` is at `convex/table/`, so we glob relative to convex
// root (../) — same pattern as `convex/lib/auth/getSession.test.ts`.
const rawModules = import.meta.glob(["../**/*.{ts,js}", "!../**/*.test.*"]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../table/${path.slice(2)}` : path,
    loader,
  ]),
);

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Setup helper — insert {inviter, invitee, invite} in one shot. The invite
// `targetRole`/`tenantId` are passed through so each test can shape its own.
// ---------------------------------------------------------------------------

type SeedArgs = {
  inviteeEmail: string;
  inviteeName?: string;
  targetRole?: "kb_admin" | "kb_manager";
  tenantId?: Id<"tenants">;
  token?: string;
  // Override `acceptedAt` / `expiresAt` to exercise the guard branches.
  acceptedAt?: number;
  expiresAt?: number;
};

async function seed(
  t: ReturnType<typeof convexTest>,
  args: SeedArgs,
): Promise<{
  inviterId: Id<"users">;
  inviteeId: Id<"users">;
  inviteId: Id<"adminInvites">;
  token: string;
}> {
  return t.run(async (ctx) => {
    const inviterId = await ctx.db.insert("users", {
      email: "inviter@kb.test",
      role: "kb_admin",
    });
    // Match the post-signup state: the row exists with the invitee's email
    // (Convex Auth `signIn("password", { flow: "signUp" })` would have
    // created it). The invitee starts as a vanilla user — no role, no
    // userTenants — exactly like a fresh signup.
    const inviteeId = await ctx.db.insert("users", {
      email: args.inviteeEmail,
    });
    const token = args.token ?? `tok-${Math.random().toString(36).slice(2)}`;
    const inviteId = await ctx.db.insert("adminInvites", {
      email: args.inviteeEmail,
      name: args.inviteeName ?? "Invited Person",
      token,
      invitedBy: inviterId,
      expiresAt: args.expiresAt ?? Date.now() + SEVEN_DAYS,
      acceptedAt: args.acceptedAt,
      targetRole: args.targetRole,
      tenantId: args.tenantId,
    });
    return { inviterId, inviteeId, inviteId, token };
  });
}

async function insertActiveTenant(
  t: ReturnType<typeof convexTest>,
  slug: string,
): Promise<Id<"tenants">> {
  return t.run((ctx) =>
    ctx.db.insert("tenants", {
      slug,
      name: slug,
      siret: "00000000000000",
      status: "active",
      createdAt: Date.now(),
    }),
  );
}

// ---------------------------------------------------------------------------
// 1. Legacy admin invite (no targetRole) → kb_admin (rétrocompat)
// ---------------------------------------------------------------------------

describe("acceptInvite — admin branch", () => {
  it("legacy invite (no targetRole) → user becomes kb_admin, no userTenants row", async () => {
    const t = convexTest(schema, modules);
    const { inviteeId, token } = await seed(t, {
      inviteeEmail: "newadmin@kb.test",
      // No `targetRole`, no `tenantId` — the legacy admin invite shape.
    });

    await t
      .withIdentity({ subject: inviteeId })
      .mutation(api.table.admin.acceptInvite, { token });

    await t.run(async (ctx) => {
      const user = await ctx.db.get(inviteeId);
      expect(user?.role).toBe("kb_admin");
      const attachments = await ctx.db
        .query("userTenants")
        .withIndex("by_user", (q) => q.eq("userId", inviteeId))
        .collect();
      expect(attachments).toHaveLength(0);
    });
  });

  it("explicit admin invite (targetRole: kb_admin) → same effect as legacy", async () => {
    const t = convexTest(schema, modules);
    const { inviteeId, token } = await seed(t, {
      inviteeEmail: "explicitadmin@kb.test",
      targetRole: "kb_admin",
    });

    await t
      .withIdentity({ subject: inviteeId })
      .mutation(api.table.admin.acceptInvite, { token });

    await t.run(async (ctx) => {
      const user = await ctx.db.get(inviteeId);
      expect(user?.role).toBe("kb_admin");
    });
  });

  it("stamps invite.acceptedAt on success", async () => {
    const t = convexTest(schema, modules);
    const { inviteeId, inviteId, token } = await seed(t, {
      inviteeEmail: "stamps@kb.test",
    });
    await t
      .withIdentity({ subject: inviteeId })
      .mutation(api.table.admin.acceptInvite, { token });
    await t.run(async (ctx) => {
      const row = await ctx.db.get(inviteId);
      expect(row?.acceptedAt).toBeTypeOf("number");
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Manager invite — the new branch (the whole point of this slice)
// ---------------------------------------------------------------------------

describe("acceptInvite — manager branch (the B-AUTH-3 wiring)", () => {
  it("manager invite → userTenants(kb_manager) row created, users.role and users.name LEFT UNTOUCHED", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await insertActiveTenant(t, "lartisan");
    const { inviteeId, inviterId, token } = await seed(t, {
      inviteeEmail: "newmanager@kb.test",
      targetRole: "kb_manager",
      tenantId,
    });

    await t
      .withIdentity({ subject: inviteeId })
      .mutation(api.table.admin.acceptInvite, { token });

    await t.run(async (ctx) => {
      // Issue #230 — manager branch MUST NOT patch users.role. The user row
      // stays exactly as it was after sign-up (no `role`, no `name`); the
      // gérant qualification lives entirely on the `userTenants` link.
      // `getCurrentActor` defaults a missing global role to "customer" — so
      // the absence of a stamped role is the canonical "customer global"
      // state, NOT an explicit `role: "customer"` patch.
      const user = await ctx.db.get(inviteeId);
      expect(user?.role).toBeUndefined();
      expect(user?.name).toBeUndefined();

      // Exactly ONE active userTenants row for this user, on the right
      // tenant, with the right role, and `attachedBy` mirroring the inviter.
      const attachments = await ctx.db
        .query("userTenants")
        .withIndex("by_user", (q) => q.eq("userId", inviteeId))
        .collect();
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toMatchObject({
        userId: inviteeId,
        tenantId,
        role: "kb_manager",
        attachedBy: inviterId,
      });
      expect(attachments[0].detachedAt).toBeUndefined();
    });
  });

  it("manager invite RE-ACTIVATES a soft-detached attachment (rather than duplicating)", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await insertActiveTenant(t, "khan");
    const { inviteeId, inviterId, token } = await seed(t, {
      inviteeEmail: "reattach@kb.test",
      targetRole: "kb_manager",
      tenantId,
    });

    // Pre-existing soft-detached attachment (admin had revoked it earlier).
    const existingAttachmentId = await t.run(async (ctx) =>
      ctx.db.insert("userTenants", {
        userId: inviteeId,
        tenantId,
        role: "kb_manager",
        attachedAt: Date.now() - 10_000,
        attachedBy: inviterId,
        detachedAt: Date.now() - 5_000,
      }),
    );

    await t
      .withIdentity({ subject: inviteeId })
      .mutation(api.table.admin.acceptInvite, { token });

    await t.run(async (ctx) => {
      const attachments = await ctx.db
        .query("userTenants")
        .withIndex("by_user", (q) => q.eq("userId", inviteeId))
        .collect();
      expect(attachments).toHaveLength(1);
      // Same row, re-activated — NOT a fresh row.
      expect(attachments[0]._id).toBe(existingAttachmentId);
      expect(attachments[0].detachedAt).toBeUndefined();
      expect(attachments[0].role).toBe("kb_manager");
    });
  });

  it("manager invite THROWS « déjà rattaché » when an ACTIVE attachment already exists (double-click safety)", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await insertActiveTenant(t, "thai");
    const { inviteeId, inviterId, inviteId, token } = await seed(t, {
      inviteeEmail: "alreadyin@kb.test",
      targetRole: "kb_manager",
      tenantId,
    });

    const existingAttachmentId = await t.run(async (ctx) =>
      ctx.db.insert("userTenants", {
        userId: inviteeId,
        tenantId,
        role: "kb_manager",
        attachedAt: Date.now() - 10_000,
        attachedBy: inviterId,
      }),
    );
    const existingAttachmentBefore = await t.run((ctx) =>
      ctx.db.get(existingAttachmentId),
    );

    // Issue #230 — a double-click on the magic-link, or an out-of-flow
    // attachment created manually by an admin, must surface a clear French
    // error rather than silently no-op'ing.
    await expect(
      t
        .withIdentity({ subject: inviteeId })
        .mutation(api.table.admin.acceptInvite, { token }),
    ).rejects.toThrow(/déjà rattaché|deja rattache/i);

    await t.run(async (ctx) => {
      // The pre-existing attachment is UNCHANGED — same _id, same
      // `attachedAt` (the throw rolled the whole mutation back, and even
      // before the rollback nothing should have touched the row).
      const attachments = await ctx.db
        .query("userTenants")
        .withIndex("by_user", (q) => q.eq("userId", inviteeId))
        .collect();
      expect(attachments).toHaveLength(1);
      expect(attachments[0]._id).toBe(existingAttachmentId);
      expect(attachments[0].attachedAt).toBe(
        existingAttachmentBefore?.attachedAt,
      );

      // The invite is NOT consumed (the throw rolled back the acceptedAt
      // stamp) — the magic-link could be replayed once the conflicting
      // attachment is cleaned up, rather than burning a one-shot token on a
      // double-click.
      const inviteRow = await ctx.db.get(inviteId);
      expect(inviteRow?.acceptedAt).toBeUndefined();
    });
  });

  it("manager invite WITHOUT tenantId → throws an explicit incoherent-row error", async () => {
    const t = convexTest(schema, modules);
    // Hand-crafted broken row — `inviteManager` would never produce this,
    // but the defence-in-depth guard surfaces a readable error if it ever
    // happens (data drift, manual DB tampering).
    const { inviteeId, token } = await seed(t, {
      inviteeEmail: "broken@kb.test",
      targetRole: "kb_manager",
      // tenantId intentionally omitted.
    });

    await expect(
      t
        .withIdentity({ subject: inviteeId })
        .mutation(api.table.admin.acceptInvite, { token }),
    ).rejects.toThrow(/missing tenantId/i);
  });

  it("manager invite on a tenant that was deleted in between → throws, does NOT create userTenants", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await insertActiveTenant(t, "doomed");
    const { inviteeId, token } = await seed(t, {
      inviteeEmail: "ghostresto@kb.test",
      targetRole: "kb_manager",
      tenantId,
    });
    // Delete the tenant AFTER the invite is created — the race the guard
    // protects against.
    await t.run((ctx) => ctx.db.delete(tenantId));

    await expect(
      t
        .withIdentity({ subject: inviteeId })
        .mutation(api.table.admin.acceptInvite, { token }),
    ).rejects.toThrow(/no longer exists/i);

    await t.run(async (ctx) => {
      const attachments = await ctx.db
        .query("userTenants")
        .withIndex("by_user", (q) => q.eq("userId", inviteeId))
        .collect();
      expect(attachments).toHaveLength(0);
      // The user must NOT have been demoted either — the whole mutation
      // rolled back together (Convex single-mutation atomicity).
      const user = await ctx.db.get(inviteeId);
      expect(user?.role).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Pre-existing guards — pinned to ensure the refactor didn't regress them
// ---------------------------------------------------------------------------

describe("acceptInvite — pre-existing guards (regression pins)", () => {
  it("email mismatch → throws regardless of branch (admin)", async () => {
    const t = convexTest(schema, modules);
    const { inviteeId, token } = await seed(t, {
      inviteeEmail: "expected@kb.test",
    });
    // Tamper with the user's email so the mismatch guard fires.
    await t.run((ctx) =>
      ctx.db.patch(inviteeId, { email: "attacker@kb.test" }),
    );

    await expect(
      t
        .withIdentity({ subject: inviteeId })
        .mutation(api.table.admin.acceptInvite, { token }),
    ).rejects.toThrow(/email mismatch/i);
  });

  it("expired invite → throws (manager branch never reached)", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await insertActiveTenant(t, "expired-tenant");
    const { inviteeId, token } = await seed(t, {
      inviteeEmail: "tooLate@kb.test",
      targetRole: "kb_manager",
      tenantId,
      expiresAt: Date.now() - 1_000,
    });

    await expect(
      t
        .withIdentity({ subject: inviteeId })
        .mutation(api.table.admin.acceptInvite, { token }),
    ).rejects.toThrow(/expired/i);
  });

  it("already-accepted invite → throws", async () => {
    const t = convexTest(schema, modules);
    const { inviteeId, token } = await seed(t, {
      inviteeEmail: "replay@kb.test",
      acceptedAt: Date.now() - 1_000,
    });

    await expect(
      t
        .withIdentity({ subject: inviteeId })
        .mutation(api.table.admin.acceptInvite, { token }),
    ).rejects.toThrow(/already been used/i);
  });

  it("unauthenticated caller → throws (Convex Auth guard)", async () => {
    const t = convexTest(schema, modules);
    const { token } = await seed(t, { inviteeEmail: "nobody@kb.test" });
    await expect(
      // No `.withIdentity(...)` — anonymous caller.
      t.mutation(api.table.admin.acceptInvite, { token }),
    ).rejects.toThrow(/not authenticated/i);
  });
});
