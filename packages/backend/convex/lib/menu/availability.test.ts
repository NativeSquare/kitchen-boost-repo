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
import {
  itemsToReactivate,
  latestServiceOpeningAtOrBefore,
} from "./availability";

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
 * 2.2-fix (#105) — Disponibilité item (toggle out-of-stock + auto-réactivation),
 * written BEFORE the implementation (TDD red). Corrects #56: the reactivation
 * criterion is the FIRST SERVICE-OPENING BOUNDARY strictly after
 * `unavailableSince` (client-ordering CONTEXT "Item out of stock" — "indisponible
 * jusqu'à fin de service", "Auto-réactivation au lendemain à l'ouverture du resto
 * selon [[Plage horaire de service]]"), NOT a hardcoded "next calendar day".
 * Consequence: an item toggled off BEFORE the day's opening must come back at the
 * SAME day's opening, not skip a full day. Multi-tenant CONTEXT grants `staff` the
 * toggle; ADR 0010.
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
// Mon 2026-07-13 09:00 Paris — BEFORE the 11h30 Monday opening (resto not open).
const MON_EARLY_PARIS = Date.parse("2026-07-13T07:00:00Z");

// An every-day 11h30–22h30 window (690–1350), so every day has an opening.
const ALLDAY_WINDOWS: ServiceWindow[] = [0, 1, 2, 3, 4, 5, 6].map(
  (dayOfWeek) => ({ dayOfWeek, startMinute: 690, endMinute: 1350 }),
);

describe("2.2-fix latestServiceOpeningAtOrBefore — last opening instant ≤ now (Europe/Paris)", () => {
  it("is Monday's 11h30 opening when now is Monday noon", () => {
    // Monday 11h30 Paris (CEST) = 09:30 UTC.
    const monOpen = Date.parse("2026-07-13T09:30:00Z");
    expect(latestServiceOpeningAtOrBefore(ALLDAY_WINDOWS, MON_NOON_PARIS)).toBe(
      monOpen,
    );
  });

  it("is YESTERDAY's opening when today has not opened yet", () => {
    // Tuesday 10:00 Paris, before the 11h30 Tuesday opening ⇒ last opening is
    // Monday 11h30 (= 09:30 UTC Monday).
    const monOpen = Date.parse("2026-07-13T09:30:00Z");
    expect(
      latestServiceOpeningAtOrBefore(ALLDAY_WINDOWS, TUE_EARLY_PARIS),
    ).toBe(monOpen);
  });

  it("returns undefined when the resto has NO windows (never opens)", () => {
    expect(latestServiceOpeningAtOrBefore([], TUE_NOON_PARIS)).toBeUndefined();
  });

  it("skips closed days to the latest day that actually opens", () => {
    // Open Monday + Wednesday only. Tuesday noon ⇒ last opening is Monday 11h30.
    const monWed: ServiceWindow[] = [
      { dayOfWeek: 1, startMinute: 690, endMinute: 1350 },
      { dayOfWeek: 3, startMinute: 690, endMinute: 1350 },
    ];
    const monOpen = Date.parse("2026-07-13T09:30:00Z");
    expect(latestServiceOpeningAtOrBefore(monWed, TUE_NOON_PARIS)).toBe(
      monOpen,
    );
  });
});

describe("2.2-fix itemsToReactivate — pure (windows + items + clock → ids)", () => {
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

  it("CORE FIX: an item toggled off BEFORE the day's opening reactivates at the SAME day's opening (no full-day skip)", () => {
    // Unavailable Monday 09:00 (before the 11h30 Monday opening); at Monday noon
    // the 11h30 opening has been crossed and is strictly after `unavailableSince`
    // ⇒ reactivate the SAME day. (Old #56 "lendemain" logic wrongly waited Tuesday.)
    const ids = itemsToReactivate(
      ALLDAY_WINDOWS,
      [mkItem({ unavailableSince: MON_EARLY_PARIS })],
      MON_NOON_PARIS,
    );
    expect(ids).toEqual(["i1"]);
  });

  it("does NOT reactivate while still inside the same service that was running when it went unavailable", () => {
    // Marked unavailable Monday noon (service already open since 11h30); still
    // Monday evening (19:00 Paris). No NEW opening has occurred after noon, so the
    // item must stay unavailable "jusqu'à fin de service".
    const monEvening = Date.parse("2026-07-13T17:00:00Z");
    expect(itemsToReactivate(ALLDAY_WINDOWS, [mkItem()], monEvening)).toEqual(
      [],
    );
  });

  it("WAITS for the NEXT opening — a later day but before its opening = not yet", () => {
    // Unavailable Monday noon. Tuesday 10:00 Paris: the last opening ≤ now is
    // Monday 11h30 (BEFORE noon), so no opening strictly after `unavailableSince`
    // has occurred yet ⇒ keep closed.
    expect(
      itemsToReactivate(ALLDAY_WINDOWS, [mkItem()], TUE_EARLY_PARIS),
    ).toEqual([]);
  });

  it("skips a closed day and reactivates at the NEXT day that actually opens", () => {
    // Open Monday + Wednesday only; unavailable Monday noon. Tuesday has no
    // opening, so it must wait until Wednesday's opening.
    const monWed: ServiceWindow[] = [
      { dayOfWeek: 1, startMinute: 690, endMinute: 1350 },
      { dayOfWeek: 3, startMinute: 690, endMinute: 1350 },
    ];
    // Tuesday noon — no Tuesday window ⇒ last opening is Monday 11h30 (before
    // unavailableSince noon) ⇒ still closed.
    expect(itemsToReactivate(monWed, [mkItem()], TUE_NOON_PARIS)).toEqual([]);
    // Wednesday noon — Wednesday's 11h30 opening is strictly after noon Monday ⇒
    // reactivate.
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

  it("returns only the items whose next opening has been reached (subset)", () => {
    // `fresh` went off Tuesday 10:00 (before opening); `stale` Monday noon. At
    // Tuesday noon the 11h30 Tuesday opening is strictly after `fresh` AND after
    // `stale` ⇒ both qualify.
    const fresh = mkItem({ _id: "fresh", unavailableSince: TUE_EARLY_PARIS });
    const stale = mkItem({ _id: "stale", unavailableSince: MON_NOON_PARIS });
    expect(
      itemsToReactivate(ALLDAY_WINDOWS, [fresh, stale], TUE_NOON_PARIS).sort(),
    ).toEqual(["fresh", "stale"]);
  });

  it("does NOT reactivate an item toggled off DURING today's service until the next opening", () => {
    // `running` went off Tuesday 10:00 BEFORE opening → reactivates at noon (same
    // day). `midService` went off Tuesday 12:30 AFTER the 11h30 opening → no new
    // opening yet at 13:00 → stays off. Distinguishes "before opening" from
    // "during service".
    const tueAfterOpen = Date.parse("2026-07-14T10:30:00Z"); // 12:30 Paris
    const tueThirteen = Date.parse("2026-07-14T11:00:00Z"); // 13:00 Paris
    const running = mkItem({
      _id: "running",
      unavailableSince: TUE_EARLY_PARIS,
    });
    const midService = mkItem({
      _id: "midService",
      unavailableSince: tueAfterOpen,
    });
    expect(
      itemsToReactivate(ALLDAY_WINDOWS, [running, midService], tueThirteen),
    ).toEqual(["running"]);
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

describe("2.2-fix setItemAvailability — kb_manager + staff toggle", () => {
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

describe("2.2-fix cross-tenant fuzz — setItemAvailability, 0 leak (ADR 0010)", () => {
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

describe("2.2-fix reactivation cron — per-tenant, tenant-isolated (ADR 0010)", () => {
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

  it("CORE FIX: reactivates a same-day item toggled off before opening, at its opening", async () => {
    // Unavailable Monday 09:00 (before the 11h30 opening); the noon cron pass on
    // the SAME Monday reactivates it (old #56 wrongly waited until Tuesday).
    const itemId = await seedUnavailableItem(seed.tenantA, MON_EARLY_PARIS);
    await t.mutation(internal.crons.reactivateUnavailableItems, {
      now: MON_NOON_PARIS,
    });
    const after = await t.run(async (ctx) =>
      ctx.db.get(itemId as Id<"menuItems">),
    );
    expect(after?.available).toBe(true);
    expect(after?.unavailableSince).toBeUndefined();
  });

  it("does NOT reactivate while still inside the running service (clock still Monday evening)", async () => {
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
    // B's item went unavailable Tuesday 12:30, AFTER the 11h30 opening: at Tuesday
    // noon... actually after; pick a clock where A qualifies but B does not. B's
    // unavailableSince is Tuesday noon (after the day's 11h30 opening) so at the
    // Tuesday-noon pass no NEW opening has occurred for B ⇒ it stays off.
    const bItem = await seedUnavailableItem(seed.tenantB, TUE_NOON_PARIS);
    await t.mutation(internal.crons.reactivateUnavailableItems, {
      now: TUE_NOON_PARIS,
    });
    const a = await t.run(async (ctx) => ctx.db.get(aItem as Id<"menuItems">));
    const b = await t.run(async (ctx) => ctx.db.get(bItem as Id<"menuItems">));
    expect(a?.available).toBe(true); // A: Monday noon → Tuesday opening reactivates
    expect(b?.available).toBe(false); // B: Tuesday noon = today's opening already passed before it
  });
});

// --- B-MENU-PUBLICATION slice 6 (#191) — PIVOT: toggle setItemAvailability
//     does NOT trigger a republication of the [[Instantané publié]] (ADR 0015).
//
// This block is the canonical PIN of the ADR 0015 « rupture / pivot » contract:
// the staff's 1-tap out-of-stock toggle is ORTHOGONAL to publication. The
// snapshot's `publishedAt` MUST NOT move on a toggle, and a toggle MUST NOT
// implicitly republish any other pending draft change. The overlay live read in
// `getPublicMenu` (slice 3 / #160) is what surfaces the toggle to the eater
// without rebuilding the snapshot.
//
// Slices 2 (#155), 3 (#160) and 4 (#166) already wired the moving parts; this
// suite is the assertion-only layer that locks the contract down so any future
// refactor that accidentally republishes on toggle (or freezes `available` into
// the snapshot payload) will turn red here.
// ----------------------------------------------------------------------------

describe("B-MENU-PUBLICATION slice 6 (#191) — pivot: toggle does NOT republish (ADR 0015)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  /** The `menuItems` id under test (tenant A). */
  let itemId: Id<"menuItems">;
  /** The `menuCategories` id holding `itemId` (used by the « no implicit republish » pivot). */
  let categoryId: Id<"menuCategories">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    categoryId = (await asMgr.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantA.tenantId,
      name: "Smashs",
    })) as Id<"menuCategories">;
    itemId = (await asMgr.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantA.tenantId,
      categoryId,
      name: "Smash Double",
      description: "desc",
      basePrice: 1290,
      allergens: [],
    })) as Id<"menuItems">;
    // Publish the initial draft so a snapshot exists with a `publishedAt`.
    await asMgr.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
  });

  /** Read the tenant's `publishedMenus.publishedAt`, or throw if absent. */
  async function getPublishedAt(tenantId: Id<"tenants">): Promise<number> {
    const row = await t.run(async (ctx) =>
      ctx.db
        .query("publishedMenus")
        .withIndex("by_tenant", (q) => q.eq("tenantId", tenantId))
        .unique(),
    );
    if (row === null) {
      throw new Error(
        `expected a publishedMenus row for tenant ${tenantId}, found none`,
      );
    }
    return row.publishedAt;
  }

  it("PIVOT 1: publish → toggle(false) → getPublicMenu reflects available=false WITHOUT moving publishedAt", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const publishedAtBefore = await getPublishedAt(seed.tenantA.tenantId);

    await asMgr.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });

    // The eater immediately sees the rupture via the overlay.
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const item = menu.categories[0]?.items[0];
    expect(item?._id).toBe(itemId);
    expect(item?.available).toBe(false);

    // KEY PIVOT: the snapshot was NOT rebuilt — publishedAt is byte-identical.
    const publishedAtAfter = await getPublishedAt(seed.tenantA.tenantId);
    expect(publishedAtAfter).toBe(publishedAtBefore);
  });

  it("PIVOT 2: a toggle does NOT implicitly republish a pending draft change (category rename stays invisible)", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const publishedAtBefore = await getPublishedAt(seed.tenantA.tenantId);

    // 1) Mutate the draft (rename the category) WITHOUT publishing.
    await asMgr.mutation(api.lib.menu.categories.rename, {
      tenantId: seed.tenantA.tenantId,
      categoryId,
      name: "Smashs v2 (DRAFT)",
    });
    // 2) Toggle the item out of stock — must NOT republish the snapshot.
    await asMgr.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });

    // 3) The eater STILL sees the published category name, not the draft rename
    //    (proof the toggle didn't trigger an implicit republication).
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(menu.categories[0]?.name).toBe("Smashs");
    // …but the live overlay flipped the item.
    expect(menu.categories[0]?.items[0]?.available).toBe(false);

    const publishedAtAfter = await getPublishedAt(seed.tenantA.tenantId);
    expect(publishedAtAfter).toBe(publishedAtBefore);
  });

  it("PIVOT 3: toggling BACK to available=true is also overlay-only — publishedAt stays put", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const publishedAtBefore = await getPublishedAt(seed.tenantA.tenantId);

    await asMgr.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });
    await asMgr.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: true,
    });

    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(menu.categories[0]?.items[0]?.available).toBe(true);

    const publishedAtAfter = await getPublishedAt(seed.tenantA.tenantId);
    expect(publishedAtAfter).toBe(publishedAtBefore);
  });

  it("PIVOT 4: republishing AFTER a toggle DOES move publishedAt; overlay keeps reading live (orthogonality preserved)", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const publishedAtBefore = await getPublishedAt(seed.tenantA.tenantId);

    // Flip the item OFF via the overlay (no republication).
    await asMgr.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });
    // Force `Date.now()` to advance at least 1 ms so republish stamps a strictly
    // greater `publishedAt` (Date.now()'s ms resolution can collide in tight loops).
    const beforeRepublish = Date.now();
    while (Date.now() === beforeRepublish) {
      /* spin briefly to ensure publishedAt changes */
    }
    // Republish — snapshot rebuilt, publishedAt MUST move.
    await asMgr.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const publishedAtAfter = await getPublishedAt(seed.tenantA.tenantId);
    expect(publishedAtAfter).toBeGreaterThan(publishedAtBefore);

    // The overlay is still live: re-toggling does NOT bump publishedAt either,
    // and the snapshot did NOT freeze `available=false` into its payload (the
    // snapshot's source of truth for availability is always the live row).
    await asMgr.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: true,
    });
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(menu.categories[0]?.items[0]?.available).toBe(true);
    expect(await getPublishedAt(seed.tenantA.tenantId)).toBe(publishedAtAfter);
  });

  it("PIVOT 5: item DELETED from the draft post-publish stays in the snapshot but is greyed (available=false, no throw, publishedAt untouched)", async () => {
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const publishedAtBefore = await getPublishedAt(seed.tenantA.tenantId);

    // Remove the item from the live draft WITHOUT republishing.
    await asMgr.mutation(api.lib.menu.items.remove, {
      tenantId: seed.tenantA.tenantId,
      itemId,
    });

    // getPublicMenu must NOT throw — it returns the snapshot's item with
    // available=false (overlay defaults to false when the live row is missing).
    const menu = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantA.tenantId,
    });
    const item = menu.categories[0]?.items[0];
    expect(item?._id).toBe(itemId);
    expect(item?.name).toBe("Smash Double");
    expect(item?.available).toBe(false);

    // The deletion went through `lib/menu/items.remove`, not through
    // `publishMenu`, so the snapshot's `publishedAt` MUST stay put.
    expect(await getPublishedAt(seed.tenantA.tenantId)).toBe(publishedAtBefore);
  });

  it("PIVOT 6 — cross-tenant (ADR 0010): toggling tenant A's item touches NEITHER tenant B's snapshot NOR its overlay", async () => {
    const asMgrA = t.withIdentity({ subject: seed.tenantA.managerId });
    const asMgrB = t.withIdentity({ subject: seed.tenantB.managerId });

    // Seed + publish tenant B with its own item, so B has a snapshot too.
    const bCategoryId = (await asMgrB.mutation(api.lib.menu.categories.create, {
      tenantId: seed.tenantB.tenantId,
      name: "B-cat",
    })) as Id<"menuCategories">;
    const bItemId = (await asMgrB.mutation(api.lib.menu.items.create, {
      tenantId: seed.tenantB.tenantId,
      categoryId: bCategoryId,
      name: "B-item",
      description: "",
      basePrice: 500,
      allergens: [],
    })) as Id<"menuItems">;
    await asMgrB.mutation(api.lib.menu.publication.publishMenu, {
      tenantId: seed.tenantB.tenantId,
    });
    const bPublishedAtBefore = await getPublishedAt(seed.tenantB.tenantId);

    // Toggle tenant A's item OFF.
    await asMgrA.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });

    // Tenant B's snapshot stamp is untouched.
    expect(await getPublishedAt(seed.tenantB.tenantId)).toBe(
      bPublishedAtBefore,
    );
    // And tenant B's overlay-read availability for its OWN item is still true
    // (the toggle on A did not bleed into B's `menuItems.available`).
    const menuB = await t.query(api.lib.menu.catalog.getPublicMenu, {
      tenantId: seed.tenantB.tenantId,
    });
    const bItem = menuB.categories[0]?.items[0];
    expect(bItem?._id).toBe(bItemId);
    expect(bItem?.available).toBe(true);
  });
});
