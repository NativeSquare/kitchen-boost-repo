import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Doc } from "../../_generated/dataModel";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). Normalise every key
// to be relative to the convex root (../../) so findModulesRoot has ONE common
// prefix (same shape as the contracts / tenantSettings suites alongside).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/admin/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * B-AUTH-4 (#204, EPIC #134) — `inviteManager` mutation, the root-only manager
 * pendant of `inviteAdmin` (`convex/table/admin.ts`). Written BEFORE the
 * implementation (TDD red).
 *
 * Wraps `kbAdminMutation` (root-only V1 — only KB Admin can invite a gérant on
 * any tenant). Reaches the shared `adminInvites` table ONLY through the
 * sanctioned `lib/tenancy/adminInvitesStore` seam (ADR 0010 / `no-untenanted-
 * query`). Identity flows only via the wrapper's `getCurrentActor` (ADR 0011).
 *
 * Acceptance criteria covered:
 *  - root-only: every non-`kb_admin` caller is refused (FORBIDDEN /
 *    UNAUTHENTICATED) via the cross-tenant fuzz harness.
 *  - inserts a row with `targetRole: "kb_manager"`, the `tenantId`, email,
 *    name, a fresh token, `invitedBy = actor.userId`, `expiresAt = now + 7d`,
 *    no `acceptedAt`.
 *  - `name` defaults to the email prefix when not supplied.
 *  - duplicate guard: a user already attached (`userTenants` row with
 *    `detachedAt === undefined`) to this tenant on this email is refused.
 *  - pending guard: an existing non-expired invite for `(email, tenantId)` is
 *    refused.
 *  - relance: an EXPIRED invite for `(email, tenantId)` is deleted, then a
 *    fresh one is created (admin can re-invite a gérant who never clicked).
 *  - inexistant tenant: NOT_FOUND when the `tenantId` does not resolve.
 *  - same email may be invited on DIFFERENT tenants in parallel (cas Walid).
 *  - schedules NO email (B-AUTH-5 wires `sendManagerInviteEmail` separately).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** Read every `adminInvites` row (test-only direct read, bypassing wrappers). */
async function readAdminInvites(
  t: ReturnType<typeof convexTest>,
): Promise<Doc<"adminInvites">[]> {
  return t.run((ctx) => ctx.db.query("adminInvites").collect());
}

describe("B-AUTH-4 inviteManager — happy path (root-only)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("kb_admin invites a fresh gérant → row carries the correct fields", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    const before = Date.now();
    const inviteId = await asAdmin.mutation(
      api.lib.admin.managerInvites.inviteManager,
      {
        tenantId: seed.tenantA.tenantId,
        email: "khan@example.fr",
        name: "Khan Diallo",
      },
    );
    const after = Date.now();
    expect(typeof inviteId).toBe("string");

    const row = await t.run((ctx) => ctx.db.get(inviteId));
    expect(row).toBeDefined();
    expect(row?.email).toBe("khan@example.fr");
    expect(row?.name).toBe("Khan Diallo");
    expect(row?.targetRole).toBe("kb_manager");
    expect(row?.tenantId).toBe(seed.tenantA.tenantId);
    expect(row?.invitedBy).toBe(seed.adminId);
    expect(row?.acceptedAt).toBeUndefined();
    // Fresh token: non-empty string.
    expect(typeof row?.token).toBe("string");
    expect((row?.token ?? "").length).toBeGreaterThan(0);
    // expiresAt ≈ now + 7d (within the test window bounds).
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;
    expect(row?.expiresAt).toBeGreaterThanOrEqual(before + SEVEN_DAYS);
    expect(row?.expiresAt).toBeLessThanOrEqual(after + SEVEN_DAYS);
  });

  it("name defaults to the email prefix when omitted", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    const inviteId = await asAdmin.mutation(
      api.lib.admin.managerInvites.inviteManager,
      {
        tenantId: seed.tenantA.tenantId,
        email: "khan@example.fr",
      },
    );
    const row = await t.run((ctx) => ctx.db.get(inviteId));
    expect(row?.name).toBe("khan");
  });

  it("same email may be invited on DIFFERENT tenants in parallel (cas Walid)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    await asAdmin.mutation(api.lib.admin.managerInvites.inviteManager, {
      tenantId: seed.tenantA.tenantId,
      email: "walid@example.fr",
    });
    await asAdmin.mutation(api.lib.admin.managerInvites.inviteManager, {
      tenantId: seed.tenantB.tenantId,
      email: "walid@example.fr",
    });

    const rows = await readAdminInvites(t);
    const walidRows = rows.filter((r) => r.email === "walid@example.fr");
    expect(walidRows).toHaveLength(2);
    const tenants = walidRows.map((r) => r.tenantId).sort();
    expect(tenants).toEqual(
      [seed.tenantA.tenantId, seed.tenantB.tenantId].sort(),
    );
  });

  it("schedules sendManagerInviteEmail with { to, name, token, tenantName } (B-AUTH-5)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // Read the tenant's name so we can assert the snapshot matches what's
    // passed to the scheduled email action (B-AUTH-5 acceptance criterion:
    // tenantName is read from the tenants row at invite time).
    const tenantDoc = await t.run((ctx) => ctx.db.get(seed.tenantA.tenantId));
    expect(tenantDoc).not.toBeNull();
    const expectedTenantName = tenantDoc!.name;

    const inviteId = await asAdmin.mutation(
      api.lib.admin.managerInvites.inviteManager,
      {
        tenantId: seed.tenantA.tenantId,
        email: "khan@example.fr",
        name: "Khan Diallo",
      },
    );
    const row = await t.run((ctx) => ctx.db.get(inviteId));
    expect(row).not.toBeNull();

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    // Exactly one scheduled job — the manager invite email.
    expect(scheduled).toHaveLength(1);
    const job = scheduled[0]!;
    // Convex stores the FunctionReference path as a "/"-separated string with
    // the export name as the last segment (e.g. "emails:sendManagerInviteEmail").
    // Match loosely on the trailing segment so this doesn't depend on the exact
    // serialised shape.
    expect(JSON.stringify(job)).toContain("sendManagerInviteEmail");
    // The scheduler payload (`args` is an ARRAY of positional args, the first
    // of which is the named-args object passed to the internalAction).
    const argsArray = job.args as unknown as Array<Record<string, unknown>>;
    expect(Array.isArray(argsArray)).toBe(true);
    expect(argsArray.length).toBeGreaterThanOrEqual(1);
    const payload = argsArray[0]!;
    expect(payload.to).toBe("khan@example.fr");
    expect(payload.name).toBe("Khan Diallo");
    expect(payload.token).toBe(row!.token);
    expect(payload.tenantName).toBe(expectedTenantName);
  });

  it("scheduled email's name defaults to the email prefix when name is omitted", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    await asAdmin.mutation(api.lib.admin.managerInvites.inviteManager, {
      tenantId: seed.tenantA.tenantId,
      email: "noemail@example.fr",
    });

    const scheduled = await t.run((ctx) =>
      ctx.db.system.query("_scheduled_functions").collect(),
    );
    expect(scheduled).toHaveLength(1);
    const argsArray = scheduled[0]!.args as unknown as Array<
      Record<string, unknown>
    >;
    const payload = argsArray[0]!;
    expect(payload.name).toBe("noemail");
  });
});

describe("B-AUTH-4 inviteManager — validation guards", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("refuses if a user with this email already has an active userTenants row on this tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // Seed an existing manager user attached to tenant A.
    await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "already@example.fr",
        role: "customer",
      });
      await ctx.db.insert("userTenants", {
        userId: uid,
        tenantId: seed.tenantA.tenantId,
        role: "kb_manager",
        attachedAt: Date.now(),
        attachedBy: seed.adminId,
      });
    });

    await expect(
      asAdmin.mutation(api.lib.admin.managerInvites.inviteManager, {
        tenantId: seed.tenantA.tenantId,
        email: "already@example.fr",
      }),
    ).rejects.toThrow(/already.*g[ée]rant|ALREADY_MEMBER|CONFLICT/i);

    // No row created.
    const rows = await readAdminInvites(t);
    expect(rows.filter((r) => r.email === "already@example.fr")).toHaveLength(
      0,
    );
  });

  it("accepts a user whose attachment was DETACHED (can be re-invited)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // Seed a user with a SOFT-DETACHED userTenants row on tenant A.
    await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", {
        email: "exmanager@example.fr",
        role: "customer",
      });
      await ctx.db.insert("userTenants", {
        userId: uid,
        tenantId: seed.tenantA.tenantId,
        role: "kb_manager",
        attachedAt: Date.now(),
        attachedBy: seed.adminId,
        detachedAt: Date.now(),
      });
    });

    const inviteId = await asAdmin.mutation(
      api.lib.admin.managerInvites.inviteManager,
      {
        tenantId: seed.tenantA.tenantId,
        email: "exmanager@example.fr",
      },
    );
    expect(typeof inviteId).toBe("string");
  });

  it("refuses if a pending non-expired invite already exists for (email, tenantId)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // First invite — succeeds.
    await asAdmin.mutation(api.lib.admin.managerInvites.inviteManager, {
      tenantId: seed.tenantA.tenantId,
      email: "twice@example.fr",
    });

    // Second invite — refused (spam guard).
    await expect(
      asAdmin.mutation(api.lib.admin.managerInvites.inviteManager, {
        tenantId: seed.tenantA.tenantId,
        email: "twice@example.fr",
      }),
    ).rejects.toThrow(/already.*sent|already.*invit|ALREADY_INVITED|CONFLICT/i);

    // Only the first invite landed.
    const rows = await readAdminInvites(t);
    expect(rows.filter((r) => r.email === "twice@example.fr")).toHaveLength(1);
  });

  it("RELANCE: an EXPIRED invite for (email, tenantId) is deleted, then a fresh one is created", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // Seed an EXPIRED invite for the (email, tenantId) pair.
    const expiredId = await t.run((ctx) =>
      ctx.db.insert("adminInvites", {
        email: "relance@example.fr",
        name: "Old Name",
        token: "old-token",
        invitedBy: seed.adminId,
        expiresAt: Date.now() - 60_000, // 1 minute ago
        targetRole: "kb_manager",
        tenantId: seed.tenantA.tenantId,
      }),
    );

    const newId = await asAdmin.mutation(
      api.lib.admin.managerInvites.inviteManager,
      {
        tenantId: seed.tenantA.tenantId,
        email: "relance@example.fr",
        name: "Fresh Name",
      },
    );

    // The old expired row is gone, a fresh one took its place.
    const oldRow = await t.run((ctx) => ctx.db.get(expiredId));
    expect(oldRow).toBeNull();

    const newRow = await t.run((ctx) => ctx.db.get(newId));
    expect(newRow?.email).toBe("relance@example.fr");
    expect(newRow?.name).toBe("Fresh Name");
    expect(newRow?.token).not.toBe("old-token");
    expect(newRow?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("inexistant tenant throws NOT_FOUND", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // Insert + delete to obtain a syntactically-valid but absent tenant id.
    const ghost = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        slug: "ghost-mgr",
        name: "Ghost",
        siret: "00000000000000",
        status: "pending",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });

    await expect(
      asAdmin.mutation(api.lib.admin.managerInvites.inviteManager, {
        tenantId: ghost,
        email: "noone@example.fr",
      }),
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it("a user existing globally but NOT attached to this tenant can be invited", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // Seed a user with NO userTenants row anywhere.
    await t.run(async (ctx) =>
      ctx.db.insert("users", {
        email: "lonely@example.fr",
        role: "customer",
      }),
    );

    const inviteId = await asAdmin.mutation(
      api.lib.admin.managerInvites.inviteManager,
      {
        tenantId: seed.tenantA.tenantId,
        email: "lonely@example.fr",
      },
    );
    expect(typeof inviteId).toBe("string");
  });
});

describe("B-AUTH-4 inviteManager — wrapper enforcement (root-only)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("non-kb_admin actors are refused (FORBIDDEN / UNAUTHENTICATED)", async () => {
    const actors = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    // `kbAdminMutation` does NOT consume `tenantId` via the wrapper — it sits in
    // the handler args. Pass it via `extraArgs` and disable the harness's
    // auto-injection with `tenantId: undefined` (same pattern as `activate`).
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.admin.managerInvites.inviteManager],
      isQuery: () => false,
      tenantId: undefined,
      actors,
      extraArgs: {
        tenantId: seed.tenantA.tenantId,
        email: "leak@example.fr",
      },
    });

    expect(leaks).toEqual([]);
    expect(pairs).toBe(actors.length);

    // No side effect leaked through.
    const rows = await readAdminInvites(t);
    expect(rows.filter((r) => r.email === "leak@example.fr")).toHaveLength(0);
  });

  it("kb_manager calling inviteManager throws FORBIDDEN explicitly", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asMgr.mutation(api.lib.admin.managerInvites.inviteManager, {
        tenantId: seed.tenantA.tenantId,
        email: "x@example.fr",
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("anonymous caller throws UNAUTHENTICATED explicitly", async () => {
    await expect(
      t.mutation(api.lib.admin.managerInvites.inviteManager, {
        tenantId: seed.tenantA.tenantId,
        email: "x@example.fr",
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });
});

/**
 * F-WIZARD [9/10] (#273) — `getLatestManagerInviteForTenant` query (root-only).
 *
 * The wizard's Step 7 `useWizardState` hook needs to know whether a manager
 * invite row already exists for a tenant — that's the canonical completion
 * signal per the issue spec (« Le hook useWizardState marque step 7 complete
 * si une ligne managerInvites existe pour le tenant, peu importe acceptedAt »).
 *
 * Wraps `kbAdminQuery` — V1 strict: the wizard runs as KB Admin only. Returns
 * the most recently created manager invite for `tenantId` (last by
 * `_creationTime`) or `null` if none has ever been emitted for the tenant.
 * Reads via the sanctioned `lib/tenancy/adminInvitesStore` seam — same ADR 0010
 * discipline as `inviteManager` (no raw `ctx.db` in `lib/admin/**`).
 */
describe("F-WIZARD [9/10] — getLatestManagerInviteForTenant query", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("returns null when no manager invite exists for the tenant", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    const row = await asAdmin.query(
      api.lib.admin.managerInvites.getLatestManagerInviteForTenant,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(row).toBeNull();
  });

  it("returns the invite row when one exists (any acceptedAt)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await asAdmin.mutation(api.lib.admin.managerInvites.inviteManager, {
      tenantId: seed.tenantA.tenantId,
      email: "gerant@example.fr",
      name: "Le Gérant",
    });

    const row = await asAdmin.query(
      api.lib.admin.managerInvites.getLatestManagerInviteForTenant,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(row).not.toBeNull();
    expect(row?.email).toBe("gerant@example.fr");
    expect(row?.tenantId).toBe(seed.tenantA.tenantId);
    expect(row?.targetRole).toBe("kb_manager");
  });

  it("returns the LATEST invite when multiple exist (by _creationTime desc)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // Seed two invites for the same tenant directly via raw ctx.db so we can
    // control _creationTime ordering. The newer one is inserted SECOND.
    const olderId = await t.run((ctx) =>
      ctx.db.insert("adminInvites", {
        email: "first@example.fr",
        name: "First",
        token: "old-token-xxxx",
        invitedBy: seed.adminId,
        expiresAt: Date.now() + 60_000,
        targetRole: "kb_manager",
        tenantId: seed.tenantA.tenantId,
      }),
    );
    // Small delay so _creationTime differs.
    await new Promise((r) => setTimeout(r, 5));
    const newerId = await t.run((ctx) =>
      ctx.db.insert("adminInvites", {
        email: "second@example.fr",
        name: "Second",
        token: "new-token-xxxx",
        invitedBy: seed.adminId,
        expiresAt: Date.now() + 60_000,
        targetRole: "kb_manager",
        tenantId: seed.tenantA.tenantId,
      }),
    );

    const row = await asAdmin.query(
      api.lib.admin.managerInvites.getLatestManagerInviteForTenant,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(row).not.toBeNull();
    expect(row?._id).toBe(newerId);
    expect(row?.email).toBe("second@example.fr");
    // Sanity: the older row still exists.
    const older = await t.run((ctx) => ctx.db.get(olderId));
    expect(older).not.toBeNull();
  });

  it("ignores invites for OTHER tenants (tenant scoping)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    // Seed an invite for tenant B.
    await asAdmin.mutation(api.lib.admin.managerInvites.inviteManager, {
      tenantId: seed.tenantB.tenantId,
      email: "b@example.fr",
    });
    // Tenant A still returns null.
    const rowA = await asAdmin.query(
      api.lib.admin.managerInvites.getLatestManagerInviteForTenant,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(rowA).toBeNull();
    // Tenant B returns the row.
    const rowB = await asAdmin.query(
      api.lib.admin.managerInvites.getLatestManagerInviteForTenant,
      { tenantId: seed.tenantB.tenantId },
    );
    expect(rowB).not.toBeNull();
    expect(rowB?.email).toBe("b@example.fr");
  });

  it("returns the invite EVEN IF acceptedAt is set (presence is the gate)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await t.run((ctx) =>
      ctx.db.insert("adminInvites", {
        email: "accepted@example.fr",
        name: "Accepted",
        token: "tok-accepted",
        invitedBy: seed.adminId,
        expiresAt: Date.now() + 60_000,
        targetRole: "kb_manager",
        tenantId: seed.tenantA.tenantId,
        acceptedAt: Date.now(),
      }),
    );
    const row = await asAdmin.query(
      api.lib.admin.managerInvites.getLatestManagerInviteForTenant,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(row).not.toBeNull();
    expect(row?.acceptedAt).toBeDefined();
  });

  it("ignores rows whose targetRole !== 'kb_manager' (legacy kb_admin invites)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    // Insert a LEGACY admin invite shape: no targetRole, no tenantId — these
    // do not surface (the by_tenant index has no entry for them).
    await t.run((ctx) =>
      ctx.db.insert("adminInvites", {
        email: "legacy-admin@example.fr",
        name: "Legacy Admin",
        token: "legacy-tok",
        invitedBy: seed.adminId,
        expiresAt: Date.now() + 60_000,
      }),
    );
    const row = await asAdmin.query(
      api.lib.admin.managerInvites.getLatestManagerInviteForTenant,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(row).toBeNull();
  });

  it("non-kb_admin callers are refused (FORBIDDEN / UNAUTHENTICATED) — cross-tenant fuzz", async () => {
    // Seed an invite so a leak would visibly return a row.
    const asAdmin = t.withIdentity({ subject: seed.adminId });
    await asAdmin.mutation(api.lib.admin.managerInvites.inviteManager, {
      tenantId: seed.tenantA.tenantId,
      email: "leakcheck@example.fr",
    });

    const actors = [
      { label: "A-manager", subject: seed.tenantA.managerId },
      { label: "A-staff", subject: seed.tenantA.staffId },
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "plain-customer", subject: seed.customerId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "anonymous", subject: null },
    ];

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.admin.managerInvites.getLatestManagerInviteForTenant],
      isQuery: () => true,
      tenantId: undefined,
      actors,
      extraArgs: { tenantId: seed.tenantA.tenantId },
    });
    expect(leaks).toEqual([]);
    expect(pairs).toBe(actors.length);
  });
});
