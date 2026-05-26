import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; the array-negation glob form is required
// (extglob `!(*.test)` returns ZERO modules — project memory). This file lives in
// convex/lib/stripe/, so Vite emits keys relative to THIS dir; re-anchor every
// `./x` key at the convex root so convex-test's findModulesRoot has ONE common
// prefix (same intent as the payment / account / webhook / refund suites).
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (key.startsWith("./")) key = `../../lib/stripe/${key.slice(2)}`;
    else if (key.startsWith("../") && !key.startsWith("../../"))
      key = `../../lib/${key.slice(3)}`;
    return [key, loader];
  }),
);

/**
 * 2.5-E — Chargeback monitoring (PRD 30 §6 + Q30-Q6, payment CONTEXT
 * "Chargeback"). Written BEFORE the implementation (TDD red). The Stripe
 * `charge.dispute.created` webhook is monitoring ONLY: KB is NOT merchant of
 * record, so KB never relays evidence to Stripe, never stores evidence, and
 * ships NO KB Admin UI in V1 (V2/V3 = tooling). The single side effect is an
 * ops Slack alert with the recap Alex needs to ping the resto by WhatsApp:
 * ID cmd / montant / motif / deadline.
 *
 * Idempotence: the same `(stripe, eventId)` redelivered (Stripe at-least-once)
 * alerts ONCE — the internal mutation wraps its work in
 * `withIdempotence(ctx, "stripe", eventId, …)` and reports back whether the
 * alert should fire, so the httpAction posts to Slack only on first delivery.
 *
 * Cross-tenant isolation is STRUCTURAL: the handler is system-side and takes NO
 * user-supplied tenant id — the only lookup key is the Stripe-supplied
 * `paymentIntentId`, resolved through the sanctioned `lib/tenancy` seam, so an
 * event can only ever surface the tenant that actually owns that payment (a
 * foreign / unknown intent is a clean no-op, asserted below).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const PRICING = { subtotal: 1290, deliveryFee: 295, total: 1585 };

/** Seed a paid order + its succeeded `payments` row for a tenant. */
async function seedPaidOrder(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  paymentIntentId: string,
): Promise<{ orderId: Id<"orders">; paymentId: Id<"payments"> }> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: `eater-${paymentIntentId}@x.fr`,
      role: "customer",
    });
    const customerId = await ctx.db.insert("customers", {
      userId,
      email: `eater-${paymentIntentId}@x.fr`,
      createdAt: now,
    });
    const orderId = await ctx.db.insert("orders", {
      tenantId,
      customerId,
      status: "nouvelle",
      mode: "delivery",
      source: "direct",
      address: "12 rue de Paris, 91000 Évry",
      pricingSnapshot: PRICING,
      createdAt: now,
      paidAt: now,
    });
    const paymentId = await ctx.db.insert("payments", {
      tenantId,
      orderId,
      paymentIntentId,
      status: "succeeded",
      applicationFeeAmountHt: 200,
      amountTotal: PRICING.total,
      pricingSnapshot: PRICING,
      failedAttempts: 0,
      createdAt: now,
      updatedAt: now,
    });
    return { orderId, paymentId };
  });
}

async function readAudit(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
) {
  return t.run((ctx) =>
    ctx.db
      .query("auditLog")
      .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
      .collect(),
  );
}

async function readLedger(t: ReturnType<typeof convexTest>, eventId: string) {
  return t.run((ctx) =>
    ctx.db
      .query("processedWebhookEvents")
      .withIndex("by_provider_event", (q) =>
        q.eq("provider", "stripe").eq("externalId", eventId),
      )
      .collect(),
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// applyDisputeCreated — idempotent monitoring, returns the Slack recap
// ─────────────────────────────────────────────────────────────────────────────

describe("2.5-E applyDisputeCreated — monitoring only, returns the ops recap", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let orderId: Id<"orders">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    ({ orderId } = await seedPaidOrder(t, seed.tenantA.tenantId, "pi_dispute"));
  });

  it("a dispute resolves the owning tenant + order and reports the recap to alert", async () => {
    const out = await t.mutation(
      internal.lib.stripe.dispute.applyDisputeCreated,
      {
        eventId: "evt_dp_1",
        paymentIntentId: "pi_dispute",
        amount: 1585,
        currency: "eur",
        reason: "fraudulent",
        dueBy: 1_700_000_000,
      },
    );
    expect(out.alert).toBe(true);
    // The recap Alex needs to ping the resto: ID cmd, montant, motif, deadline.
    expect(out.tenantId).toBe(seed.tenantA.tenantId);
    expect(out.orderId).toBe(orderId);
    expect(out.amount).toBe(1585);
    expect(out.reason).toBe("fraudulent");
    expect(out.dueBy).toBe(1_700_000_000);
  });

  it("audits the dispute (system-side) on the owning tenant", async () => {
    await t.mutation(internal.lib.stripe.dispute.applyDisputeCreated, {
      eventId: "evt_dp_audit",
      paymentIntentId: "pi_dispute",
      amount: 1585,
      currency: "eur",
      reason: "product_not_received",
      dueBy: 1_700_000_000,
    });
    const audit = await readAudit(t, seed.tenantA.tenantId);
    expect(audit.some((a) => a.action.includes("dispute"))).toBe(true);
    expect(audit.every((a) => a.actorRole === "system")).toBe(true);
  });

  it("does NOT touch the payment row or store any evidence (monitoring only)", async () => {
    const before = await t.run((ctx) =>
      ctx.db
        .query("payments")
        .withIndex("by_payment_intent", (q) =>
          q.eq("paymentIntentId", "pi_dispute"),
        )
        .unique(),
    );
    await t.mutation(internal.lib.stripe.dispute.applyDisputeCreated, {
      eventId: "evt_dp_noop",
      paymentIntentId: "pi_dispute",
      amount: 1585,
      currency: "eur",
      reason: "fraudulent",
      dueBy: 1_700_000_000,
    });
    const after = await t.run((ctx) =>
      ctx.db
        .query("payments")
        .withIndex("by_payment_intent", (q) =>
          q.eq("paymentIntentId", "pi_dispute"),
        )
        .unique(),
    );
    // The payment lifecycle is untouched — KB does not intervene on a dispute.
    expect(after?.status).toBe(before?.status);
    expect(after?.status).toBe("succeeded");
  });

  it("an UNKNOWN paymentIntent is a clean no-op (no alert, no audit)", async () => {
    const out = await t.mutation(
      internal.lib.stripe.dispute.applyDisputeCreated,
      {
        eventId: "evt_dp_unknown",
        paymentIntentId: "pi_nope",
        amount: 999,
        currency: "eur",
        reason: "fraudulent",
        dueBy: 1_700_000_000,
      },
    );
    expect(out.alert).toBe(false);
    expect(await readAudit(t, seed.tenantA.tenantId)).toHaveLength(0);
  });
});

describe("2.5-E applyDisputeCreated — idempotence per (stripe, eventId)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await seedPaidOrder(t, seed.tenantA.tenantId, "pi_dispute");
  });

  it("a redelivered event alerts and audits exactly ONCE", async () => {
    const call = () =>
      t.mutation(internal.lib.stripe.dispute.applyDisputeCreated, {
        eventId: "evt_dp_dup",
        paymentIntentId: "pi_dispute",
        amount: 1585,
        currency: "eur",
        reason: "fraudulent",
        dueBy: 1_700_000_000,
      });
    const first = await call();
    const second = await call();
    expect(first.alert).toBe(true);
    expect(second.alert).toBe(false); // redelivered → no second alert

    expect(await readLedger(t, "evt_dp_dup")).toHaveLength(1);
    // Exactly one audit row for the dispute.
    const audit = await readAudit(t, seed.tenantA.tenantId);
    expect(audit.filter((a) => a.action.includes("dispute"))).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cross-tenant isolation — STRUCTURAL: a dispute can only surface the owning
// tenant; tenant B is never reached, and a foreign / unknown intent is a no-op.
// (The sibling refund/webhook system-side mutations carry the same structural
// assertion — there is no actor-driven public surface to fuzz here, ADR 0010.)
// ─────────────────────────────────────────────────────────────────────────────

describe("2.5-E applyDisputeCreated — cross-tenant isolation (structural)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Tenant A owns the disputed payment; tenant B owns an unrelated one.
    await seedPaidOrder(t, seed.tenantA.tenantId, "pi_owned_by_A");
    await seedPaidOrder(t, seed.tenantB.tenantId, "pi_owned_by_B");
  });

  it("resolves ONLY the owning tenant — never surfaces another tenant", async () => {
    const out = await t.mutation(
      internal.lib.stripe.dispute.applyDisputeCreated,
      {
        eventId: "evt_dp_owner",
        paymentIntentId: "pi_owned_by_A",
        amount: 1585,
        currency: "eur",
        reason: "fraudulent",
        dueBy: 1_700_000_000,
      },
    );
    expect(out.alert).toBe(true);
    expect(out.tenantId).toBe(seed.tenantA.tenantId);
    expect(out.tenantId).not.toBe(seed.tenantB.tenantId);

    // The audit row landed on tenant A only — tenant B is untouched.
    expect(await readAudit(t, seed.tenantB.tenantId)).toHaveLength(0);
    expect(await readAudit(t, seed.tenantA.tenantId)).toHaveLength(1);
  });

  it("a paymentIntent of ANOTHER tenant surfaces THAT tenant, never a forged one", async () => {
    const out = await t.mutation(
      internal.lib.stripe.dispute.applyDisputeCreated,
      {
        eventId: "evt_dp_b",
        paymentIntentId: "pi_owned_by_B",
        amount: 700,
        currency: "eur",
        reason: "duplicate",
        dueBy: 1_700_000_001,
      },
    );
    // The handler trusts ONLY the Stripe-supplied intent id → resolves tenant B,
    // and there is no user-supplied tenant id to forge into tenant A.
    expect(out.tenantId).toBe(seed.tenantB.tenantId);
    expect(await readAudit(t, seed.tenantA.tenantId)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// httpAction routing — charge.dispute.created → verified, parsed, dispatched
// ─────────────────────────────────────────────────────────────────────────────

describe("2.5-E stripeWebhook — charge.dispute.created routed to monitoring + Slack", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const SECRET = "whsec_dispute_test";

  beforeEach(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    process.env.SLACK_OPS_WEBHOOK_URL = "https://hooks.slack.test/ops";
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await seedPaidOrder(t, seed.tenantA.tenantId, "pi_http_dispute");
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    delete process.env.SLACK_OPS_WEBHOOK_URL;
  });

  /** Build a valid Stripe-Signature header for `payload` against `SECRET`. */
  async function sign(payload: string): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1000);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${timestamp}.${payload}`),
    );
    const hex = [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return `t=${timestamp},v1=${hex}`;
  }

  it("a verified charge.dispute.created posts ONE ops Slack alert with the recap", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null));

    const payload = JSON.stringify({
      id: "evt_http_dp",
      type: "charge.dispute.created",
      data: {
        object: {
          payment_intent: "pi_http_dispute",
          amount: 1585,
          currency: "eur",
          reason: "fraudulent",
          evidence_details: { due_by: 1_700_000_000 },
        },
      },
    });
    const res = await t.fetch("/stripe-webhook", {
      method: "POST",
      headers: { "Stripe-Signature": await sign(payload) },
      body: payload,
    });
    expect(res.status).toBe(200);

    // Exactly one Slack POST, carrying the recap fields.
    const slackCalls = fetchSpy.mock.calls.filter(
      ([url]) => url === "https://hooks.slack.test/ops",
    );
    expect(slackCalls).toHaveLength(1);
    const body = String((slackCalls[0][1] as RequestInit).body);
    expect(body).toContain("1585");
    expect(body).toContain("fraudulent");
  });

  it("a redelivered dispute event posts the Slack alert only ONCE (idempotent)", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null));

    const payload = JSON.stringify({
      id: "evt_http_dp_dup",
      type: "charge.dispute.created",
      data: {
        object: {
          payment_intent: "pi_http_dispute",
          amount: 1585,
          currency: "eur",
          reason: "fraudulent",
          evidence_details: { due_by: 1_700_000_000 },
        },
      },
    });
    const headers = { "Stripe-Signature": await sign(payload) };
    await t.fetch("/stripe-webhook", {
      method: "POST",
      headers,
      body: payload,
    });
    await t.fetch("/stripe-webhook", {
      method: "POST",
      headers,
      body: payload,
    });

    const slackCalls = fetchSpy.mock.calls.filter(
      ([url]) => url === "https://hooks.slack.test/ops",
    );
    expect(slackCalls).toHaveLength(1);
  });

  it("a bad signature is rejected (400) — never parsed, never alerted", async () => {
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(null));
    const payload = JSON.stringify({
      id: "evt_bad",
      type: "charge.dispute.created",
      data: { object: { payment_intent: "pi_http_dispute" } },
    });
    const res = await t.fetch("/stripe-webhook", {
      method: "POST",
      headers: { "Stripe-Signature": "t=1,v1=deadbeef" },
      body: payload,
    });
    expect(res.status).toBe(400);
    const slackCalls = fetchSpy.mock.calls.filter(
      ([url]) => url === "https://hooks.slack.test/ops",
    );
    expect(slackCalls).toHaveLength(0);
  });
});
