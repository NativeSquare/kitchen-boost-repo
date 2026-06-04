import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";

// Module keys for convex-test: array-negation glob + normalise the same-dir "./x"
// keys into the convex/lib/wallet/** path the harness expects (project memory).
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
 * PWA-S9b (#461) — `resolveSerialForBridge` (internal query), written BEFORE the
 * implementation (TDD red).
 *
 * The CROSS-DEVICE / CROSS-RESTO identity BRIDGE at the tap-deep-link surface
 * (decisions-log Q5 « Bridge identité au tap deep-link », US 39 / 40 / 41 / 42).
 *
 * The Wallet pass back-of-pass URL embeds `?wallet=<serialNumber>`. When the
 * client taps the pass on a brand-new device (or on a DIFFERENT KB resto), the
 * PWA edge middleware (`apps/web/src/proxy.ts`) intercepts the param and asks
 * Convex Auth to re-sign the session for the customer the serial resolves to.
 * The Convex Auth `WalletBridge` provider (`ConvexCredentials`, see `auth.ts`)
 * calls THIS internal query — `authorize` is a thin shell that returns
 * `{ userId }` to the framework.
 *
 * ── Source of truth (ADR 0008 / ADR 0012) ─────────────────────────────────────
 * The pass row carries the AUTHORITATIVE `customerId` (fixed at generation,
 * 2.8-A). The `customers` fiche carries the `userId` (the anonymous Convex Auth
 * user). So `serial → walletPasses → customerId → customers → userId` is the
 * full bridge chain. The chain is keyed on the GLOBAL `walletPasses` table (no
 * `tenantId` — ADR 0003 carte commune marque neutre).
 *
 * ── Internal (system seam) — NEVER client-callable ────────────────────────────
 * The serial is opaque but USER-VISIBLE (printed on the back of the pass), so
 * a probing client could enumerate other customers' serials. The wrapper is
 * therefore `internalQuery` — the `WalletBridge` provider runs INSIDE the
 * Convex Auth `signIn` action (server-side, no user surface), the only legit
 * caller. The public `signIn("wallet-bridge", { serial })` IS the surface; the
 * provider's `authorize` fails CLOSED (returns `null`) for any unknown serial
 * so the client cannot probe (no FORBIDDEN throw distinguishing existence).
 *
 * ── No raw `customer` leak (MOAT) ─────────────────────────────────────────────
 * Returns ONLY `{ userId, customerId }` — never a raw `customer` object. Per
 * ADR 0010 / ADR 0011, the MOAT (no raw customer object reaches a manager)
 * holds structurally: `userId` is opaque to PRO, and `customerId` is the same
 * id the `customerQuery` wrappers self-scope on downstream.
 *
 * ── Sanctioned tenancy seam (ADR 0010 / 0011) ─────────────────────────────────
 * Reads go through `readWalletPassBySerial` + `readCustomerFicheById` — the
 * single sanctioned places raw `ctx.db` touches the GLOBAL `walletPasses` /
 * `customers` tables. Identity is irrelevant here (system seam): there is no
 * `getCurrentActor` call because the caller IS the auth framework, before any
 * session exists.
 */

/** Seed a pass + customer fiche; returns ids. */
async function seedCustomerWithPass(
  t: ReturnType<typeof convexTest>,
  serialNumber: string,
): Promise<{
  userId: Id<"users">;
  customerId: Id<"customers">;
  passId: Id<"walletPasses">;
}> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      role: "customer",
      isAnonymous: true,
    });
    const customerId = await ctx.db.insert("customers", {
      userId,
      firstName: "Sophie",
      address: "12 rue de Test, 75012 Paris",
      createdAt: Date.now(),
    });
    const passId = await ctx.db.insert("walletPasses", {
      serialNumber,
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      customerId,
      status: "installed",
      installedAt: Date.now(),
      createdAt: Date.now(),
    });
    return { userId, customerId, passId };
  });
}

describe("PWA-S9b (#461) resolveSerialForBridge — happy path (US 40 brand-new device)", () => {
  it("resolves a known serial → { userId, customerId } of the OWNING customer fiche", async () => {
    const t = convexTest(schema, modules);
    const { userId, customerId } = await seedCustomerWithPass(
      t,
      "kb-bridge-abcdef1234567890",
    );

    const result = await t.query(
      internal.lib.wallet.bridgeSerialToSession.resolveSerialForBridge,
      { serialNumber: "kb-bridge-abcdef1234567890" },
    );

    expect(result).toEqual({ userId, customerId });
  });

  it("returns the SAME userId for a serial whose customer fiche has never set an address (cross-resto, US 41)", async () => {
    // US 41 — Sophie taps her pass on a DIFFERENT KB resto. Same global pass
    // → same `customerId` → same `userId`. The bridge does NOT depend on the
    // host the request lands on (resto isolation comes from the SEPARATE
    // tenant cookie, set independently by the tenant resolver, PRD §10).
    const t = convexTest(schema, modules);
    const { userId, customerId } = await t.run(async (ctx) => {
      const u = await ctx.db.insert("users", {
        role: "customer",
        isAnonymous: true,
      });
      const c = await ctx.db.insert("customers", {
        userId: u,
        createdAt: Date.now(),
      });
      await ctx.db.insert("walletPasses", {
        serialNumber: "kb-bridge-fedcba9876543210",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        customerId: c,
        status: "installed",
        createdAt: Date.now(),
      });
      return { userId: u, customerId: c };
    });

    const result = await t.query(
      internal.lib.wallet.bridgeSerialToSession.resolveSerialForBridge,
      { serialNumber: "kb-bridge-fedcba9876543210" },
    );

    expect(result).toEqual({ userId, customerId });
  });
});

describe("PWA-S9b (#461) resolveSerialForBridge — graceful failure (no existence leak)", () => {
  it("returns null for an UNKNOWN serial (no throw — probing attacker learns nothing)", async () => {
    const t = convexTest(schema, modules);
    // Seed an unrelated pass so the table is not empty.
    await seedCustomerWithPass(t, "kb-bridge-existing0000000000");

    const result = await t.query(
      internal.lib.wallet.bridgeSerialToSession.resolveSerialForBridge,
      { serialNumber: "kb-bridge-not-a-real-serial" },
    );

    expect(result).toBeNull();
  });

  it("returns null when the pass's customer fiche has vanished (RGPD anonymisation / orphan)", async () => {
    // RGPD anonymisation NULLIFIES `pushEnrollment.walletSerialNumber` on
    // the fiche but the GLOBAL `walletPasses` row may still exist (no
    // cascade). If the fiche row itself is gone (hard delete in a test
    // scenario), the bridge must fail CLOSED — never fabricate a session
    // for a userId we cannot read back.
    const t = convexTest(schema, modules);
    const { customerId } = await seedCustomerWithPass(
      t,
      "kb-bridge-orphan00000000000",
    );
    await t.run(async (ctx) => {
      await ctx.db.delete(customerId);
    });

    const result = await t.query(
      internal.lib.wallet.bridgeSerialToSession.resolveSerialForBridge,
      { serialNumber: "kb-bridge-orphan00000000000" },
    );

    expect(result).toBeNull();
  });

  it("returns null when the pass exists but is marked inactive", async () => {
    // A pass marked `inactive` (e.g. revoked by the customer via Wallet
    // "Remove Pass") must NOT bridge — re-tapping a remote-revoked card
    // shouldn't silently re-grant access. The caller re-onboards via the
    // normal anonymous flow.
    const t = convexTest(schema, modules);
    const { userId, customerId } = await t.run(async (ctx) => {
      const u = await ctx.db.insert("users", {
        role: "customer",
        isAnonymous: true,
      });
      const c = await ctx.db.insert("customers", {
        userId: u,
        createdAt: Date.now(),
      });
      await ctx.db.insert("walletPasses", {
        serialNumber: "kb-bridge-inactive00000000",
        passTypeIdentifier: "pass.com.kitchen-boost.card",
        customerId: c,
        status: "inactive",
        createdAt: Date.now(),
      });
      return { userId: u, customerId: c };
    });
    expect(userId).toBeDefined();
    expect(customerId).toBeDefined();

    const result = await t.query(
      internal.lib.wallet.bridgeSerialToSession.resolveSerialForBridge,
      { serialNumber: "kb-bridge-inactive00000000" },
    );

    expect(result).toBeNull();
  });
});
