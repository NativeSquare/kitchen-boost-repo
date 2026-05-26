import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ServiceWindow } from "../../table/serviceHours";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";
import {
  assertServiceWindows,
  isWithinServiceHours,
  parisLocalParts,
} from "./serviceHours";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/menu/, so Vite keys same-dir matches as "./x"; normalise every key
// to be relative to the convex root (../../). Same shape as catalog.test.ts.
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
 * 2.2-E — Plage horaire de service + isOpenNow (PRD 10 §4/edge "resto fermé",
 * delivery CONTEXT "Plage horaire de service", client-ordering CONTEXT, ADR 0010),
 * written BEFORE the implementation (TDD red).
 *
 * KB is the SOURCE OF TRUTH of the resto's opening. The open/closed decision is a
 * PURE function (windows + clock → boolean) so it is tested deterministically on
 * several Europe/Paris clocks (injected timestamps — never the real wall-clock,
 * which would make the suite flaky). The Convex surface (`get` / `set` /
 * `isOpenNow`) only wires the tenant's persisted windows + `Date.now()` into that
 * pure function, and is the cross-tenant-fuzzed surface (a tenant's hours must
 * never leak / gate another tenant).
 */

// --- Europe/Paris fixed reference timestamps (UTC), chosen across DST ----------
//
// Europe/Paris is UTC+1 (CET) in winter and UTC+2 (CEST) in summer. We pin a
// summer and a winter instant so the timezone math (and its DST offset) is
// exercised explicitly, NOT assumed.
//
// Wed 2026-07-15 (CEST, UTC+2): 10:00 UTC = 12:00 Paris, day 3 (Wed), min 720.
const SUMMER_NOON_PARIS = Date.parse("2026-07-15T10:00:00Z");
// Wed 2026-01-14 (CET, UTC+1): 11:00 UTC = 12:00 Paris, day 3 (Wed), min 720.
const WINTER_NOON_PARIS = Date.parse("2026-01-14T11:00:00Z");

describe("2.2-E parisLocalParts — UTC ms → Europe/Paris dayOfWeek + minuteOfDay", () => {
  it("maps a summer (CEST, UTC+2) instant to local Paris time", () => {
    // 10:00 UTC in July = 12:00 Paris.
    expect(parisLocalParts(SUMMER_NOON_PARIS)).toEqual({
      dayOfWeek: 3, // Wednesday
      minuteOfDay: 720, // 12:00
    });
  });

  it("maps a winter (CET, UTC+1) instant to local Paris time", () => {
    // 11:00 UTC in January = 12:00 Paris.
    expect(parisLocalParts(WINTER_NOON_PARIS)).toEqual({
      dayOfWeek: 3, // Wednesday
      minuteOfDay: 720, // 12:00
    });
  });

  it("uses 0=Sunday … 6=Saturday (JS getDay convention)", () => {
    // Sun 2026-07-12 08:00 UTC = 10:00 Paris (CEST).
    expect(parisLocalParts(Date.parse("2026-07-12T08:00:00Z")).dayOfWeek).toBe(
      0,
    );
    // Sat 2026-07-11 08:00 UTC = 10:00 Paris (CEST).
    expect(parisLocalParts(Date.parse("2026-07-11T08:00:00Z")).dayOfWeek).toBe(
      6,
    );
  });

  it("crosses a local-midnight day boundary correctly (UTC day ≠ Paris day)", () => {
    // 2026-07-15 23:30 UTC = 2026-07-16 01:30 Paris (CEST). Day flips to Thu (4).
    expect(parisLocalParts(Date.parse("2026-07-15T23:30:00Z"))).toEqual({
      dayOfWeek: 4, // Thursday
      minuteOfDay: 90, // 01:30
    });
  });
});

describe("2.2-E isWithinServiceHours — pure (windows + clock → boolean)", () => {
  // Buns & Bao Wednesday: 11h30–14h30 (690–870) + 18h30–22h30 (1110–1350).
  const wedLunch: ServiceWindow = {
    dayOfWeek: 3,
    startMinute: 690,
    endMinute: 870,
  };
  const wedDinner: ServiceWindow = {
    dayOfWeek: 3,
    startMinute: 1110,
    endMinute: 1350,
  };
  const windows = [wedLunch, wedDinner];

  it("is OPEN inside a window (summer, CEST)", () => {
    // 12:00 Paris Wed (720) is inside 690–870.
    expect(isWithinServiceHours(windows, SUMMER_NOON_PARIS)).toBe(true);
  });

  it("is OPEN inside a window (winter, CET) — same local time, different UTC", () => {
    expect(isWithinServiceHours(windows, WINTER_NOON_PARIS)).toBe(true);
  });

  it("is CLOSED in the afternoon gap between two windows", () => {
    // 15:00 Paris Wed (900) is between 870 and 1110.
    expect(
      isWithinServiceHours(windows, Date.parse("2026-07-15T13:00:00Z")),
    ).toBe(false);
  });

  it("is OPEN in the evening window", () => {
    // 19:00 Paris Wed (1140) is inside 1110–1350.
    expect(
      isWithinServiceHours(windows, Date.parse("2026-07-15T17:00:00Z")),
    ).toBe(true);
  });

  it("is CLOSED on a day with no window (Thursday)", () => {
    // 12:00 Paris Thu — no Thursday window at all.
    expect(
      isWithinServiceHours(windows, Date.parse("2026-07-16T10:00:00Z")),
    ).toBe(false);
  });

  it("treats startMinute as INCLUSIVE and endMinute as EXCLUSIVE (boundaries)", () => {
    // 11:30 Paris (690) — exactly the open edge ⇒ OPEN.
    expect(
      isWithinServiceHours(windows, Date.parse("2026-07-15T09:30:00Z")),
    ).toBe(true);
    // 14:30 Paris (870) — exactly the close edge ⇒ CLOSED (no longer ordering).
    expect(
      isWithinServiceHours(windows, Date.parse("2026-07-15T12:30:00Z")),
    ).toBe(false);
    // 14:29 Paris (869) — one minute before close ⇒ OPEN.
    expect(
      isWithinServiceHours(windows, Date.parse("2026-07-15T12:29:00Z")),
    ).toBe(true);
  });

  it("is CLOSED when there are NO windows (resto not configured yet)", () => {
    expect(isWithinServiceHours([], SUMMER_NOON_PARIS)).toBe(false);
  });

  it("matches the window for the CORRECT day only (same minutes, wrong day)", () => {
    // A Monday-only window cannot open on a Wednesday at the same minute.
    const monLunch: ServiceWindow = {
      dayOfWeek: 1,
      startMinute: 690,
      endMinute: 870,
    };
    expect(isWithinServiceHours([monLunch], SUMMER_NOON_PARIS)).toBe(false);
  });
});

describe("2.2-E assertServiceWindows — save-time validation (no invented rules)", () => {
  it("accepts a valid Buns & Bao multi-window schedule", () => {
    expect(() =>
      assertServiceWindows([
        { dayOfWeek: 1, startMinute: 690, endMinute: 870 },
        { dayOfWeek: 1, startMinute: 1110, endMinute: 1350 },
      ]),
    ).not.toThrow();
  });

  it("accepts an EMPTY schedule (a resto with no hours yet = always closed)", () => {
    expect(() => assertServiceWindows([])).not.toThrow();
  });

  it("rejects a dayOfWeek outside 0..6", () => {
    expect(() =>
      assertServiceWindows([
        { dayOfWeek: 7, startMinute: 600, endMinute: 700 },
      ]),
    ).toThrow();
  });

  it("rejects minutes outside 0..1440", () => {
    expect(() =>
      assertServiceWindows([{ dayOfWeek: 1, startMinute: -1, endMinute: 700 }]),
    ).toThrow();
    expect(() =>
      assertServiceWindows([
        { dayOfWeek: 1, startMinute: 600, endMinute: 1500 },
      ]),
    ).toThrow();
  });

  it("rejects start >= end (V1 windows do not span midnight)", () => {
    expect(() =>
      assertServiceWindows([
        { dayOfWeek: 1, startMinute: 800, endMinute: 800 },
      ]),
    ).toThrow();
    expect(() =>
      assertServiceWindows([
        { dayOfWeek: 1, startMinute: 900, endMinute: 600 },
      ]),
    ).toThrow();
  });

  it("rejects non-integer minutes", () => {
    expect(() =>
      assertServiceWindows([
        { dayOfWeek: 1, startMinute: 600.5, endMinute: 700 },
      ]),
    ).toThrow();
  });
});

// --- Convex surface: get / set / isOpenNow -----------------------------------

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const BB_WINDOWS = [
  { dayOfWeek: 1, startMinute: 690, endMinute: 870 },
  { dayOfWeek: 1, startMinute: 1110, endMinute: 1350 },
];

describe("2.2-E serviceHours.set / get — tenant-scoped CRUD (kb_manager)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("get returns an EMPTY schedule before any set", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    const hours = await asA.query(api.lib.menu.serviceHours.get, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(hours.windows).toEqual([]);
  });

  it("set then get round-trips the windows (single shared slot)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    await asA.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: BB_WINDOWS,
    });
    const hours = await asA.query(api.lib.menu.serviceHours.get, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(hours.windows).toEqual(BB_WINDOWS);
  });

  it("set is UPSERT — a second set REPLACES the windows (one row per tenant)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    await asA.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: BB_WINDOWS,
    });
    const replacement = [{ dayOfWeek: 2, startMinute: 600, endMinute: 660 }];
    await asA.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: replacement,
    });
    const hours = await asA.query(api.lib.menu.serviceHours.get, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(hours.windows).toEqual(replacement);
    // Still exactly ONE row for the tenant (uniqueness enforced applicatively).
    const rows = await t.run(async (ctx) =>
      ctx.db
        .query("serviceHours")
        .withIndex("by_tenant", (q) => q.eq("tenantId", seed.tenantA.tenantId))
        .collect(),
    );
    expect(rows).toHaveLength(1);
  });

  it("set REFUSES invalid windows (start >= end)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asA.mutation(api.lib.menu.serviceHours.set, {
        tenantId: seed.tenantA.tenantId,
        windows: [{ dayOfWeek: 1, startMinute: 900, endMinute: 600 }],
      }),
    ).rejects.toThrow();
  });

  it("a plain staff member CANNOT set the hours (kb_manager only)", async () => {
    const asStaff = t.withIdentity({ subject: seed.tenantA.staffId });
    await expect(
      asStaff.mutation(api.lib.menu.serviceHours.set, {
        tenantId: seed.tenantA.tenantId,
        windows: BB_WINDOWS,
      }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("2.2-E isOpenNow — PUBLIC eater-facing gate (publicTenantQuery)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("is accessible WITHOUT authentication and returns a boolean", async () => {
    const open = await t.query(api.lib.menu.serviceHours.isOpenNow, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(typeof open).toBe("boolean");
  });

  it("is CLOSED when the tenant has no service hours configured", async () => {
    const open = await t.query(api.lib.menu.serviceHours.isOpenNow, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(open).toBe(false);
  });

  it("throws for an unknown tenantId (public wrapper)", async () => {
    const danglingId = await t.run(async (ctx) => {
      const id = await ctx.db.insert("tenants", {
        slug: "ghost",
        name: "Ghost",
        siret: "ghost",
        status: "active",
        createdAt: Date.now(),
      });
      await ctx.db.delete(id);
      return id;
    });
    await expect(
      t.query(api.lib.menu.serviceHours.isOpenNow, { tenantId: danglingId }),
    ).rejects.toThrow(/forbidden|not found/i);
  });
});

describe("2.2-E cross-tenant — A's hours never leak / never gate B (ADR 0010)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("get(A) for tenant B's manager throws (no cross-tenant read)", async () => {
    const asBmgr = t.withIdentity({ subject: seed.tenantB.managerId });
    await expect(
      asBmgr.query(api.lib.menu.serviceHours.get, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("set(A) for tenant B's manager throws (no cross-tenant write)", async () => {
    const asBmgr = t.withIdentity({ subject: seed.tenantB.managerId });
    await expect(
      asBmgr.mutation(api.lib.menu.serviceHours.set, {
        tenantId: seed.tenantA.tenantId,
        windows: BB_WINDOWS,
      }),
    ).rejects.toThrow(/forbidden/i);
  });

  it("setting A's hours does NOT change B's get (rows are isolated by tenant)", async () => {
    const asA = t.withIdentity({ subject: seed.tenantA.managerId });
    await asA.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: BB_WINDOWS,
    });
    // B's manager reads B's hours — still empty, A's write never bled across.
    const asB = t.withIdentity({ subject: seed.tenantB.managerId });
    const bHours = await asB.query(api.lib.menu.serviceHours.get, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(bHours.windows).toEqual([]);
  });

  it("isOpenNow(A) reflects A's hours only, never B's (public read isolation)", async () => {
    // Give B a wide-open all-week schedule; A stays empty.
    const asB = t.withIdentity({ subject: seed.tenantB.managerId });
    await asB.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantB.tenantId,
      windows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        startMinute: 0,
        endMinute: 1439,
      })),
    });
    // A has no hours ⇒ A is closed regardless of B being always open.
    const openA = await t.query(api.lib.menu.serviceHours.isOpenNow, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(openA).toBe(false);
    // B is open all the time.
    const openB = await t.query(api.lib.menu.serviceHours.isOpenNow, {
      tenantId: seed.tenantB.tenantId,
    });
    expect(openB).toBe(true);
  });
});
