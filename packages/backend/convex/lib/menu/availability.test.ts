import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, internal } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ServiceWindow } from "../../table/serviceHours";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";
import { itemsToReactivate, parisDayOrdinal } from "./availability";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/menu/, so Vite keys same-dir matches as "./x"; normalise every key
// to be relative to the convex root (../../). Same shape as items.test.ts.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/menu/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.2-D — Disponibilité item (toggle out-of-stock + auto-réactivation au
 * lendemain), written BEFORE the implementation (TDD red). PRD 10 §edge "Item out
 * of stock" ("Auto-réactivation au lendemain"), client-ordering CONTEXT "Item out
 * of stock" ("au lendemain à l'ouverture du resto selon Plage horaire de
 * service"), multi-tenant CONTEXT (`staff` may "toggle out of stock"), ADR 0010.
 *
 * Two surfaces:
 *  - `setItemAvailability` — a `tenantMutation` (kb_manager + staff) flipping an
 *    item's `available` and stamping / clearing `unavailableSince`.
 *  - the auto-reactivation — a PURE decision function (`itemsToReactivate`:
 *    windows + items + clock → ids to reactivate) tested deterministically on
 *    injected Europe/Paris clocks, plus the per-tenant reactivation the cron calls.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

// --- Europe/Paris fixed reference timestamps (UTC), chosen across DST ----------
//
// Mon 2026-07-13 12:00 Paris (CEST, UTC+2) = 10:00 UTC. Buns & Bao opens 11h30.
const MON_NOON_PARIS = Date.parse("2026-07-13T10:00:00Z");
// Tue 2026-07-14 12:00 Paris (after the Monday unavailability + Tuesday opening).
const TUE_NOON_PARIS = Date.parse("2026-07-14T10:00:00Z");
// Tue 2026-07-14 10:00 Paris — BEFORE the 11h30 opening (resto not open yet).
const TUE_EARLY_PARIS = Date.parse("2026-07-14T08:00:00Z");

// An every-day 11h30–22h30 window (690–1350), so "next day" always has an opening.
const ALLDAY_WINDOWS: ServiceWindow[] = [0, 1, 2, 3, 4, 5, 6].map(
  (dayOfWeek) => ({ dayOfWeek, startMinute: 690, endMinute: 1350 }),
);

describe("2.2-D parisDayOrdinal — UTC ms → Europe/Paris calendar-day number", () => {
  it("is the same ordinal for two instants on the same Paris day", () => {
    expect(parisDayOrdinal(MON_NOON_PARIS)).toBe(
      parisDayOrdinal(Date.parse("2026-07-13T20:00:00Z")), // 22:00 Paris, same day
    );
  });

  it("increments by 1 from one Paris day to the next", () => {
    expect(
      parisDayOrdinal(TUE_NOON_PARIS) - parisDayOrdinal(MON_NOON_PARIS),
    ).toBe(1);
  });

  it("rolls to the next Paris day across local midnight (UTC day differs)", () => {
    // 2026-07-13 23:30 UTC = 2026-07-14 01:30 Paris ⇒ Tuesday's ordinal.
    const lateMonUtc = Date.parse("2026-07-13T23:30:00Z");
    expect(parisDayOrdinal(lateMonUtc)).toBe(parisDayOrdinal(TUE_NOON_PARIS));
  });
});

describe("2.2-D itemsToReactivate — pure (windows + items + clock → ids)", () => {
  const mkItem = (
    over: Partial<{
      available: boolean;
      unavailableSince: number | undefined;
      _id: string;
    }> = {},
  ) => ({
    _id: (over._id ?? "i1") as Id<"menuItems">,
    available: over.available ?? false,
    unavailableSince:
      "unavailableSince" in over ? over.unavailableSince : MON_NOON_PARIS,
  });

  it("reactivates an item the day AFTER it went unavailable, once the resto has opened", () => {
    const ids = itemsToReactivate(ALLDAY_WINDOWS, [mkItem()], TUE_NOON_PARIS);
    expect(ids).toEqual(["i1"]);
  });

  it("does NOT reactivate on the SAME day it went unavailable", () => {
    // Marked unavailable Monday noon; still Monday evening (19:00 Paris).
    const monEvening = Date.parse("2026-07-13T17:00:00Z");
    expect(itemsToReactivate(ALLDAY_WINDOWS, [mkItem()], monEvening)).toEqual(
      [],
    );
  });

  it("WAITS until the next-day OPENING — a later day but before opening = not yet", () => {
    // Tuesday 10:00 Paris, opening is 11h30 ⇒ resto not open yet ⇒ keep closed.
    expect(
      itemsToReactivate(ALLDAY_WINDOWS, [mkItem()], TUE_EARLY_PARIS),
    ).toEqual([]);
  });

  it("skips a closed day and reactivates at the NEXT day that actually opens", () => {
    // Open Monday + Wednesday only; unavailable Monday. Tuesday has no opening, so
    // it must wait until Wednesday's opening (no invented same-day reactivation).
    const monWed: ServiceWindow[] = [
      { dayOfWeek: 1, startMinute: 690, endMinute: 1350 },
      { dayOfWeek: 3, startMinute: 690, endMinute: 1350 },
    ];
    // Tuesday noon — no Tuesday window ⇒ still closed.
    expect(itemsToReactivate(monWed, [mkItem()], TUE_NOON_PARIS)).toEqual([]);
    // Wednesday noon — Wednesday opens ⇒ reactivate.
    const wedNoon = Date.parse("2026-07-15T10:00:00Z");
    expect(itemsToReactivate(monWed, [mkItem()], wedNoon)).toEqual(["i1"]);
  });

  it("never touches an item that is already available", () => {
    const ids = itemsToReactivate(
      ALLDAY_WINDOWS,
      [mkItem({ available: true, unavailableSince: undefined })],
      TUE_NOON_PARIS,
    );
    expect(ids).toEqual([]);
  });

  it("ignores an unavailable item that has NO unavailableSince stamp", () => {
    const ids = itemsToReactivate(
      ALLDAY_WINDOWS,
      [mkItem({ available: false, unavailableSince: undefined })],
      TUE_NOON_PARIS,
    );
    expect(ids).toEqual([]);
  });

  it("never reactivates when the resto has NO service windows (always closed)", () => {
    expect(itemsToReactivate([], [mkItem()], TUE_NOON_PARIS)).toEqual([]);
  });

  it("returns only the items whose next-day opening has been reached (subset)", () => {
    const fresh = mkItem({ _id: "fresh", unavailableSince: TUE_EARLY_PARIS });
    const stale = mkItem({ _id: "stale", unavailableSince: MON_NOON_PARIS });
    // Tuesday noon: `stale` (Monday) qualifies; `fresh` (Tuesday) does not yet.
    expect(
      itemsToReactivate(ALLDAY_WINDOWS, [fresh, stale], TUE_NOON_PARIS),
    ).toEqual(["stale"]);
  });
});

// --- Convex surface: setItemAvailability -------------------------------------

const BB_WINDOWS = ALLDAY_WINDOWS;

async function makeItem(
  t: ReturnType<typeof convexTest>,
  seed: Seed,
): Promise<string> {
  const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
  const cat = await asMgr.mutation(api.lib.menu.categories.create, {
    tenantId: seed.tenantA.tenantId,
    name: "Smashs",
  });
  return asMgr.mutation(api.lib.menu.items.create, {
    tenantId: seed.tenantA.tenantId,
    categoryId: cat,
    name: "Smash Double",
    description: "",
    basePrice: 1290,
    allergens: [],
  });
}

describe("2.2-D setItemAvailability — kb_manager + staff toggle", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let itemId: string;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    itemId = await makeItem(t, seed);
  });

  it("marking unavailable stamps unavailableSince; reverting clears it", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    await asMgr.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });
    const after = await t.run(async (ctx) =>
      ctx.db.get(itemId as Id<"menuItems">),
    );
    expect(after?.available).toBe(false);
    expect(typeof after?.unavailableSince).toBe("number");

    await asMgr.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: true,
    });
    const reverted = await t.run(async (ctx) =>
      ctx.db.get(itemId as Id<"menuItems">),
    );
    expect(reverted?.available).toBe(true);
    expect(reverted?.unavailableSince).toBeUndefined();
  });

  it("a STAFF member CAN toggle out-of-stock (multi-tenant CONTEXT)", async () => {
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    await asStaff.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });
    const after = await t.run(async (ctx) =>
      ctx.db.get(itemId as Id<"menuItems">),
    );
    expect(after?.available).toBe(false);
  });

  it("refuses an itemId owned by another tenant (NOT_FOUND, no cross-tenant write)", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    // B's manager makes a B item, A's manager tries to toggle it.
    const bMgr = t.withIdentity({ subject: seed.tenantB.managerId });
    const bCat = await bMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    });
    const bItem = await bMgr.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: bCat,
      name: "B-item",
      description: "",
      basePrice: 100,
      allergens: [],
    });
    await expect(
      asMgr.mutation(api.lib.menu.availability.setItemAvailability, {
        tenantId: seed.tenantA.tenantId,
        itemId: bItem,
        available: false,
      }),
    ).rejects.toThrow();
  });
});

describe("2.2-D cross-tenant fuzz — setItemAvailability, 0 leak (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let itemAId: string;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    itemAId = await makeItem(t, seed);
  });

  it("rejects every unauthorized actor on tenant A (A-staff is authorized, excluded)", async () => {
    // NB: A-staff legitimately CAN toggle A's items, so it is NOT an attacker here
    // (including it would be a false leak). The attackers are foreign / detached /
    // unrelated identities.
    const actors: FuzzActor[] = [
      { label: "B-manager", subject: seed.tenantB.managerId },
      { label: "B-staff", subject: seed.tenantB.staffId },
      { label: "detached", subject: seed.detachedUserId },
      { label: "customer", subject: seed.customerId },
      { label: "anonymous", subject: null },
    ];
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.menu.availability.setItemAvailability],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors,
      extraArgs: { itemId: itemAId, available: false },
    });
    expect(pairs).toBe(5);
    expect(leaks).toEqual([]);
  });
});

// --- Auto-reactivation (per-tenant cron logic) -------------------------------

describe("2.2-D reactivation cron — per-tenant, tenant-isolated (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  /** Make an item, set hours, mark it unavailable at `unavailableSince`. */
  async function seedUnavailableItem(
    tenant: Seed["tenantA"],
    unavailableSince: number,
  ): Promise<string> {
    const asMgr = t.withIdentity({ subject: tenant.managerId });
    await asMgr.mutation(api.lib.menu.serviceHours.set, {
      tenantId: tenant.tenantId,
      windows: BB_WINDOWS,
    });
    const cat = await asMgr.mutation(api.lib.menu.categories.create, {
      tenantId: tenant.tenantId,
      name: "Cat",
    });
    const itemId = await asMgr.mutation(api.lib.menu.items.create, {
      tenantId: tenant.tenantId,
      categoryId: cat,
      name: "Item",
      description: "",
      basePrice: 100,
      allergens: [],
    });
    await t.run(async (ctx) =>
      ctx.db.patch(itemId as Id<"menuItems">, {
        available: false,
        unavailableSince,
      }),
    );
    return itemId;
  }

  it("reactivates a tenant's day-after item at its opening (injected clock)", async () => {
    const itemId = await seedUnavailableItem(seed.tenantA, MON_NOON_PARIS);
    await t.mutation(internal.crons.reactivateUnavailableItems, {
      now: TUE_NOON_PARIS,
    });
    const after = await t.run(async (ctx) =>
      ctx.db.get(itemId as Id<"menuItems">),
    );
    expect(after?.available).toBe(true);
    expect(after?.unavailableSince).toBeUndefined();
  });

  it("does NOT reactivate on the same day (clock still Monday)", async () => {
    const itemId = await seedUnavailableItem(seed.tenantA, MON_NOON_PARIS);
    const monEvening = Date.parse("2026-07-13T17:00:00Z");
    await t.mutation(internal.crons.reactivateUnavailableItems, {
      now: monEvening,
    });
    const after = await t.run(async (ctx) =>
      ctx.db.get(itemId as Id<"menuItems">),
    );
    expect(after?.available).toBe(false);
  });

  it("only touches the RIGHT tenant — A reactivates, B's stays untouched", async () => {
    const aItem = await seedUnavailableItem(seed.tenantA, MON_NOON_PARIS);
    // B's item went unavailable on Tuesday morning: by Tuesday noon it is NOT yet
    // a "day after", so the same cron run must leave B alone.
    const bItem = await seedUnavailableItem(seed.tenantB, TUE_EARLY_PARIS);
    await t.mutation(internal.crons.reactivateUnavailableItems, {
      now: TUE_NOON_PARIS,
    });
    const a = await t.run(async (ctx) => ctx.db.get(aItem as Id<"menuItems">));
    const b = await t.run(async (ctx) => ctx.db.get(bItem as Id<"menuItems">));
    expect(a?.available).toBe(true); // A: Monday → reactivated Tuesday
    expect(b?.available).toBe(false); // B: Tuesday → not yet a day after
  });
});
