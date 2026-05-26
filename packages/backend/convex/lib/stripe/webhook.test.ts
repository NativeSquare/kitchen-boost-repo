import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/stripe/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.5-A — Stripe `account.updated` → tenant `stripeStatus`, idempotently. Written
 * BEFORE the implementation (TDD red). The internal mutation resolves the tenant
 * by its `stripeAccountId` and maps the account to `pending`/`ready`/`disabled`
 * (a rejected KYC never → `ready`); a duplicate `(stripe, eventId)` updates it
 * only once. An event for an unknown account is a clean no-op.
 *
 * Cross-tenant isolation here is STRUCTURAL: the webhook is system-side and takes
 * NO user-supplied tenant id — the only lookup key is the Stripe-supplied
 * `acct_xxx`, resolved through the sanctioned tenancy seam, so an event can only
 * touch the tenant that actually owns that account (asserted below). The
 * exported ROOT surface (`account.ts`) carries the actor-driven cross-tenant fuzz.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const ACCT_A = "acct_tenantA";
const READY_ACCOUNT = {
  charges_enabled: true,
  payouts_enabled: true,
  requirements: { disabled_reason: null },
};
const PENDING_ACCOUNT = {
  charges_enabled: false,
  payouts_enabled: false,
};
const REJECTED_ACCOUNT = {
  charges_enabled: true,
  payouts_enabled: true,
  requirements: { disabled_reason: "rejected.fraud" },
};

async function stampAccountId(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  acct: string,
) {
  await t.run(async (ctx) => {
    await ctx.db.patch(tenantId, {
      stripeAccountId: acct,
      stripeStatus: "pending",
    });
  });
}

async function readStatus(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
) {
  return t.run(async (ctx) => (await ctx.db.get(tenantId))?.stripeStatus);
}

describe("2.5-A applyAccountUpdated — maps + writes the tenant Stripe status", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await stampAccountId(t, seed.tenantA.tenantId, ACCT_A);
  });

  it("a verified account.updated moves the matching tenant to ready", async () => {
    const out = await t.mutation(
      internal.lib.stripe.webhook.applyAccountUpdated,
      { eventId: "evt_ready", accountId: ACCT_A, account: READY_ACCOUNT },
    );
    expect(out.applied).toBe(true);
    expect(out.status).toBe("ready");
    expect(out.tenantId).toBe(seed.tenantA.tenantId);
    expect(await readStatus(t, seed.tenantA.tenantId)).toBe("ready");
  });

  it("a rejected KYC moves the tenant to disabled, never ready", async () => {
    const out = await t.mutation(
      internal.lib.stripe.webhook.applyAccountUpdated,
      { eventId: "evt_rej", accountId: ACCT_A, account: REJECTED_ACCOUNT },
    );
    expect(out.status).toBe("disabled");
    expect(await readStatus(t, seed.tenantA.tenantId)).toBe("disabled");
  });

  it("an account still onboarding maps to pending", async () => {
    const out = await t.mutation(
      internal.lib.stripe.webhook.applyAccountUpdated,
      { eventId: "evt_pend", accountId: ACCT_A, account: PENDING_ACCOUNT },
    );
    expect(out.status).toBe("pending");
    expect(out.applied).toBe(true);
  });

  it("an event for an UNKNOWN account is a clean no-op (no write)", async () => {
    const out = await t.mutation(
      internal.lib.stripe.webhook.applyAccountUpdated,
      {
        eventId: "evt_unknown",
        accountId: "acct_nope",
        account: READY_ACCOUNT,
      },
    );
    expect(out.applied).toBe(false);
    // tenant A untouched (still the seeded pending).
    expect(await readStatus(t, seed.tenantA.tenantId)).toBe("pending");
  });

  it("only touches the OWNING tenant — tenant B is never affected", async () => {
    await stampAccountId(t, seed.tenantB.tenantId, "acct_tenantB");
    await t.mutation(internal.lib.stripe.webhook.applyAccountUpdated, {
      eventId: "evt_owner",
      accountId: ACCT_A,
      account: READY_ACCOUNT,
    });
    expect(await readStatus(t, seed.tenantA.tenantId)).toBe("ready");
    expect(await readStatus(t, seed.tenantB.tenantId)).toBe("pending");
  });
});

describe("2.5-A applyAccountUpdated — idempotence per (stripe, eventId)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await stampAccountId(t, seed.tenantA.tenantId, ACCT_A);
  });

  it("a duplicate delivery of the SAME event applies the write only once", async () => {
    const first = await t.mutation(
      internal.lib.stripe.webhook.applyAccountUpdated,
      { eventId: "evt_dup", accountId: ACCT_A, account: READY_ACCOUNT },
    );
    expect(first.applied).toBe(true);
    expect(await readStatus(t, seed.tenantA.tenantId)).toBe("ready");

    // Same eventId redelivered — even with a DIFFERENT body, the idempotence
    // guard skips the handler entirely (no re-write, applied === false).
    const second = await t.mutation(
      internal.lib.stripe.webhook.applyAccountUpdated,
      { eventId: "evt_dup", accountId: ACCT_A, account: REJECTED_ACCOUNT },
    );
    expect(second.applied).toBe(false);
    expect(await readStatus(t, seed.tenantA.tenantId)).toBe("ready");

    // Exactly one ledger row for (stripe, evt_dup).
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_provider_event", (q) =>
          q.eq("provider", "stripe").eq("externalId", "evt_dup"),
        )
        .collect(),
    );
    expect(rows.length).toBe(1);
  });

  it("two DISTINCT events both apply", async () => {
    await t.mutation(internal.lib.stripe.webhook.applyAccountUpdated, {
      eventId: "evt_x",
      accountId: ACCT_A,
      account: PENDING_ACCOUNT,
    });
    await t.mutation(internal.lib.stripe.webhook.applyAccountUpdated, {
      eventId: "evt_y",
      accountId: ACCT_A,
      account: READY_ACCOUNT,
    });
    expect(await readStatus(t, seed.tenantA.tenantId)).toBe("ready");
  });
});
