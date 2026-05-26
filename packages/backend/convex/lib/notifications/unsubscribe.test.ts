import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import { marketingEligible } from "../customer";
import schema from "../../schema";

/**
 * 2.7-D — `unsubscribe(sourcePushId)`, the global marketing opt-out (PRD 80 §5 /
 * ADR 0005), written BEFORE the module (TDD red).
 *
 * One self-scoped tap exits the customer from ALL marketing (tenant +
 * cross-tenant): it stamps `marketingOptOutDate`, so `marketingEligible` becomes
 * false everywhere until a later checkout re-consents. TRANSACTIONAL stays intact
 * (it never reads `marketingEligible`). Self-scoped: the caller's OWN fiche only.
 */

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (path.startsWith("./")) {
      key = `../../lib/notifications/${path.slice(2)}`;
    } else if (path.startsWith("../") && !path.startsWith("../../")) {
      key = `../../lib/${path.slice(3)}`;
    }
    return [key, loader];
  }),
);

const DAY = 24 * 60 * 60 * 1000;

describe("2.7-D unsubscribe — global marketing opt-out (ADR 0005)", () => {
  let t: ReturnType<typeof convexTest>;
  let tenantId: Id<"tenants">;
  let customerUserId: Id<"users">;
  let customerId: Id<"customers">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    const seeded = await t.run(async (ctx) => {
      const tid = await ctx.db.insert("tenants", {
        slug: "buns-bao",
        name: "Buns & Bao",
        siret: "123",
        status: "active",
        createdAt: Date.now(),
      });
      const uid = await ctx.db.insert("users", {
        email: "sophie@x.fr",
        role: "customer",
      });
      const cid = await ctx.db.insert("customers", {
        userId: uid,
        email: "sophie@x.fr",
        cgvAcceptedAt: Date.now() - 30 * DAY,
        createdAt: Date.now() - 60 * DAY,
      });
      return { tid, uid, cid };
    });
    tenantId = seeded.tid;
    customerUserId = seeded.uid;
    customerId = seeded.cid;
  });

  it("stamps marketingOptOutDate on the caller's OWN fiche (global exit)", async () => {
    // Eligible before unsubscribe (consent present, not opted out).
    const before = await t.run((ctx) => ctx.db.get(customerId));
    expect(marketingEligible(before!)).toBe(true);

    const asCustomer = t.withIdentity({ subject: customerUserId });
    await asCustomer.mutation(api.lib.notifications.unsubscribe.unsubscribe, {
      tenantId,
    });

    const after = await t.run((ctx) => ctx.db.get(customerId));
    expect(after?.marketingOptOutDate).toBeGreaterThan(0);
    // Now marketing-ineligible everywhere (no later checkout).
    expect(marketingEligible(after!)).toBe(false);
  });

  it("leaves transactional consent fields (cgvAcceptedAt) intact", async () => {
    const before = await t.run((ctx) => ctx.db.get(customerId));
    const asCustomer = t.withIdentity({ subject: customerUserId });
    await asCustomer.mutation(api.lib.notifications.unsubscribe.unsubscribe, {
      tenantId,
    });
    const after = await t.run((ctx) => ctx.db.get(customerId));
    // cgvAcceptedAt (consent / transactional basis) is untouched.
    expect(after?.cgvAcceptedAt).toBe(before?.cgvAcceptedAt);
  });

  it("writes an audit row recording the source push id", async () => {
    const asCustomer = t.withIdentity({ subject: customerUserId });
    await asCustomer.mutation(api.lib.notifications.unsubscribe.unsubscribe, {
      tenantId,
    });
    const audits = await t.run((ctx) =>
      ctx.db
        .query("auditLog")
        .filter((q) => q.eq(q.field("action"), "notifications.unsubscribe"))
        .collect(),
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].targetId).toBe(customerId);
  });

  it("refuses an unauthenticated caller (self-scoped)", async () => {
    await expect(
      t.mutation(api.lib.notifications.unsubscribe.unsubscribe, { tenantId }),
    ).rejects.toThrow(/Unauthenticated/);
  });
});
