import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/customer/, so normalise every relative key to be relative to the
// convex root (../../) so convex-test's findModulesRoot has ONE common prefix
// (same shape as the consent / webPush suites).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/customer/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * PWA-S6c (#457) — `markNoChannelPossible` self-scoped mutation, written
 * BEFORE the implementation (TDD red).
 *
 * Surface under test:
 *  - `api.lib.customer.pushEnrollment.markNoChannelPossible` — self-scoped
 *    `customerMutation` taking ZERO business args (the customer is resolved
 *    from `ctx.actor.userId`, the same self-scope contract as `webPush.register`
 *    and `recordConsentAtCheckout`). Sets `pushEnrollment.noChannelPossible = true`
 *    on the caller's OWN fiche via the sanctioned tenancy seam, MERGING into the
 *    existing object so the per-channel statuses are preserved (US #16 invariant).
 *    Writes ONE explicit `auditLog` row tagged `customer.pushEnrollment.markNoChannelPossible`
 *    with the customer id as `targetId` (decisions-log Q8 « audit log entry
 *    pour fallback no-channel »).
 *
 * Cross-tenant isolation (ADR 0010): the customer wrapper is self-scoped by
 * construction, so the fuzz here pins the SAME refusal shape as the webPush /
 * consent suites — global root + anonymous caller are refused; a PRO is
 * refused for the customer role.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

async function seedAnonymousCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { role: "customer", isAnonymous: true }),
  );
}

async function provision(
  t: ReturnType<typeof convexTest>,
  userId: Id<"users">,
  tenantId: Id<"tenants">,
): Promise<Id<"customers">> {
  return t
    .withIdentity({ subject: userId })
    .mutation(api.lib.customer.identity.getOrCreateCurrentCustomer, {
      tenantId,
    });
}

// ---------------------------------------------------------------------------
// markNoChannelPossible — flips the flag + audit, preserving sibling fields.
// ---------------------------------------------------------------------------

describe("PWA-S6c markNoChannelPossible — flips the flag on the OWN fiche", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("sets pushEnrollment.noChannelPossible = true on the caller's fiche", async () => {
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.markNoChannelPossible, {
        tenantId: seed.tenantA.tenantId,
      });
    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    expect(fiche?.pushEnrollment?.noChannelPossible).toBe(true);
  });

  it("provisions the fiche on the fly if the caller has none yet (same idempotency as register)", async () => {
    const userId = await seedAnonymousCustomer(t);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.markNoChannelPossible, {
        tenantId: seed.tenantA.tenantId,
      });
    const fiche = await t.run((ctx) =>
      ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(fiche?.userId).toBe(userId);
    expect(fiche?.pushEnrollment?.noChannelPossible).toBe(true);
  });

  it("MERGES — sibling per-channel statuses already on the fiche are preserved (US #16)", async () => {
    // Pre-seed a fiche with an existing pushEnrollment object — the flag flip
    // must NOT clobber the wallet/web-push/A2HS statuses (the seam MERGES,
    // see lib/tenancy/customerOrdersStore.patchCustomerPushEnrollment).
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t.run((ctx) =>
      ctx.db.patch(customerId, {
        pushEnrollment: {
          walletStatus: "revoked",
          webPushStatus: "revoked",
          a2hsStatus: "not_enrolled",
        },
      }),
    );
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.markNoChannelPossible, {
        tenantId: seed.tenantA.tenantId,
      });
    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    expect(fiche?.pushEnrollment?.noChannelPossible).toBe(true);
    expect(fiche?.pushEnrollment?.walletStatus).toBe("revoked");
    expect(fiche?.pushEnrollment?.webPushStatus).toBe("revoked");
    expect(fiche?.pushEnrollment?.a2hsStatus).toBe("not_enrolled");
  });

  it("is idempotent — calling twice keeps the flag true with no extra side-effect on siblings", async () => {
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.markNoChannelPossible, {
        tenantId: seed.tenantA.tenantId,
      });
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.markNoChannelPossible, {
        tenantId: seed.tenantA.tenantId,
      });
    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    expect(fiche?.pushEnrollment?.noChannelPossible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Audit log — one explicit row per successful flip.
// ---------------------------------------------------------------------------

describe("PWA-S6c markNoChannelPossible — writes the audit row", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("writes ONE auditLog row tagged customer.pushEnrollment.markNoChannelPossible", async () => {
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.markNoChannelPossible, {
        tenantId: seed.tenantA.tenantId,
      });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) =>
          q.eq(
            q.field("action"),
            "customer.pushEnrollment.markNoChannelPossible",
          ),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(userId);
    expect(rows[0]?.actorRole).toBe("customer");
    expect(rows[0]?.tenantId).toBe(seed.tenantA.tenantId);
    expect(rows[0]?.targetType).toBe("customer");
    expect(rows[0]?.targetId).toBe(customerId);
    expect(typeof rows[0]?.timestamp).toBe("number");
  });

  it("a refused call (PRO actor) writes NO audit row (insert commits in the same tx)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.customer.pushEnrollment.markNoChannelPossible, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) =>
          q.eq(
            q.field("action"),
            "customer.pushEnrollment.markNoChannelPossible",
          ),
        )
        .collect(),
    );
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Auth gate + cross-tenant fuzz (ADR 0010).
// ---------------------------------------------------------------------------

describe("PWA-S6c markNoChannelPossible — auth gate + cross-tenant fuzz", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    await expect(
      t.mutation(api.lib.customer.pushEnrollment.markNoChannelPossible, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — push enrollment is customers only", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.customer.pushEnrollment.markNoChannelPossible, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("self-scope: Bob's flip never touches Alice's fiche", async () => {
    const alice = await seedAnonymousCustomer(t);
    const bob = await seedAnonymousCustomer(t);
    const aliceFiche = await provision(t, alice, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: bob })
      .mutation(api.lib.customer.pushEnrollment.markNoChannelPossible, {
        tenantId: seed.tenantA.tenantId,
      });
    const aliceDoc = await t.run((ctx) => ctx.db.get(aliceFiche));
    expect(aliceDoc?.pushEnrollment?.noChannelPossible).toBeUndefined();
  });

  it("the global root (kb_admin) + anonymous are rejected (cross-tenant fuzz)", async () => {
    // Same shape as the webPush suite — the customer wrapper admits the seed
    // « manager » (global role customer) and the SELF-SCOPE is what isolates
    // them, while it REFUSES the global root + anonymous caller (ADR 0010 /
    // 0011).
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.pushEnrollment.markNoChannelPossible],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: {},
    });
    expect(pairs).toBe(2);
    expect(leaks).toEqual([]);
  });
});

// ===========================================================================
// PWA-S10 (#462) — `recordA2hsAccepted` self-scoped mutation, written BEFORE
// the implementation (TDD red).
//
// Surface under test:
//  - `api.lib.customer.pushEnrollment.recordA2hsAccepted` — self-scoped
//    `customerMutation` taking ZERO business args (the customer is resolved
//    from `ctx.actor.userId`, same self-scope contract as `markNoChannelPossible`
//    / `webPush.register` / `recordConsentAtCheckout`). Flips
//    `pushEnrollment.a2hsStatus = "enrolled"` on the caller's OWN fiche via
//    the sanctioned tenancy seam, MERGING into the existing object so the
//    per-channel statuses (wallet / web-push) AND `noChannelPossible` are
//    preserved (US #16 invariant). Writes ONE explicit `auditLog` row tagged
//    `customer.pushEnrollment.recordA2hsAccepted` with the customer id as
//    `targetId` (same audit shape as `markNoChannelPossible`).
//
// Fired by the front from `<AndroidInstallButton>` when (a) the user
// confirmed the native Android install prompt (`prompt.userChoice = accepted`)
// OR (b) the `appinstalled` window event fires (covers the case where the
// user installs from the browser menu without going through our button).
// Provisions the fiche on the fly if absent (idempotent — same robustness as
// `markNoChannelPossible`).
//
// Cross-tenant isolation (ADR 0010): the customer wrapper is self-scoped by
// construction, so the fuzz pins the SAME refusal shape — global root +
// anonymous caller refused; PRO refused for the customer role.
// ===========================================================================

describe("PWA-S10 recordA2hsAccepted — flips a2hsStatus on the OWN fiche", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it('sets pushEnrollment.a2hsStatus = "enrolled" on the caller\'s fiche', async () => {
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.recordA2hsAccepted, {
        tenantId: seed.tenantA.tenantId,
      });
    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    expect(fiche?.pushEnrollment?.a2hsStatus).toBe("enrolled");
  });

  it("provisions the fiche on the fly if the caller has none yet (idempotent like markNoChannelPossible)", async () => {
    const userId = await seedAnonymousCustomer(t);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.recordA2hsAccepted, {
        tenantId: seed.tenantA.tenantId,
      });
    const fiche = await t.run((ctx) =>
      ctx.db
        .query("customers")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique(),
    );
    expect(fiche?.userId).toBe(userId);
    expect(fiche?.pushEnrollment?.a2hsStatus).toBe("enrolled");
  });

  it("MERGES — sibling per-channel statuses + noChannelPossible already on the fiche are preserved (US #16)", async () => {
    // Pre-seed with an existing pushEnrollment object — the a2hs flip must
    // NOT clobber the wallet/web-push statuses NOR the noChannelPossible flag
    // (the seam MERGES, see lib/tenancy/customerOrdersStore.patchCustomerPushEnrollment).
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t.run((ctx) =>
      ctx.db.patch(customerId, {
        pushEnrollment: {
          walletStatus: "enrolled",
          webPushStatus: "revoked",
          a2hsStatus: "not_enrolled",
          noChannelPossible: true,
        },
      }),
    );
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.recordA2hsAccepted, {
        tenantId: seed.tenantA.tenantId,
      });
    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    expect(fiche?.pushEnrollment?.a2hsStatus).toBe("enrolled");
    expect(fiche?.pushEnrollment?.walletStatus).toBe("enrolled");
    expect(fiche?.pushEnrollment?.webPushStatus).toBe("revoked");
    expect(fiche?.pushEnrollment?.noChannelPossible).toBe(true);
  });

  it("is idempotent — calling twice keeps a2hsStatus enrolled with no extra side-effect", async () => {
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.recordA2hsAccepted, {
        tenantId: seed.tenantA.tenantId,
      });
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.recordA2hsAccepted, {
        tenantId: seed.tenantA.tenantId,
      });
    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    expect(fiche?.pushEnrollment?.a2hsStatus).toBe("enrolled");
  });
});

describe("PWA-S10 recordA2hsAccepted — writes the audit row", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("writes ONE auditLog row tagged customer.pushEnrollment.recordA2hsAccepted", async () => {
    const userId = await seedAnonymousCustomer(t);
    const customerId = await provision(t, userId, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: userId })
      .mutation(api.lib.customer.pushEnrollment.recordA2hsAccepted, {
        tenantId: seed.tenantA.tenantId,
      });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) =>
          q.eq(q.field("action"), "customer.pushEnrollment.recordA2hsAccepted"),
        )
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actorUserId).toBe(userId);
    expect(rows[0]?.actorRole).toBe("customer");
    expect(rows[0]?.tenantId).toBe(seed.tenantA.tenantId);
    expect(rows[0]?.targetType).toBe("customer");
    expect(rows[0]?.targetId).toBe(customerId);
    expect(typeof rows[0]?.timestamp).toBe("number");
  });

  it("a refused call (PRO actor) writes NO audit row (insert commits in the same tx)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.customer.pushEnrollment.recordA2hsAccepted, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
    const rows = await t.run((ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) =>
          q.eq(q.field("action"), "customer.pushEnrollment.recordA2hsAccepted"),
        )
        .collect(),
    );
    expect(rows).toEqual([]);
  });
});

describe("PWA-S10 recordA2hsAccepted — auth gate + cross-tenant fuzz", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    await expect(
      t.mutation(api.lib.customer.pushEnrollment.recordA2hsAccepted, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — push enrollment is customers only", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.customer.pushEnrollment.recordA2hsAccepted, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("self-scope: Bob's flip never touches Alice's fiche", async () => {
    const alice = await seedAnonymousCustomer(t);
    const bob = await seedAnonymousCustomer(t);
    const aliceFiche = await provision(t, alice, seed.tenantA.tenantId);
    await t
      .withIdentity({ subject: bob })
      .mutation(api.lib.customer.pushEnrollment.recordA2hsAccepted, {
        tenantId: seed.tenantA.tenantId,
      });
    const aliceDoc = await t.run((ctx) => ctx.db.get(aliceFiche));
    expect(aliceDoc?.pushEnrollment?.a2hsStatus).toBeUndefined();
  });

  it("the global root (kb_admin) + anonymous are rejected (cross-tenant fuzz)", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.customer.pushEnrollment.recordA2hsAccepted],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: {},
    });
    expect(pairs).toBe(2);
    expect(leaks).toEqual([]);
  });
});
