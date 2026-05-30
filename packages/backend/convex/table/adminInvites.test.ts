import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "../schema";
import { adminInviteValidator } from "./adminInvites";

// convex-test needs the function modules; lazy-loaded, so "use node" modules
// (emails.ts) are only imported if a function there is called — these tests
// use direct db access only.
const modules = import.meta.glob(["../**/*.{ts,js}", "!../**/*.test.*"]);

/**
 * B-AUTH-3 — Schema extension `adminInvites` for D7 (gérant magic-link, EPIC
 * #134). Option A retained: extend the shared table with TWO optional fields
 * (`targetRole`, `tenantId`) + new compound index `by_email_tenant`, so a row
 * can carry either an admin-root invite (existing flow, both fields absent =
 * implicit `kb_admin`) or a manager invite (`targetRole: "kb_manager"` +
 * `tenantId` set). NO mutation is touched by this slice — `inviteAdmin`,
 * `getInvite`, `listInvites`, `cancelInvite`, `acceptInvite` must continue to
 * work exactly as before (rétrocompat verified by the existing suites + the
 * insert without the new fields below).
 *
 * Written BEFORE the schema change (TDD red).
 */
describe("B-AUTH-3 adminInvites schema extension — targetRole + tenantId optional", () => {
  it("inserts a legacy admin invite (no targetRole, no tenantId) — rétrocompat", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const inviterId = await ctx.db.insert("users", {
        email: "root@kb.fr",
        role: "kb_admin",
      });

      const inviteId = await ctx.db.insert("adminInvites", {
        email: "newadmin@kb.fr",
        name: "New Admin",
        token: "legacy-token",
        invitedBy: inviterId,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });

      const row = await ctx.db.get(inviteId);
      expect(row?.email).toBe("newadmin@kb.fr");
      // The two new fields are absent on a legacy row — implicit kb_admin.
      expect(row?.targetRole).toBeUndefined();
      expect(row?.tenantId).toBeUndefined();
    });
  });

  it("inserts a kb_manager invite carrying targetRole + tenantId", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const inviterId = await ctx.db.insert("users", {
        email: "root@kb.fr",
        role: "kb_admin",
      });
      const tenantId = await ctx.db.insert("tenants", {
        slug: "buns-bao",
        name: "Buns & Bao",
        siret: "12345678900012",
        status: "active",
        createdAt: Date.now(),
      });

      const inviteId = await ctx.db.insert("adminInvites", {
        email: "khan@example.fr",
        name: "Khan",
        token: "manager-token",
        invitedBy: inviterId,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        targetRole: "kb_manager",
        tenantId,
      });

      const row = await ctx.db.get(inviteId);
      expect(row?.targetRole).toBe("kb_manager");
      expect(row?.tenantId).toBe(tenantId);
    });
  });

  it('also accepts targetRole: "kb_admin" explicitly (rétrocompat + explicit form)', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const inviterId = await ctx.db.insert("users", {
        email: "root@kb.fr",
        role: "kb_admin",
      });

      const inviteId = await ctx.db.insert("adminInvites", {
        email: "newadmin2@kb.fr",
        name: "New Admin 2",
        token: "explicit-admin-token",
        invitedBy: inviterId,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        targetRole: "kb_admin",
        // tenantId intentionally absent for kb_admin invites.
      });

      const row = await ctx.db.get(inviteId);
      expect(row?.targetRole).toBe("kb_admin");
      expect(row?.tenantId).toBeUndefined();
    });
  });

  it("queries via the new by_email_tenant index (email + tenantId compound)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const inviterId = await ctx.db.insert("users", {
        email: "root@kb.fr",
        role: "kb_admin",
      });
      const tenantA = await ctx.db.insert("tenants", {
        slug: "resto-a",
        name: "Resto A",
        siret: "11111111100011",
        status: "active",
        createdAt: Date.now(),
      });
      const tenantB = await ctx.db.insert("tenants", {
        slug: "resto-b",
        name: "Resto B",
        siret: "22222222200022",
        status: "active",
        createdAt: Date.now(),
      });

      // Same email invited on two different tenants — two distinct invites.
      await ctx.db.insert("adminInvites", {
        email: "walid@example.fr",
        name: "Walid",
        token: "token-a",
        invitedBy: inviterId,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        targetRole: "kb_manager",
        tenantId: tenantA,
      });
      await ctx.db.insert("adminInvites", {
        email: "walid@example.fr",
        name: "Walid",
        token: "token-b",
        invitedBy: inviterId,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        targetRole: "kb_manager",
        tenantId: tenantB,
      });

      const onA = await ctx.db
        .query("adminInvites")
        .withIndex("by_email_tenant", (q) =>
          q.eq("email", "walid@example.fr").eq("tenantId", tenantA),
        )
        .unique();
      expect(onA?.token).toBe("token-a");

      const onB = await ctx.db
        .query("adminInvites")
        .withIndex("by_email_tenant", (q) =>
          q.eq("email", "walid@example.fr").eq("tenantId", tenantB),
        )
        .unique();
      expect(onB?.token).toBe("token-b");
    });
  });

  it("the legacy by_email index still works (rétrocompat)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const inviterId = await ctx.db.insert("users", {
        email: "root@kb.fr",
        role: "kb_admin",
      });

      await ctx.db.insert("adminInvites", {
        email: "legacy@kb.fr",
        name: "Legacy",
        token: "leg-tok",
        invitedBy: inviterId,
        expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      });

      const found = await ctx.db
        .query("adminInvites")
        .withIndex("by_email", (q) => q.eq("email", "legacy@kb.fr"))
        .first();
      expect(found?.token).toBe("leg-tok");
    });
  });

  it("adminInviteValidator exposes the two new optional fields in its object shape", () => {
    // The validator types the `invite` payload returned by `getInvite`. If a
    // future mutation reads back `targetRole` / `tenantId`, it MUST be allowed
    // by the validator — otherwise the function-return validation throws.
    // Convex `v.object(...)` exposes its members under `.fields`; each optional
    // wrapper carries `isOptional: "optional"`.
    const fields = adminInviteValidator.fields;
    expect(fields).toBeDefined();
    expect(fields.targetRole).toBeDefined();
    expect(fields.tenantId).toBeDefined();
    expect(fields.targetRole.isOptional).toBe("optional");
    expect(fields.tenantId.isOptional).toBe("optional");
  });
});
