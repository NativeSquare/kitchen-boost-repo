import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";

/**
 * 2.7-A — the Notifications schema layer (`notificationTemplates` +
 * `notificationEvents`), written BEFORE the tables exist (TDD red). 2.7-A is
 * SCHEMA-ONLY: no business query/mutation is exposed at this stage (acceptance
 * criteria), so there is nothing to cross-tenant-fuzz yet — the guardrail tested
 * here is that the DECLARATIVE shape + bounds + tenant indexing are right and
 * that the validators reject malformed rows. The functions that go through the
 * tenancy wrappers (and ship the fuzz suite) land in the later 2.7 slices.
 *
 * convex-test needs the function modules; array-negation glob form is required
 * (extglob returns ZERO modules — project memory). Keys are normalised to the
 * convex root (../../).
 */
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/notifications/${path.slice(2)}` : path,
    loader,
  ]),
);

/** A throwaway tenant + customer so the FK columns have real ids to point at. */
async function seedTenantAndCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<{
  tenantId: Id<"tenants">;
  customerId: Id<"customers">;
}> {
  return t.run(async (ctx) => {
    const tenantId = await ctx.db.insert("tenants", {
      slug: "buns-bao",
      name: "Buns & Bao",
      status: "active",
      createdAt: Date.now(),
    });
    const userId = await ctx.db.insert("users", {
      email: "eater@x.fr",
      role: "customer",
    });
    const customerId = await ctx.db.insert("customers", {
      userId,
      email: "eater@x.fr",
      createdAt: Date.now(),
    });
    return { tenantId, customerId };
  });
}

describe("2.7-A notificationTemplates — schema shape + declarative bounds", () => {
  let t: ReturnType<typeof convexTest>;
  beforeEach(() => {
    t = convexTest(schema, modules);
  });

  it("stores a pre-validated tenant campaign template with its declarative bounds", async () => {
    const id = await t.run(async (ctx) =>
      ctx.db.insert("notificationTemplates", {
        key: "promo_weekend",
        label: "Promo weekend",
        body: "Bonjour {prenom_client}, -{discount}% ce {jour} chez {nom_resto} !",
        variables: ["prenom_client", "discount", "jour", "nom_resto"],
        deepLinkTarget: "catalogue",
        scope: "tenant",
        maxDiscountPercent: 20,
        language: "fr",
        containsAlcohol: false,
        active: true,
        createdAt: Date.now(),
      }),
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.scope).toBe("tenant");
    expect(row?.language).toBe("fr");
    expect(row?.maxDiscountPercent).toBe(20);
    expect(row?.containsAlcohol).toBe(false);
  });

  it("stores a cross-tenant (KB root) template", async () => {
    const id = await t.run(async (ctx) =>
      ctx.db.insert("notificationTemplates", {
        key: "reseau_nouveau_resto",
        label: "Nouveau resto réseau",
        body: "Nouveau resto à 5 min de chez toi, {prenom_client} !",
        variables: ["prenom_client"],
        deepLinkTarget: "catalogue",
        scope: "cross_tenant",
        maxDiscountPercent: 0,
        language: "fr",
        containsAlcohol: false,
        active: true,
        createdAt: Date.now(),
      }),
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.scope).toBe("cross_tenant");
  });

  it("rejects an unknown scope value (closed union)", async () => {
    await expect(
      t.run(async (ctx) =>
        // @ts-expect-error — invalid scope, the validator must reject it
        ctx.db.insert("notificationTemplates", {
          key: "x",
          label: "x",
          body: "x",
          variables: [],
          deepLinkTarget: "catalogue",
          scope: "global",
          maxDiscountPercent: 0,
          language: "fr",
          containsAlcohol: false,
          active: true,
          createdAt: Date.now(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects a non-fr language (closed union, FR-only V1)", async () => {
    await expect(
      t.run(async (ctx) =>
        // @ts-expect-error — only "fr" is a valid language V1
        ctx.db.insert("notificationTemplates", {
          key: "x",
          label: "x",
          body: "x",
          variables: [],
          deepLinkTarget: "catalogue",
          scope: "tenant",
          maxDiscountPercent: 0,
          language: "en",
          containsAlcohol: false,
          active: true,
          createdAt: Date.now(),
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("2.7-A notificationEvents — send journal, tenant + customer indexed", () => {
  let t: ReturnType<typeof convexTest>;
  let tenantId: Id<"tenants">;
  let customerId: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    const seed = await seedTenantAndCustomer(t);
    tenantId = seed.tenantId;
    customerId = seed.customerId;
  });

  it("journals a transactional send (trigger + category + effective channel + status)", async () => {
    const id = await t.run(async (ctx) =>
      ctx.db.insert("notificationEvents", {
        tenantId,
        customerId,
        kind: "transactional",
        transactionalTrigger: "order_paid",
        transactionalCategory: "archive",
        channel: "wallet_push",
        status: "sent",
        createdAt: Date.now(),
        sentAt: Date.now(),
      }),
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.kind).toBe("transactional");
    expect(row?.transactionalTrigger).toBe("order_paid");
    expect(row?.transactionalCategory).toBe("archive");
    expect(row?.channel).toBe("wallet_push");
    expect(row?.status).toBe("sent");
    // Referenced by id only — no nominative customer coordinate copied (MOAT).
    expect(row?.customerId).toBe(customerId);
  });

  it("journals a campaign send referencing a template + its scope", async () => {
    const templateId = await t.run(async (ctx) =>
      ctx.db.insert("notificationTemplates", {
        key: "promo_weekend",
        label: "Promo weekend",
        body: "Bonjour {prenom_client}",
        variables: ["prenom_client"],
        deepLinkTarget: "catalogue",
        scope: "tenant",
        maxDiscountPercent: 20,
        language: "fr",
        containsAlcohol: false,
        active: true,
        createdAt: Date.now(),
      }),
    );
    const id = await t.run(async (ctx) =>
      ctx.db.insert("notificationEvents", {
        tenantId,
        customerId,
        kind: "campaign",
        campaignScope: "tenant",
        templateId,
        channel: "web_push",
        status: "queued",
        createdAt: Date.now(),
      }),
    );
    const row = await t.run((ctx) => ctx.db.get(id));
    expect(row?.kind).toBe("campaign");
    expect(row?.campaignScope).toBe("tenant");
    expect(row?.templateId).toBe(templateId);
    expect(row?.status).toBe("queued");
  });

  it("is queryable by_tenant for the tenant scoping seam", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("notificationEvents", {
        tenantId,
        customerId,
        kind: "transactional",
        transactionalTrigger: "order_delivered",
        transactionalCategory: "temps_reel",
        channel: "web_push",
        status: "sent",
        createdAt: Date.now(),
      });
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("notificationEvents")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].transactionalTrigger).toBe("order_delivered");
  });

  it("is queryable by_customer (re-engagement history)", async () => {
    await t.run(async (ctx) => {
      await ctx.db.insert("notificationEvents", {
        tenantId,
        customerId,
        kind: "transactional",
        transactionalTrigger: "refund_issued",
        transactionalCategory: "archive",
        channel: "email",
        status: "delivered",
        createdAt: Date.now(),
      });
    });
    const rows = await t.run((ctx) =>
      ctx.db
        .query("notificationEvents")
        .withIndex("by_customer", (q) => q.eq("customerId", customerId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].channel).toBe("email");
  });

  it("rejects an unknown transactional trigger (closed taxonomy)", async () => {
    await expect(
      t.run(async (ctx) =>
        ctx.db.insert("notificationEvents", {
          tenantId,
          customerId,
          kind: "transactional",
          // @ts-expect-error — not one of the 8 documented V1 triggers
          transactionalTrigger: "order_cancelled_by_alien",
          transactionalCategory: "archive",
          channel: "email",
          status: "sent",
          createdAt: Date.now(),
        }),
      ),
    ).rejects.toThrow();
  });

  it("rejects an unknown channel (closed V1 channel set)", async () => {
    await expect(
      t.run(async (ctx) =>
        ctx.db.insert("notificationEvents", {
          tenantId,
          customerId,
          kind: "campaign",
          campaignScope: "tenant",
          // @ts-expect-error — carrier-pigeon is not a V1 channel
          channel: "carrier_pigeon",
          status: "sent",
          createdAt: Date.now(),
        }),
      ),
    ).rejects.toThrow();
  });
});
