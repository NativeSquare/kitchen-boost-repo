import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

// convex-test needs the function modules; lazy-loaded, so "use node" modules
// (emails.ts) are only imported if a function there is called — these tests
// use direct db access only.
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.*"]);

// 1.x-A — the transverse foundation tables. Verifies each table round-trips a row
// and that the specified indexes (incl. the unique-intent by_user_tenant and
// by_provider_event) are queryable. Uses direct db access via t.run (no function
// calls), so no module glob is needed.
describe("1.x-A foundation schema — transverse tables", () => {
  it("round-trips a row in each new table", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "khan@example.fr" });

      const tenantId = await ctx.db.insert("tenants", {
        slug: "buns-bao",
        name: "Buns & Bao",
        siret: "12345678900012",
        status: "active",
        branding: { primaryColor: "#1B7A3D" },
        createdAt: Date.now(),
      });
      expect((await ctx.db.get(tenantId))?.slug).toBe("buns-bao");

      const utId = await ctx.db.insert("userTenants", {
        userId,
        tenantId,
        role: "kb_manager",
        attachedAt: Date.now(),
        attachedBy: userId,
      });
      expect((await ctx.db.get(utId))?.role).toBe("kb_manager");

      const alId = await ctx.db.insert("auditLog", {
        actorUserId: userId,
        actorRole: "kb_admin",
        action: "tenant.provision",
        tenantId,
        timestamp: Date.now(),
      });
      expect((await ctx.db.get(alId))?.action).toBe("tenant.provision");

      const weId = await ctx.db.insert("processedWebhookEvents", {
        provider: "stripe",
        externalId: "evt_123",
        processedAt: Date.now(),
      });
      expect((await ctx.db.get(weId))?.externalId).toBe("evt_123");

      const tcId = await ctx.db.insert("tenantCredentials", {
        tenantId,
        provider: "uber_direct",
        ciphertext: "c",
        iv: "i",
        authTag: "a",
        keyVersion: 1,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      expect((await ctx.db.get(tcId))?.provider).toBe("uber_direct");
    });
  });

  it("exposes the specified indexes (incl. by_user_tenant, by_provider_event)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", { email: "a@b.fr" });
      const tenantId = await ctx.db.insert("tenants", {
        slug: "s1",
        name: "n",
        siret: "1",
        status: "pending",
        createdAt: 1,
      });
      await ctx.db.insert("userTenants", {
        userId,
        tenantId,
        role: "staff",
        attachedAt: 1,
        attachedBy: userId,
      });

      const ut = await ctx.db
        .query("userTenants")
        .withIndex("by_user_tenant", (q) =>
          q.eq("userId", userId).eq("tenantId", tenantId),
        )
        .unique();
      expect(ut?.role).toBe("staff");

      const bySlug = await ctx.db
        .query("tenants")
        .withIndex("by_slug", (q) => q.eq("slug", "s1"))
        .unique();
      expect(bySlug?._id).toBe(tenantId);

      await ctx.db.insert("processedWebhookEvents", {
        provider: "uber",
        externalId: "x1",
        processedAt: 1,
      });
      const we = await ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_provider_event", (q) =>
          q.eq("provider", "uber").eq("externalId", "x1"),
        )
        .unique();
      expect(we?.externalId).toBe("x1");

      await ctx.db.insert("tenantCredentials", {
        tenantId,
        provider: "uber_direct",
        ciphertext: "c",
        iv: "i",
        authTag: "a",
        keyVersion: 1,
        createdAt: 1,
        updatedAt: 1,
      });
      const tc = await ctx.db
        .query("tenantCredentials")
        .withIndex("by_tenant_provider", (q) =>
          q.eq("tenantId", tenantId).eq("provider", "uber_direct"),
        )
        .unique();
      expect(tc?.provider).toBe("uber_direct");

      await ctx.db.insert("auditLog", {
        actorUserId: userId,
        actorRole: "staff",
        action: "x",
        tenantId,
        timestamp: 5,
      });
      const byTenant = await ctx.db
        .query("auditLog")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect();
      expect(byTenant.length).toBeGreaterThan(0);
      const byActor = await ctx.db
        .query("auditLog")
        .withIndex("by_actor", (q) => q.eq("actorUserId", userId))
        .collect();
      expect(byActor.length).toBeGreaterThan(0);
    });
  });
});

describe("1.x-A users role + generateFunctions footgun", () => {
  it("accepts the new role union (kb_admin / customer)", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const adminId = await ctx.db.insert("users", {
        email: "root@kb.fr",
        role: "kb_admin",
      });
      expect((await ctx.db.get(adminId))?.role).toBe("kb_admin");

      const custId = await ctx.db.insert("users", {
        email: "eater@x.fr",
        role: "customer",
      });
      expect((await ctx.db.get(custId))?.role).toBe("customer");
    });
  });

  it("removed the unguarded users CRUD from the public API (footgun closed)", () => {
    // Compile-time guards: the runtime `api` is a proxy (any key yields a
    // reference), so absence can't be asserted at runtime — we assert it at the
    // TYPE level. These generic, unguarded functions no longer exist on the
    // public users API; if anyone re-adds them, @ts-expect-error fails the build.
    // @ts-expect-error — insert removed (was a privilege-escalation footgun)
    void api.table.users.insert;
    // @ts-expect-error — get removed
    void api.table.users.get;
    // @ts-expect-error — replace removed
    void api.table.users.replace;
    // @ts-expect-error — del removed
    void api.table.users.del;
    // The only public write path is the GUARDED self-update `patch`.
    expect(api.table.users.patch).toBeDefined();
  });
});
