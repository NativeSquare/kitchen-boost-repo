import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). Normalise every key
// to be relative to the convex root (../../) so findModulesRoot has ONE common
// prefix (same shape as the contracts / managerInvites suites alongside).
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
 * B-AUTH-6 (#230) — closes-the-loop contract test.
 *
 * Exercises the FULL chain:
 *
 *     inviteManager(tenantId, email)        ← B-AUTH-4
 *       → schedules sendManagerInviteEmail  ← B-AUTH-5
 *         → user clicks magic-link & signs up (simulated here by inserting
 *           a `users` row with the invited email and authenticating the
 *           caller as that user)
 *           → acceptInvite(token)           ← B-AUTH-6 (this slice)
 *             → getSession()                ← B-AUTH-2
 *
 * Acceptance criterion from the issue body:
 *
 *   « Test end-to-end : inviteManager → acceptInvite → getSession retourne
 *     le tenant fraîchement rattaché dans tenants[] »
 *
 * The unit suites for each link (managerInvites.test.ts, admin.test.ts,
 * getSession.test.ts) already pin per-step contracts. This file pins the
 * COMPOSITION, which is what the issue cares about — a regression on any
 * of the three steps that breaks the chain surfaces here, even if the
 * isolated test still passes.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("B-AUTH-6 — inviteManager → acceptInvite → getSession (closes the chain)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("a fresh gérant invited then accepted gets the tenant in their getSession.tenants[]", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    // 1. The admin invites a brand-new gérant on tenantA.
    const inviteId = await asAdmin.mutation(
      api.lib.admin.managerInvites.inviteManager,
      {
        tenantId: seed.tenantA.tenantId,
        email: "khan@example.fr",
        name: "Khan Diallo",
      },
    );

    // 2. Read back the freshly-minted token (the magic-link payload). We
    //    can't go through the email itself in a unit test, but the token IS
    //    the only thing the email carries that matters for `acceptInvite`.
    const inviteRow = await t.run((ctx) => ctx.db.get(inviteId));
    expect(inviteRow?.token).toBeTypeOf("string");
    const token = inviteRow!.token;

    // 3. Simulate the gérant signing up via the magic-link. In real life,
    //    Convex Auth's `signIn("password", { flow: "signUp" })` creates the
    //    `users` row with the invited email; here we insert it manually
    //    (same shape — no role, no userTenants) and authenticate the caller
    //    as that user.
    const newManagerId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "khan@example.fr" }),
    );

    await t
      .withIdentity({ subject: newManagerId })
      .mutation(api.table.admin.acceptInvite, { token });

    // 4. getSession (the bootstrap query the shell calls on every mount)
    //    MUST now return tenantA in the gérant's tenants[].
    const session = await t
      .withIdentity({ subject: newManagerId })
      .query(api.lib.auth.getSession.getSession);

    expect(session.isAdmin).toBe(false);
    expect(session.tenants).toHaveLength(1);
    const [tenant] = session.tenants;
    expect(tenant.tenantId).toBe(seed.tenantA.tenantId);
    expect(tenant.role).toBe("kb_manager");
    // slug + name come from the joined tenants row — assert they're carried
    // through (the shell uses them in the switcher).
    expect(tenant.slug).toBeTypeOf("string");
    expect(tenant.name).toBeTypeOf("string");
  });

  it("the gérant's global user row is NOT mutated by acceptInvite (issue #230 invariant)", async () => {
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    const inviteId = await asAdmin.mutation(
      api.lib.admin.managerInvites.inviteManager,
      { tenantId: seed.tenantA.tenantId, email: "invariant@example.fr" },
    );
    const token = (await t.run((ctx) => ctx.db.get(inviteId)))!.token;

    const newManagerId = await t.run((ctx) =>
      ctx.db.insert("users", { email: "invariant@example.fr" }),
    );

    await t
      .withIdentity({ subject: newManagerId })
      .mutation(api.table.admin.acceptInvite, { token });

    // Strict spec from the issue: « NE PAS patcher users.role ». The user
    // row carries no `role` and no `name` after acceptance — its
    // qualification as a gérant lives entirely on the `userTenants` link.
    const user = await t.run((ctx) => ctx.db.get(newManagerId));
    expect(user?.role).toBeUndefined();
    expect(user?.name).toBeUndefined();
  });

  it("a stale invite landing on an out-of-flow attached gérant throws « déjà rattaché »", async () => {
    // Edge case the issue's « déjà rattaché » guard exists for:
    //   - admin sends a manager invite via the nominal flow;
    //   - the recipient gets attached to the tenant via a separate path
    //     (manual DB insert during a bootstrap script, second admin
    //     creating the attachment by hand, race with another flow…);
    //   - the recipient then clicks the original magic-link.
    // The `acceptInvite` mutation must NOT silently no-op the active
    // attachment — it MUST throw a clear error so the situation surfaces.
    const asAdmin = t.withIdentity({ subject: seed.adminId });

    const inviteId = await asAdmin.mutation(
      api.lib.admin.managerInvites.inviteManager,
      { tenantId: seed.tenantA.tenantId, email: "stale@example.fr" },
    );
    const token = (await t.run((ctx) => ctx.db.get(inviteId)))!.token;

    // Recipient signs up + gets attached out-of-flow (simulating any path
    // other than the nominal acceptInvite — manual seed, parallel script…).
    const newManagerId = await t.run(async (ctx) => {
      const uid = await ctx.db.insert("users", { email: "stale@example.fr" });
      await ctx.db.insert("userTenants", {
        userId: uid,
        tenantId: seed.tenantA.tenantId,
        role: "kb_manager",
        attachedAt: Date.now(),
        attachedBy: seed.adminId,
      });
      return uid;
    });

    // Now the recipient clicks the original magic-link — the « déjà
    // rattaché » guard must fire.
    await expect(
      t
        .withIdentity({ subject: newManagerId })
        .mutation(api.table.admin.acceptInvite, { token }),
    ).rejects.toThrow(/déjà rattaché|deja rattache/i);

    // The invite is NOT consumed — admin can manually revoke the
    // out-of-flow attachment and let the magic-link be replayed.
    const inviteAfter = await t.run((ctx) => ctx.db.get(inviteId));
    expect(inviteAfter?.acceptedAt).toBeUndefined();
  });
});
