import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import schema from "./schema";

// convex-test needs the function modules; array-negation glob form is required
// (project memory — extglob returns ZERO modules). This file sits at the convex
// root, so same-dir keys are already "./x" — no key normalisation needed.
const modules = import.meta.glob(["./**/*.{ts,js}", "!./**/*.test.*"]);

/**
 * 2.8-B — `walletDeviceRegistrations` schema, written BEFORE the implementation
 * (TDD red). Proves the GLOBAL (no authoritative `tenantId`, ADR 0003) device↔pass
 * registry round-trips its fields and is reachable on `by_serial` / `by_device` /
 * the unique `by_device_serial` couple. No business logic here — register /
 * unregister live in `lib/wallet`.
 */
describe("2.8-B schema — walletDeviceRegistrations (GLOBAL, no authoritative tenantId, ADR 0003)", () => {
  it("round-trips a registration row with all fields", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const id = await ctx.db.insert("walletDeviceRegistrations", {
        serialNumber: "kb-serial-abc123",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        deviceLibraryIdentifier: "device-xyz",
        pushToken: "apns-push-token-123",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const row = await ctx.db.get(id);
      expect(row?.serialNumber).toBe("kb-serial-abc123");
      expect(row?.passTypeIdentifier).toBe("pass.com.kitchen-boost.card");
      expect(row?.deviceLibraryIdentifier).toBe("device-xyz");
      expect(row?.pushToken).toBe("apns-push-token-123");
      expect(row?.status).toBe("active");
    });
  });

  it("carries NO authoritative tenantId field (ADR 0003 — the card is common)", () => {
    const fields = schema.tables.walletDeviceRegistrations.validator.fields;
    expect(fields).not.toHaveProperty("tenantId");
    expect(fields).toHaveProperty("serialNumber");
    expect(fields).toHaveProperty("deviceLibraryIdentifier");
    expect(fields).toHaveProperty("pushToken");
  });

  it("is reachable on by_serial and by_device indexes", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("walletDeviceRegistrations", {
        serialNumber: "kb-find-serial",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        deviceLibraryIdentifier: "device-find",
        pushToken: "tok",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      const bySerial = await ctx.db
        .query("walletDeviceRegistrations")
        .withIndex("by_serial", (q) => q.eq("serialNumber", "kb-find-serial"))
        .unique();
      expect(bySerial?.deviceLibraryIdentifier).toBe("device-find");

      const byDevice = await ctx.db
        .query("walletDeviceRegistrations")
        .withIndex("by_device", (q) =>
          q.eq("deviceLibraryIdentifier", "device-find"),
        )
        .unique();
      expect(byDevice?.serialNumber).toBe("kb-find-serial");
    });
  });

  it("is reachable on the unique by_device_serial couple", async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert("walletDeviceRegistrations", {
        serialNumber: "kb-couple-serial",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        deviceLibraryIdentifier: "device-couple",
        pushToken: "tok",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      const found = await ctx.db
        .query("walletDeviceRegistrations")
        .withIndex("by_device_serial", (q) =>
          q
            .eq("deviceLibraryIdentifier", "device-couple")
            .eq("serialNumber", "kb-couple-serial"),
        )
        .unique();
      expect(found).not.toBeNull();
    });
  });
});
