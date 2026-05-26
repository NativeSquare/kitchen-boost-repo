import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";
import { uberSignatureHex } from "./webhooks";

// convex-test needs the function modules; array-negation glob form is required.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/delivery/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.6-C — per-tenant Uber Direct webhook (`…/webhooks/uber/<tenantId>`), written
 * BEFORE the implementation (TDD red). The httpAction verifies the Uber
 * `x-uber-signature` HMAC on the RAW body (POC #1) BEFORE any parse, resolves the
 * tenant from the path (POC #5 `pathPrefix`), dispatches the event through the
 * pure `mapWebhookEvent`, and applies it `withIdempotence(ctx, "uber_direct",
 * eventId, …)` so a redelivered `(uber_direct, eventId)` runs exactly once. The
 * delivery row is patched (status / courier / incident) through the tenancy seam.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const CREDS = {
  clientId: "kb-client-id",
  clientSecret: "sk_live_uber_secret_777",
  customerId: "cus_uber_A",
  webhookSigningKey: "whsec_uber_signing",
};

/** Seed a delivery row already carrying the Uber delivery id (course created). */
async function seedDeliveryWithUberId(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  uberDeliveryId: string,
): Promise<Id<"orders">> {
  return t.run(async (ctx) => {
    const now = Date.now();
    const userId = await ctx.db.insert("users", {
      email: "eater@x.fr",
      role: "customer",
    });
    const customerId = await ctx.db.insert("customers", {
      userId,
      createdAt: now,
    });
    const orderId = await ctx.db.insert("orders", {
      tenantId,
      customerId,
      status: "nouvelle",
      mode: "delivery",
      source: "direct",
      createdAt: now,
      paidAt: now,
    });
    await ctx.db.insert("deliveries", {
      tenantId,
      orderId,
      mode: "delivery",
      status: "pending",
      uberDeliveryId,
      createdAt: now,
      updatedAt: now,
    });
    return orderId;
  });
}

async function readDeliveryByUberId(
  t: ReturnType<typeof convexTest>,
  uberDeliveryId: string,
) {
  return t.run(async (ctx) =>
    ctx.db
      .query("deliveries")
      .withIndex("by_uber_delivery_id", (q) =>
        q.eq("uberDeliveryId", uberDeliveryId),
      )
      .unique(),
  );
}

describe("2.6-C uberSignatureHex — HMAC-SHA256 on the raw body (POC #1)", () => {
  it("is deterministic for a (key, raw body) pair", async () => {
    const a = await uberSignatureHex("k", '{"a":1}');
    const b = await uberSignatureHex("k", '{"a":1}');
    expect(a).toBe(b);
    expect(a).not.toBe(await uberSignatureHex("k", '{"a":2}'));
  });
});

describe("2.6-C uber webhook httpAction — signature + tenant routing + idempotence", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let orderId: Id<"orders">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });
    orderId = await seedDeliveryWithUberId(
      t,
      seed.tenantA.tenantId,
      "del_uber_1",
    );
  });

  /** POST the webhook with a correctly-signed body to tenant A's path. */
  async function postSigned(body: unknown, sign = true): Promise<Response> {
    const raw = JSON.stringify(body);
    const sig = sign
      ? await uberSignatureHex(CREDS.webhookSigningKey, raw)
      : "deadbeef";
    return t.fetch(`/webhooks/uber/${seed.tenantA.tenantId}`, {
      method: "POST",
      headers: { "x-uber-signature": sig, "Content-Type": "application/json" },
      body: raw,
    });
  }

  it("applies a delivered event → status delivered (200)", async () => {
    const res = await postSigned({
      event_id: "evt_1",
      kind: "event.delivery_status",
      delivery_id: "del_uber_1",
      status: "delivered",
      data: { delivery_id: "del_uber_1", status: "delivered" },
    });
    expect(res.status).toBe(200);
    const row = await readDeliveryByUberId(t, "del_uber_1");
    expect(row?.status).toBe("delivered");
  });

  it("rejects an invalid signature (no parse, no mutation) with 400", async () => {
    const res = await postSigned(
      {
        event_id: "evt_bad",
        kind: "event.delivery_status",
        delivery_id: "del_uber_1",
        status: "delivered",
      },
      false,
    );
    expect(res.status).toBe(400);
    const row = await readDeliveryByUberId(t, "del_uber_1");
    expect(row?.status).toBe("pending"); // untouched
  });

  it("an unknown tenantId in the path is rejected (404)", async () => {
    const raw = JSON.stringify({ event_id: "e", status: "delivered" });
    const res = await t.fetch("/webhooks/uber/tenant_does_not_exist", {
      method: "POST",
      headers: { "x-uber-signature": "x", "Content-Type": "application/json" },
      body: raw,
    });
    expect(res.status).toBe(404);
  });

  it("is idempotent: the same (uber_direct, eventId) applied twice patches once", async () => {
    const event = {
      event_id: "evt_dup",
      kind: "event.delivery_status",
      delivery_id: "del_uber_1",
      status: "canceled",
      data: { delivery_id: "del_uber_1", status: "canceled" },
    };
    await postSigned(event);
    await postSigned(event);

    const ledger = await t.run(async (ctx) =>
      ctx.db
        .query("processedWebhookEvents")
        .withIndex("by_provider_event", (q) =>
          q.eq("provider", "uber_direct").eq("externalId", "evt_dup"),
        )
        .collect(),
    );
    expect(ledger).toHaveLength(1);
    const row = await readDeliveryByUberId(t, "del_uber_1");
    expect(row?.status).toBe("canceled");
    expect(row?.incidentType).toBe("incident_after_pickup");
  });

  it("a courier_update (Cas B) updates the courier without an incident", async () => {
    await postSigned({
      event_id: "evt_courier",
      kind: "event.courier_update",
      delivery_id: "del_uber_1",
      data: {
        delivery_id: "del_uber_1",
        courier: { name: "Yacine", phone_number: "+33611111111" },
      },
    });
    const row = await readDeliveryByUberId(t, "del_uber_1");
    expect(row?.courierName).toBe("Yacine");
    expect(row?.incidentType).toBeUndefined();
    expect(row?.status).toBe("pending"); // no transition on a courier_update
  });
});

describe("2.6-C uber webhook — cross-tenant isolation (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });
    // Tenant A owns delivery del_uber_A.
    await seedDeliveryWithUberId(t, seed.tenantA.tenantId, "del_uber_A");
  });

  it("an event signed with tenant B's path can NOT patch tenant A's delivery", async () => {
    // Tenant B has its own (different) signing key.
    await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantB.tenantId,
        credentials: {
          ...CREDS,
          customerId: "cus_uber_B",
          webhookSigningKey: "whsec_B",
        },
      });

    const raw = JSON.stringify({
      event_id: "evt_x",
      kind: "event.delivery_status",
      delivery_id: "del_uber_A", // A's delivery, but routed via B's path + B's key
      status: "canceled",
      data: { delivery_id: "del_uber_A", status: "canceled" },
    });
    const sig = await uberSignatureHex("whsec_B", raw);
    const res = await t.fetch(`/webhooks/uber/${seed.tenantB.tenantId}`, {
      method: "POST",
      headers: { "x-uber-signature": sig, "Content-Type": "application/json" },
      body: raw,
    });
    // Accepted+verified for tenant B, but A's row is NOT touched (tenant-scoped
    // resolution: B cannot reach A's delivery).
    expect([200, 404]).toContain(res.status);
    const row = await readDeliveryByUberId(t, "del_uber_A");
    expect(row?.status).toBe("pending"); // untouched — still A's, still pending
    expect(row?.incidentType).toBeUndefined();
  });

  it("the internal apply mutation refuses to patch a delivery the tenant does not own", async () => {
    // Direct probe of the system-side mutation: resolving del_uber_A under tenant
    // B must NOT patch it (cross-tenant fuzz of the webhook write path).
    const out = await t.mutation(
      internal.lib.delivery.webhooks.applyUberWebhookEvent,
      {
        tenantId: seed.tenantB.tenantId,
        eventId: "evt_fuzz",
        event: {
          kind: "event.delivery_status",
          delivery_id: "del_uber_A",
          status: "canceled",
          data: { delivery_id: "del_uber_A", status: "canceled" },
        },
      },
    );
    expect(out.applied).toBe(false); // foreign delivery → no-op
    const row = await readDeliveryByUberId(t, "del_uber_A");
    expect(row?.status).toBe("pending");
  });
});
