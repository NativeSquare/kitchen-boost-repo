import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";

// convex-test needs the function modules; array-negation glob form is required
// (project memory — extglob returns ZERO modules). This file sits at the convex
// root, so same-dir keys are already "./x" — no key normalisation needed.
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.*"]);

/**
 * 2.8-A — `walletPasses` schema, written BEFORE the implementation (TDD red).
 * This proves the GLOBAL (no authoritative `tenantId`, ADR 0003) technical-state
 * table round-trips its V1 fields and is reachable on its `by_serial` index. No
 * business logic here — the generation + signing live in `lib/wallet`.
 */
describe("2.8-A schema — walletPasses (GLOBAL, no authoritative tenantId, ADR 0003)", () => {
  it("round-trips a pass row with all V1 fields", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "eater@x.fr",
        role: "customer",
      });
      const customerId = await ctx.db.insert("customers", {
        userId,
        createdAt: Date.now(),
      });
      const tenantId = await ctx.db.insert("tenants", {
        slug: "buns-bao",
        name: "Buns & Bao",
        siret: "buns-bao",
        status: "active",
        createdAt: Date.now(),
      });

      const passId = await ctx.db.insert("walletPasses", {
        serialNumber: "kb-serial-abc123",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        customerId,
        lastBrandTenantId: tenantId,
        installedAt: undefined,
        status: "generated",
        createdAt: Date.now(),
      });

      const pass = await ctx.db.get(passId);
      expect(pass?.serialNumber).toBe("kb-serial-abc123");
      expect(pass?.passTypeIdentifier).toBe("pass.com.kitchen-boost.card");
      expect(pass?.customerId).toBe(customerId);
      expect(pass?.lastBrandTenantId).toBe(tenantId);
      expect(pass?.status).toBe("generated");
    });
  });

  it("carries NO authoritative tenantId field (ADR 0003 — the card is common)", () => {
    // The validator must not expose a top-level `tenantId` — the only tenant
    // reference is the OPTIONAL `lastBrandTenantId` USAGE (visible branding), not
    // an ownership. Guards against a regression that would re-introduce per-resto
    // ownership and break the cross-tenant push moat.
    const fields = schema.tables.walletPasses.validator.fields;
    expect(fields).not.toHaveProperty("tenantId");
    expect(fields).toHaveProperty("lastBrandTenantId");
    expect(fields).toHaveProperty("serialNumber");
  });

  it("is reachable on the by_serial index", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const userId = await ctx.db.insert("users", {
        email: "eater@x.fr",
        role: "customer",
      });
      const customerId = await ctx.db.insert("customers", {
        userId,
        createdAt: Date.now(),
      });
      await ctx.db.insert("walletPasses", {
        serialNumber: "kb-serial-find-me",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        customerId,
        status: "generated",
        createdAt: Date.now(),
      });

      const found = await ctx.db
        .query("walletPasses")
        .withIndex("by_serial", (q) =>
          q.eq("serialNumber", "kb-serial-find-me"),
        )
        .unique();
      expect(found?.customerId).toBe(customerId);
    });
  });
});
