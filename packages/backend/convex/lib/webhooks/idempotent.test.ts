import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import schema from "../../schema";
import { withIdempotence } from "./idempotent";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/webhooks/, so Vite keys same-dir matches as "./x" but parent matches
// as "../../x" — convex-test's findModulesRoot needs ONE common prefix, so we
// normalise every key to be relative to the convex root (../../), same shape as
// the tenancy (1.x-C) / crypto (1.x-E) suites.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/webhooks/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 1.x-F — `withIdempotence`, the anti-double-processing guard shared by every
 * external webhook (Stripe, Uber Direct, Resend; Hubrise V2). STACK.md §2.7 /
 * §5.2. Written BEFORE the implementation (TDD red).
 *
 * Contract under test: `withIdempotence(ctx, provider, eventId, handler)`
 *  - first time it sees a `(provider, eventId)` → records it and RUNS `handler`,
 *  - any later replay of the SAME `(provider, eventId)` → RETURNS without running
 *    `handler` again (the side effect happens exactly once),
 *  - two DISTINCT `eventId`s (same provider) → both handlers run,
 *  - the dedup ledger lives in `processedWebhookEvents`, keyed on the composite
 *    index `by_provider_event` (`provider`, `externalId`).
 *
 * It is an INTERNAL helper called from webhook `httpAction`s — not an exposed
 * query/mutation — so it is driven here through a write-capable ctx via
 * `t.run`, exactly the ctx shape a webhook handler hands it.
 */

const STRIPE = "stripe";
const UBER = "uber_direct";

describe("1.x-F withIdempotence — runs the handler exactly once per (provider, eventId)", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("runs the handler on the FIRST sighting of a (provider, eventId)", async () => {
    const handler = vi.fn(async () => {});
    await t.run(async (ctx) => {
      await withIdempotence(ctx, STRIPE, "evt_1", handler);
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("records exactly one ledger row, on the by_provider_event index", async () => {
    await t.run(async (ctx) => {
      await withIdempotence(ctx, STRIPE, "evt_row", async () => {});
    });
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_provider_event", (q) =>
          q.eq("provider", STRIPE).eq("externalId", "evt_row"),
        )
        .unique(),
    );
    expect(row).not.toBeNull();
    expect(row?.provider).toBe(STRIPE);
    expect(row?.externalId).toBe("evt_row");
    expect(typeof row?.processedAt).toBe("number");
  });

  it("does NOT replay the handler on a second call with the SAME (provider, eventId)", async () => {
    const handler = vi.fn(async () => {});
    // Two separate ctx scopes mimic two distinct webhook deliveries of the
    // same event (Stripe at-least-once delivery / network retry).
    await t.run(async (ctx) => {
      await withIdempotence(ctx, STRIPE, "evt_dup", handler);
    });
    await t.run(async (ctx) => {
      await withIdempotence(ctx, STRIPE, "evt_dup", handler);
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("the side effect happens exactly once across a duplicate delivery", async () => {
    // A realistic side effect: append to a side table — count must stay at 1.
    let sideEffects = 0;
    const handler = async () => {
      sideEffects += 1;
    };
    for (let i = 0; i < 3; i++) {
      await t.run(async (ctx) => {
        await withIdempotence(ctx, UBER, "delivery_99", handler);
      });
    }
    expect(sideEffects).toBe(1);

    // And the ledger still holds a single row (no duplicate inserts).
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_provider_event", (q) =>
          q.eq("provider", UBER).eq("externalId", "delivery_99"),
        )
        .collect(),
    );
    expect(rows.length).toBe(1);
  });
});

describe("1.x-F withIdempotence — distinct events each run once", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("runs BOTH handlers for two DISTINCT eventIds (same provider)", async () => {
    const h1 = vi.fn(async () => {});
    const h2 = vi.fn(async () => {});
    await t.run(async (ctx) => {
      await withIdempotence(ctx, STRIPE, "evt_a", h1);
      await withIdempotence(ctx, STRIPE, "evt_b", h2);
    });
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
  });

  it("treats the same eventId under DIFFERENT providers as distinct (composite key)", async () => {
    // Stripe's `evt_x` and Uber's `evt_x` are different events — both must run.
    const hStripe = vi.fn(async () => {});
    const hUber = vi.fn(async () => {});
    await t.run(async (ctx) => {
      await withIdempotence(ctx, STRIPE, "evt_x", hStripe);
      await withIdempotence(ctx, UBER, "evt_x", hUber);
    });
    expect(hStripe).toHaveBeenCalledTimes(1);
    expect(hUber).toHaveBeenCalledTimes(1);

    const rows = await t.run(async (ctx) =>
      ctx.db.query("processedWebhookEvents").collect(),
    );
    expect(rows.length).toBe(2);
  });
});

describe("1.x-F withIdempotence — failure semantics", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("propagates a throwing handler (so the webhook can be retried)", async () => {
    const boom = async () => {
      throw new Error("handler blew up");
    };
    await expect(
      t.run(async (ctx) => {
        await withIdempotence(ctx, STRIPE, "evt_boom", boom);
      }),
    ).rejects.toThrow(/blew up/);
  });

  it("exposes its public contract through the module index", async () => {
    const mod = await import("./index");
    expect(typeof mod.withIdempotence).toBe("function");
  });
});
