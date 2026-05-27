import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { WALLET_PASS_TYPE_IDENTIFIER } from "./index";

// convex-test module keys: array-negation glob + normalise same-dir "./x".
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/wallet/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.8-B — re-serving the latest `.pkpass` for an EXISTING serial (US 9, the Web
 * Service `GET pass/[serial]`), written BEFORE the implementation (TDD red).
 *
 * The device re-downloads a pass it already installed; we rebuild the SAME pure
 * Apple `pass.json` from the persisted `walletPasses` row (slice A builder reuse —
 * deterministic from serial + `lastBrandTenantId`) and sign it with the real certs.
 * The REAL signature is HITL (POC #3 + device e2e, not CI), so here we assert the
 * resolve-context query + the unsigned structure (no certs in CI ⇒ `signed: false`).
 */

const GOOGLE_ISSUER_ID = "3388000000022222222";

async function seedPass(
  t: ReturnType<typeof convexTest>,
  serialNumber: string,
  brandTenantId?: Id<"tenants">,
): Promise<void> {
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
      serialNumber,
      passTypeIdentifier: WALLET_PASS_TYPE_IDENTIFIER,
      customerId,
      lastBrandTenantId: brandTenantId,
      status: "generated",
      createdAt: Date.now(),
    });
  });
}

describe("2.8-B getPassRebuildContext — resolve a pass's brand context by serial (US 9)", () => {
  it("returns the brand resto name for a pass carrying lastBrandTenantId", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        slug: "buns-bao",
        name: "Buns & Bao",
        siret: "buns-bao",
        status: "active",
        createdAt: Date.now(),
      }),
    );
    await seedPass(t, "kb-serve-1", tenantId);

    const ctx = await t.query(
      internal.lib.wallet.passDb.getPassRebuildContext,
      { serialNumber: "kb-serve-1" },
    );
    expect(ctx).not.toBeNull();
    expect(ctx?.brandTenantName).toBe("Buns & Bao");
  });

  it("returns null brand for a pass with no brand resto yet", async () => {
    const t = convexTest(schema, modules);
    await seedPass(t, "kb-serve-2");
    const ctx = await t.query(
      internal.lib.wallet.passDb.getPassRebuildContext,
      { serialNumber: "kb-serve-2" },
    );
    expect(ctx?.brandTenantName).toBeNull();
  });

  it("returns null for an unknown serial", async () => {
    const t = convexTest(schema, modules);
    const ctx = await t.query(
      internal.lib.wallet.passDb.getPassRebuildContext,
      { serialNumber: "kb-nope" },
    );
    expect(ctx).toBeNull();
  });
});

describe("2.8-B signPkpassForSerial — rebuild + (HITL) sign the latest pass (US 9)", () => {
  beforeEach(() => {
    process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON = "";
    process.env.GOOGLE_WALLET_ISSUER_ID = GOOGLE_ISSUER_ID;
    // No real Apple cert in CI — the action returns the unsigned structure.
    delete process.env.WALLET_PASS_CERT_P12_BASE64;
    delete process.env.WALLET_PASS_CERT_PASSWORD;
    delete process.env.WALLET_WWDR_CERT_BASE64;
  });
  afterEach(() => {
    delete process.env.GOOGLE_WALLET_ISSUER_ID;
    delete process.env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON;
  });

  it("rebuilds the Apple pass.json from the persisted row (serial + brand)", async () => {
    const t = convexTest(schema, modules);
    const tenantId = await t.run(async (ctx) =>
      ctx.db.insert("tenants", {
        slug: "buns-bao",
        name: "Buns & Bao",
        siret: "buns-bao",
        status: "active",
        createdAt: Date.now(),
      }),
    );
    await seedPass(t, "kb-serve-3", tenantId);

    const res = await t.action(
      internal.lib.wallet.generatePass.signPkpassForSerial,
      { serialNumber: "kb-serve-3" },
    );
    expect(res.applePass.serialNumber).toBe("kb-serve-3");
    expect(res.applePass.passTypeIdentifier).toBe(WALLET_PASS_TYPE_IDENTIFIER);
    expect(JSON.stringify(res.applePass.generic.headerFields)).toContain(
      "Buns & Bao",
    );
    // No real Apple certs in CI ⇒ unsigned structure, mergeable + testable.
    expect(res.signed).toBe(false);
    expect(res.pkpassBase64).toBeNull();
  });

  it("throws for an unknown serial (no fabricated pass)", async () => {
    const t = convexTest(schema, modules);
    await expect(
      t.action(internal.lib.wallet.generatePass.signPkpassForSerial, {
        serialNumber: "kb-ghost",
      }),
    ).rejects.toThrow();
  });
});
