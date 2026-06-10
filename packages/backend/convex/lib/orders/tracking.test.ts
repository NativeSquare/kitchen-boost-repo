import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

// convex-test needs the function modules; the array-negation glob form is required
// (extglob `!(*.test)` returns ZERO modules — project memory). Normalise every key
// relative to the convex root so convex-test's findModulesRoot has ONE prefix.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/orders/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * PWA-S8 (#459) — `getOrderTracking` — PUBLIC tracking projection consumed by
 * the customer-facing `/c/[orderId]` page (PRD 10 §11, US 50-55).
 *
 * The tracking URL is INTENTIONALLY UN-AUTH-GATED (US 55, decisions-log Q7):
 * a customer can SHARE it (SMS / push deep-link) so a fresh device with no
 * Convex Auth cookie still resolves the page. The unguessable Convex id of the
 * order IS the access token — the same model as a Stripe receipt URL.
 *
 * Isolation discipline (ADR 0010) is preserved by REQUIRING the tenant arg
 * (resolved by the PWA edge middleware from the host → `__Host-kb_tenant`)
 * and re-checking the order belongs to that tenantId via the sanctioned
 * `getTenantOrderWithDetail` seam — a foreign `(tenantId, orderId)` returns
 * `null` indistinguishably from a missing order (no cross-tenant existence
 * oracle).
 *
 * The projection is MINIMAL on purpose : the tracking UI only needs the
 * status / mode / items / address / total / delivery ETA + incident type.
 * NO customerId, NO restaurantNote (kitchen-side only), NO Stripe ids — the
 * URL is shareable and the surface must not leak the per-order MOAT (ADR
 * 0010).
 *
 * The cross-tenant fuzz harness `runCrossTenantFuzz` is auth-actor-shaped
 * (it asserts a THROW), so for this PUBLIC query we explicitly assert the
 * NULL-on-foreign-tenant guarantee (the structural equivalent for a public
 * read — the harness's contract doesn't fit).
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** A customer fiche (GLOBAL `customers` table) — same shape as orders.test. */
async function seedCustomer(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<Id<"customers">> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    return ctx.db.insert("customers", {
      userId,
      email,
      createdAt: Date.now(),
    });
  });
}

/** Seed an order directly on the tenant (no payment / kitchen workflow). */
async function seedOrder(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
  opts: {
    mode: "delivery" | "pickup";
    status:
      | "en attente de paiement"
      | "nouvelle"
      | "en préparation"
      | "prête"
      | "remise"
      | "livrée"
      | "collectée"
      | "refusée";
    address?: string;
    pricingSnapshotTotal?: number;
  },
): Promise<Id<"orders">> {
  return t.run(async (ctx) => {
    const orderId = await ctx.db.insert("orders", {
      tenantId,
      customerId,
      status: opts.status,
      mode: opts.mode,
      source: "direct",
      address: opts.address,
      pricingSnapshot:
        opts.pricingSnapshotTotal === undefined
          ? undefined
          : {
              subtotal: opts.pricingSnapshotTotal - 295,
              deliveryFee: 295,
              total: opts.pricingSnapshotTotal,
            },
      createdAt: Date.now(),
    });
    await ctx.db.insert("orderItems", {
      tenantId,
      orderId,
      itemName: "Smash Double",
      unitPrice: 1290,
      quantity: 1,
      modifiers: [{ groupName: "Sauce", optionName: "Ketchup", priceDelta: 0 }],
      allergens: ["gluten", "lait"],
    });
    return orderId;
  });
}

/** Seed a delivery row tied to the order (the Uber-side / C&C-side lifecycle). */
async function seedDelivery(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  orderId: Id<"orders">,
  opts: {
    mode: "delivery" | "click_collect";
    status:
      | "pending"
      | "pickup"
      | "pickup_complete"
      | "dropoff"
      | "delivered"
      | "canceled"
      | "returned"
      | "failed";
    pickupEta?: number;
    dropoffEta?: number;
    incidentType?:
      | "refused_post_payment"
      | "incident_after_pickup"
      | "customer_absent";
  },
): Promise<void> {
  await t.run(async (ctx) => {
    await ctx.db.insert("deliveries", {
      tenantId,
      orderId,
      mode: opts.mode,
      status: opts.status,
      pickupEta: opts.pickupEta,
      dropoffEta: opts.dropoffEta,
      incidentType: opts.incidentType,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  });
}

describe("PWA-S8 (#459) — getOrderTracking (public, shareable URL)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerA: Id<"customers">;
  let customerB: Id<"customers">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    customerA = await seedCustomer(t, "eater-a@x.fr");
    customerB = await seedCustomer(t, "eater-b@x.fr");
  });

  it("returns the minimal projection of a tenant's order WITHOUT any auth (shareable URL — US 55)", async () => {
    const orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, {
      mode: "delivery",
      status: "nouvelle",
      address: "12 rue de Paris, 91000 Évry",
      pricingSnapshotTotal: 1585,
    });

    // ANONYMOUS caller — no `withIdentity` — mirrors the shared URL opened on
    // a fresh device. The PWA edge middleware resolves the tenant from the
    // host cookie and passes it here as a plain arg.
    const tracking = await t.query(api.lib.orders.tracking.getOrderTracking, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });

    expect(tracking).not.toBeNull();
    expect(tracking?.status).toBe("nouvelle");
    expect(tracking?.mode).toBe("delivery");
    expect(tracking?.address).toBe("12 rue de Paris, 91000 Évry");
    expect(tracking?.items).toHaveLength(1);
    expect(tracking?.items[0].itemName).toBe("Smash Double");
    expect(tracking?.items[0].quantity).toBe(1);
    expect(tracking?.items[0].modifiers[0].optionName).toBe("Ketchup");
    expect(tracking?.totalCentimes).toBe(1585);
  });

  it("returns null when the order does NOT belong to the passed tenant (cross-tenant fuzz — no leak, no oracle)", async () => {
    // Order belongs to tenant A.
    const orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, {
      mode: "delivery",
      status: "nouvelle",
      address: "12 rue de Paris, 91000 Évry",
    });

    // Anonymous caller passes tenant B's id — same orderId. The seam re-checks
    // ownership and returns null — no row exposed, no « FORBIDDEN » oracle.
    const leak = await t.query(api.lib.orders.tracking.getOrderTracking, {
      tenantId: seed.tenantB.tenantId,
      orderId,
    });
    expect(leak).toBeNull();
  });

  it("returns null for a non-existent orderId (no probing of valid ids)", async () => {
    // Create one order then DELETE it through the seam so we have a stale id.
    const orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, {
      mode: "delivery",
      status: "nouvelle",
    });
    await t.run(async (ctx) => {
      await ctx.db.delete(orderId);
    });
    const got = await t.query(api.lib.orders.tracking.getOrderTracking, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(got).toBeNull();
  });

  it("throws Forbidden when the tenantId itself does not resolve (publicTenantQuery guarantee)", async () => {
    // Insert + delete a tenant to fabricate an unknown tenant id.
    const ghostTenantId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        slug: "ghost",
        name: "Ghost",
        siret: "00000000000000",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    const orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, {
      mode: "delivery",
      status: "nouvelle",
    });
    await expect(
      t.query(api.lib.orders.tracking.getOrderTracking, {
        tenantId: ghostTenantId,
        orderId,
      }),
    ).rejects.toThrow(/Forbidden/);
  });

  it("joins the delivery row (status + pickupEta + dropoffEta) for delivery mode", async () => {
    const orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, {
      mode: "delivery",
      status: "prête",
      address: "12 rue de Paris",
    });
    await seedDelivery(t, seed.tenantA.tenantId, orderId, {
      mode: "delivery",
      status: "pickup_complete",
      pickupEta: 1_700_000_000_000,
      dropoffEta: 1_700_000_900_000,
    });

    const tracking = await t.query(api.lib.orders.tracking.getOrderTracking, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(tracking?.delivery).not.toBeNull();
    expect(tracking?.delivery?.status).toBe("pickup_complete");
    expect(tracking?.delivery?.pickupEta).toBe(1_700_000_000_000);
    expect(tracking?.delivery?.dropoffEta).toBe(1_700_000_900_000);
    expect(tracking?.delivery?.incidentType).toBeUndefined();
  });

  it("surfaces `incidentType` so the client renders the « Incident livraison » card (US 54)", async () => {
    const orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, {
      mode: "delivery",
      status: "refusée",
    });
    await seedDelivery(t, seed.tenantA.tenantId, orderId, {
      mode: "delivery",
      status: "failed",
      incidentType: "incident_after_pickup",
    });

    const tracking = await t.query(api.lib.orders.tracking.getOrderTracking, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(tracking?.delivery?.incidentType).toBe("incident_after_pickup");
  });

  it("returns `delivery: null` for a C&C order that has no delivery row yet", async () => {
    const orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, {
      mode: "pickup",
      status: "nouvelle",
    });
    const tracking = await t.query(api.lib.orders.tracking.getOrderTracking, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(tracking?.delivery).toBeNull();
  });

  it("never surfaces the customerId (MOAT — the URL is shareable, must not expose the per-order link to a customer fiche)", async () => {
    const orderId = await seedOrder(t, seed.tenantA.tenantId, customerA, {
      mode: "delivery",
      status: "nouvelle",
    });
    const tracking = await t.query(api.lib.orders.tracking.getOrderTracking, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(tracking).not.toBeNull();
    // Defensive — the projection must not leak customerId / customerPhone /
    // restaurantNote (the « ne forward pas Uber » freeform kitchen note).
    expect(tracking).not.toHaveProperty("customerId");
    expect(tracking).not.toHaveProperty("customerPhone");
    expect(tracking).not.toHaveProperty("restaurantNote");
    // sanity: but DOES expose the items + address + total (the page renders them).
    expect(tracking).toHaveProperty("items");
    expect(tracking).toHaveProperty("address");
    expect(tracking).toHaveProperty("totalCentimes");
  });

  it("a foreign customer's order under the same tenant is still reachable (the URL is share-by-design — the unguessable id IS the token)", async () => {
    // Both customers order from tenant A — customer A's order id is the
    // sharing token. Customer B (or anyone else holding the link) reads it.
    // This is INTENTIONAL (decisions-log Q7) — the un-auth-gating IS the
    // feature. Pin it here so a future « tighten to self-scope » regression
    // surfaces against the PRD.
    const orderId = await seedOrder(t, seed.tenantA.tenantId, customerB, {
      mode: "delivery",
      status: "nouvelle",
    });
    const tracking = await t.query(api.lib.orders.tracking.getOrderTracking, {
      tenantId: seed.tenantA.tenantId,
      orderId,
    });
    expect(tracking).not.toBeNull();
    expect(tracking?.status).toBe("nouvelle");
  });
});
