import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "./fuzz";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/tenancy/, so Vite keys same-dir matches as "./x" but parent matches
// as "../../x" — convex-test's findModulesRoot needs ONE common prefix, so we
// normalise every key to be relative to the convex root (../../). Same shape as
// withTenant.test.ts (1.x-C).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/tenancy/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 1.x-D — client-side wrappers (customer + publicTenant), written BEFORE the
 * implementation (TDD red). They sit on the same foundation as the pro wrappers
 * (1.x-C): the single identity point `getCurrentActor` (ADR 0011) and 100 %
 * applicative isolation (ADR 0010).
 *
 *  - `customerQuery` / `customerMutation` — require global role `customer`,
 *    `tenantId` is an EXPLICIT argument; ctx gains `{ actor, tenantId }`. The
 *    handler only ever sees the CALLER's own `actor.userId` → self-scope is
 *    structural (no other customer's id is reachable). A pro (kb_admin /
 *    kb_manager / staff) is rejected; a customer is rejected by the pro wrappers.
 *  - `publicTenantQuery` — read-only public tenant data (e.g. menu). `tenantId`
 *    required and must resolve to an existing tenant (else throws); NO pro auth —
 *    anonymous callers are allowed. ctx gains `{ tenantId, tenant }`.
 *
 * `convex/lib/tenancy/_probes.ts` exposes thin probe functions built with each
 * wrapper so these tests (and the reusable fuzz harness) drive them through the
 * real Convex pipeline via `t.withIdentity({ subject })`.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

describe("1.x-D customer* wrappers — customer actor + self-scope", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("requires an explicit tenantId argument (rejects when missing)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.customerId })
        // @ts-expect-error tenantId is a required explicit argument
        .query(api.lib.tenancy._probes.customerProbeQuery, {}),
    ).rejects.toThrow();
  });

  it("throws Unauthenticated for an anonymous caller", async () => {
    await expect(
      t.query(api.lib.tenancy._probes.customerProbeQuery, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("lets a customer call it and exposes ONLY their own userId (self-scope)", async () => {
    const res = await t
      .withIdentity({ subject: seed.customerId })
      .query(api.lib.tenancy._probes.customerProbeQuery, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(res.role).toBe("customer");
    expect(res.userId).toBe(seed.customerId);
    expect(res.tenantId).toBe(seed.tenantA.tenantId);
  });

  it("a customer may call it against ANY tenant (guest eater, no userTenants row)", async () => {
    const res = await t
      .withIdentity({ subject: seed.customerId })
      .query(api.lib.tenancy._probes.customerProbeQuery, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(res.userId).toBe(seed.customerId);
    expect(res.tenantId).toBe(seed.tenantB.tenantId);
  });

  it("throws Forbidden when a kb_admin tries a customer wrapper", async () => {
    // kb_admin is the only GLOBAL non-customer role (ADR 0011: resto roles are
    // per-tenant on userTenants; users.role ∈ {kb_admin, customer}). So the
    // "a pro cannot call a customer wrapper" guard, AT THE GLOBAL-ROLE LEVEL the
    // customer wrapper checks, is precisely "kb_admin is refused".
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .query(api.lib.tenancy._probes.customerProbeQuery, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("a kb_manager (whose GLOBAL role is customer) may use a customer wrapper", async () => {
    // Per the data model, a restaurateur's global users.role is "customer"; the
    // pro-ness is a PER-TENANT userTenants attachment. As a private individual
    // they are also an eater, so the customer wrapper accepts them — and still
    // exposes only their OWN userId (self-scope). This is the model-faithful
    // reading of "customer ⇎ pro": the GLOBAL split is kb_admin vs customer.
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .query(api.lib.tenancy._probes.customerProbeQuery, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(res.role).toBe("customer");
    expect(res.userId).toBe(seed.tenantA.managerId);
  });

  it("customerMutation enforces the same gate (write path)", async () => {
    // customer ok…
    const ok = await t
      .withIdentity({ subject: seed.customerId })
      .mutation(api.lib.tenancy._probes.customerProbeMutation, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(ok.userId).toBe(seed.customerId);
    // …pro rejected.
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.tenancy._probes.customerProbeMutation, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("customerQueryOptional — optional-auth variant (anonymous → actor null)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("authenticated customer → actor non-null with caller's own userId", async () => {
    // Same gate behaviour as the strict customerQuery: a real customer is
    // allowed in and the handler sees their own actor.
    const res = await t
      .withIdentity({ subject: seed.customerId })
      .query(api.lib.tenancy._probes.customerProbeQueryOptional, {
        tenantId: seed.tenantA.tenantId,
      });
    expect(res.actor).not.toBeNull();
    expect(res.actor?.userId).toBe(seed.customerId);
    expect(res.actor?.role).toBe("customer");
    expect(res.tenantId).toBe(seed.tenantA.tenantId);
  });

  it("anonymous caller → actor NULL (no UNAUTHENTICATED throw)", async () => {
    // The fix's reason for being: a root-layout consumer (e.g. iOS standalone
    // heuristic) firing this query BEFORE signIn must NOT pollute the logs with
    // UNAUTHENTICATED — it gets a null actor and decides what to render.
    const res = await t.query(
      api.lib.tenancy._probes.customerProbeQueryOptional,
      { tenantId: seed.tenantA.tenantId },
    );
    expect(res.actor).toBeNull();
    expect(res.tenantId).toBe(seed.tenantA.tenantId);
  });

  it("PRO caller (kb_admin) → still FORBIDDEN (no bypass of customer-only contract)", async () => {
    // Critical invariant: making the wrapper anonymous-tolerant must NOT open a
    // back door for the global root. PRO callers remain refused so the surface
    // stays customer-only.
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .query(api.lib.tenancy._probes.customerProbeQueryOptional, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("requires an explicit tenantId argument (rejects when missing)", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.customerId })
        // @ts-expect-error tenantId is a required explicit argument
        .query(api.lib.tenancy._probes.customerProbeQueryOptional, {}),
    ).rejects.toThrow();
  });

  it("a customer may call it against ANY tenant (tenantId is an arg, not a scope guarantee)", async () => {
    // Same as customerQuery: self-scope comes from the handler reading via
    // actor.userId, not from a structural tenant check on the wrapper.
    const res = await t
      .withIdentity({ subject: seed.customerId })
      .query(api.lib.tenancy._probes.customerProbeQueryOptional, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(res.actor?.userId).toBe(seed.customerId);
    expect(res.tenantId).toBe(seed.tenantB.tenantId);
  });
});

describe("1.x-D customer ⇎ pro: a customer cannot call a pro wrapper", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("a customer is rejected by a tenant* (pro) wrapper", async () => {
    // No userTenants row → effectiveRole null → Forbidden.
    await expect(
      t
        .withIdentity({ subject: seed.customerId })
        .query(api.lib.tenancy._probes.managerProbeQuery, {
          tenantId: seed.tenantA.tenantId,
        }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("a customer is rejected by a kbAdmin* (pro) wrapper", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.customerId })
        .query(api.lib.tenancy._probes.adminProbeQuery, {}),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("1.x-D publicTenantQuery — public, read-only, valid tenantId", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("requires an explicit tenantId argument (rejects when missing)", async () => {
    await expect(
      // @ts-expect-error tenantId is a required explicit argument
      t.query(api.lib.tenancy._probes.publicTenantProbe, {}),
    ).rejects.toThrow();
  });

  it("is accessible WITHOUT any authentication and returns the tenant's public data", async () => {
    const res = await t.query(api.lib.tenancy._probes.publicTenantProbe, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(res.tenantId).toBe(seed.tenantA.tenantId);
    expect(res.tenantName).toBe(seed.tenantA.name);
  });

  it("is also accessible to an authenticated customer (no pro auth required)", async () => {
    const res = await t
      .withIdentity({ subject: seed.customerId })
      .query(api.lib.tenancy._probes.publicTenantProbe, {
        tenantId: seed.tenantB.tenantId,
      });
    expect(res.tenantName).toBe(seed.tenantB.name);
  });

  it("throws when the tenantId does not resolve to an existing tenant", async () => {
    // Insert then delete a tenant to obtain a syntactically valid but dangling id.
    const danglingId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        slug: "ghost",
        name: "Ghost",
        siret: "ghost",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    await expect(
      t.query(api.lib.tenancy._probes.publicTenantProbe, {
        tenantId: danglingId,
      }),
    ).rejects.toThrow(/forbidden|not found/i);
  });

  it("is read-only: the contract exposes no public mutation twin (type-level)", () => {
    // `api` is a runtime proxy (accessing a missing member returns a proxy, not
    // undefined — project memory), so assert "no public mutation" at the TYPE
    // level. `customerMutation` exists for authenticated writes, but there is
    // deliberately NO public (unauthenticated) mutation builder.
    type Tenancy = typeof import("./index");
    // @ts-expect-error publicTenantMutation does not exist — public access is read-only.
    type _NoPublicMutation = Tenancy["publicTenantMutation"];
    expect(true).toBe(true);
  });
});

describe("1.x-D cross-tenant fuzz — client wrappers, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  // Reuse the harness from 1.x-C (fuzz.ts) verbatim — do NOT reinvent it.
  // For customer wrappers, the only GLOBAL non-customer actor is kb_admin
  // (resto roles are per-tenant; a manager/staff is globally a customer and IS
  // accepted as an eater). So the isolation guarantee the harness pins here is:
  // "the global root (kb_admin) never leaks through a customer wrapper",
  // structurally complemented by self-scope (the handler only sees its own id).
  it("every customer-scoped probe rejects the global root (kb_admin)", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.tenancy._probes.customerProbeQuery,
        api.lib.tenancy._probes.customerProbeMutation,
      ],
      isQuery: (fn) => fn !== api.lib.tenancy._probes.customerProbeMutation,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
      ] satisfies FuzzActor[],
    });
    expect(pairs).toBe(2);
    expect(leaks).toEqual([]);
  });

  it("the pro wrappers reject the plain customer (already in the 1.x-C harness too)", async () => {
    const { leaks } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.tenancy._probes.managerProbeQuery,
        api.lib.tenancy._probes.managerProbeMutation,
      ],
      isQuery: (fn) => fn !== api.lib.tenancy._probes.managerProbeMutation,
      tenantId: seed.tenantA.tenantId,
      actors: [{ label: "customer", subject: seed.customerId }],
    });
    expect(leaks).toEqual([]);
  });
});
