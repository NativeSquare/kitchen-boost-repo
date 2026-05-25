import type { FunctionReference } from "convex/server";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

/**
 * 1.x-C — REUSABLE cross-tenant fuzz harness (ADR 0010).
 *
 * Convex has no Postgres RLS. The third (and last) line of defence against a
 * cross-tenant leak is this harness: it replays each exported tenant-scoped
 * query/mutation under a set of UNAUTHORIZED actors and asserts that EVERY call
 * throws — a function that returns data instead is a "leak" and fails the test.
 *
 * It is deliberately decoupled from the functions it tests so subsequent
 * chantiers (Client Ordering, Payment, Pricing, …) reuse it verbatim:
 *
 * ```ts
 * import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from
 *   "../tenancy/fuzz"; // path relative to your module
 *
 * const t = convexTest(schema, modules);
 * const seed = await seedTwoTenantsAllRoles(t);
 * const { leaks } = await runCrossTenantFuzz(t, {
 *   functions: [api.lib.orders.listOrders, api.lib.orders.createOrder],
 *   isQuery: (fn) => fn !== api.lib.orders.createOrder,
 *   tenantId: seed.tenantA.tenantId,           // the tenant under attack
 *   actors: [
 *     { label: "B-manager", subject: seed.tenantB.managerId },
 *     { label: "detached",  subject: seed.detachedUserId },
 *     { label: "anonymous", subject: null },
 *   ],
 * });
 * expect(leaks).toEqual([]);
 * ```
 *
 * This file is NOT a Convex function module (it registers nothing) and is NOT a
 * `.test.ts` so it can be imported by other suites. It imports only TYPES from
 * `convex/server` (erased at build), so it is safe wherever it lands.
 */

/** Minimal structural handle on the convex-test object the harness needs. */
type FuzzTestHandle = {
  query: (fn: FunctionReference<"query">, args?: unknown) => Promise<unknown>;
  mutation: (
    fn: FunctionReference<"mutation">,
    args?: unknown,
  ) => Promise<unknown>;
  withIdentity: (identity: { subject: string }) => FuzzTestHandle;
};

/** An actor the harness impersonates. `subject: null` = unauthenticated. */
export type FuzzActor = {
  /** Human-readable name, surfaced in a leak report. */
  label: string;
  /** The user id to impersonate, or `null` for an unauthenticated caller. */
  subject: Id<"users"> | null;
};

/** A function the harness should never let through for the given actors. */
export type FuzzableFunction =
  | FunctionReference<"query">
  | FunctionReference<"mutation">;

export type CrossTenantFuzzConfig = {
  /** The exported queries/mutations to replay. */
  functions: FuzzableFunction[];
  /** Distinguish queries from mutations (they dispatch differently). */
  isQuery: (fn: FuzzableFunction) => boolean;
  /**
   * The `tenantId` being attacked. Injected into args for tenant-scoped
   * functions; pass `undefined` for tenant-less functions (e.g. `kbAdmin*`).
   */
  tenantId: Id<"tenants"> | undefined;
  /** The unauthorized actors to try. */
  actors: FuzzActor[];
  /** Extra args merged into every call (rarely needed). */
  extraArgs?: Record<string, unknown>;
};

/** One function that leaked: it RETURNED for an actor instead of throwing. */
export type Leak = {
  function: string;
  actor: string;
};

export type CrossTenantFuzzReport = {
  /** Empty array = isolation held for every (function, actor) pair. */
  leaks: Leak[];
  /** Total (function × actor) pairs exercised. */
  pairs: number;
};

function fnName(fn: FuzzableFunction): string {
  // FunctionReference carries its udf path on a non-enumerable symbol; fall back
  // to JSON for a stable-enough label in a leak report.
  const path = (fn as unknown as { _name?: string })._name;
  return path ?? JSON.stringify(fn);
}

/**
 * Replay every (`function` × `actor`) pair and collect the ones that did NOT
 * throw. A non-throwing call is a cross-tenant leak.
 */
export async function runCrossTenantFuzz(
  t: FuzzTestHandle,
  config: CrossTenantFuzzConfig,
): Promise<CrossTenantFuzzReport> {
  const { functions, isQuery, tenantId, actors, extraArgs } = config;
  const leaks: Leak[] = [];
  let pairs = 0;

  const args: Record<string, unknown> = { ...extraArgs };
  if (tenantId !== undefined) args.tenantId = tenantId;

  for (const fn of functions) {
    for (const actor of actors) {
      pairs += 1;
      const handle =
        actor.subject === null ? t : t.withIdentity({ subject: actor.subject });
      try {
        if (isQuery(fn)) {
          await handle.query(fn as FunctionReference<"query">, args);
        } else {
          await handle.mutation(fn as FunctionReference<"mutation">, args);
        }
        // Reached here ⇒ the call RETURNED instead of throwing ⇒ leak.
        leaks.push({ function: fnName(fn), actor: actor.label });
      } catch {
        // Throw = isolation held for this pair. Expected.
      }
    }
  }

  return { leaks, pairs };
}

/** Ids produced for one seeded tenant. */
export type SeededTenant = {
  tenantId: Id<"tenants">;
  name: string;
  managerId: Id<"users">;
  staffId: Id<"users">;
};

export type TwoTenantSeed = {
  tenantA: SeededTenant;
  tenantB: SeededTenant;
  /** Global kb_admin (root) — no userTenants row. */
  adminId: Id<"users">;
  /** Plain customer — no tenant access at all. */
  customerId: Id<"users">;
  /** User whose access to tenant A was REVOKED (detachedAt set). */
  detachedUserId: Id<"users">;
};

/**
 * Seed the canonical fuzz fixture: two isolated tenants, a kb_manager + a staff
 * on EACH, a global kb_admin, a plain customer, and a user whose access to
 * tenant A has been revoked. Returns every id the harness/tests need.
 *
 * Typed loosely on the test handle so callers don't have to import convex-test
 * value types here; in practice `t` is a `convexTest(...)` result.
 */
export async function seedTwoTenantsAllRoles(t: {
  run: <T>(fn: (ctx: MutationCtx) => Promise<T>) => Promise<T>;
}): Promise<TwoTenantSeed> {
  return t.run(async (ctx) => {
    const now = Date.now();

    const mkTenant = async (slug: string, name: string) =>
      ctx.db.insert("tenants", {
        slug,
        name,
        siret: slug,
        status: "active",
        createdAt: now,
      });

    const attach = async (
      userId: Id<"users">,
      tenantId: Id<"tenants">,
      role: "kb_manager" | "staff",
      detached = false,
    ) =>
      ctx.db.insert("userTenants", {
        userId,
        tenantId,
        role,
        attachedAt: now,
        attachedBy: userId,
        ...(detached ? { detachedAt: now } : {}),
      });

    const tenantAId = await mkTenant("fuzz-a", "Tenant A");
    const tenantBId = await mkTenant("fuzz-b", "Tenant B");

    const aManager = await ctx.db.insert("users", {
      email: "a-mgr@x.fr",
      role: "customer",
    });
    const aStaff = await ctx.db.insert("users", {
      email: "a-staff@x.fr",
      role: "customer",
    });
    const bManager = await ctx.db.insert("users", {
      email: "b-mgr@x.fr",
      role: "customer",
    });
    const bStaff = await ctx.db.insert("users", {
      email: "b-staff@x.fr",
      role: "customer",
    });
    const adminId = await ctx.db.insert("users", {
      email: "root@kb.fr",
      role: "kb_admin",
    });
    const customerId = await ctx.db.insert("users", {
      email: "eater@x.fr",
      role: "customer",
    });
    const detachedUserId = await ctx.db.insert("users", {
      email: "ex@x.fr",
      role: "customer",
    });

    await attach(aManager, tenantAId, "kb_manager");
    await attach(aStaff, tenantAId, "staff");
    await attach(bManager, tenantBId, "kb_manager");
    await attach(bStaff, tenantBId, "staff");
    // detached user WAS a manager of tenant A, now revoked.
    await attach(detachedUserId, tenantAId, "kb_manager", true);

    return {
      tenantA: {
        tenantId: tenantAId,
        name: "Tenant A",
        managerId: aManager,
        staffId: aStaff,
      },
      tenantB: {
        tenantId: tenantBId,
        name: "Tenant B",
        managerId: bManager,
        staffId: bStaff,
      },
      adminId,
      customerId,
      detachedUserId,
    };
  });
}
