/**
 * F-COMMANDES-FILTERS (#238) — `orders-filtering` (deep pure module).
 *
 * Pinned contract of `filterOrders(orders, { dateRange, statuses })`:
 *  - AC (a) « date 'aujourd'hui' en Europe/Paris » → keeps only orders whose
 *    `createdAt` falls in the current Paris day (Paris boundary, NOT UTC).
 *  - AC (b) « multi-statuts OR » → when several statuses are selected, an order
 *    matches if its status is in the set (OR within the dimension).
 *  - AC (c) « AND entre date et statuts » → both dimensions combine
 *    conjunctively (date AND statuses).
 *  - AC (d) « filtres vides = tout passe » → an empty selection on either
 *    dimension is a passthrough on that dimension (not a "no match" trap).
 *
 * Why a dedicated pure module:
 *  - Filtering is the live re-application of EPIC #141's AC8: « Quand une cmd
 *    live arrive via WebSocket Convex pendant qu'un filtre est actif, elle
 *    apparait OU est cachee selon le filtre courant ». Keeping the predicate
 *    pure means the page applies it on every Convex push without any extra
 *    plumbing — no useEffect, no derived state, no race against a snapshot.
 *  - All the time-zone subtleties (« aujourd'hui en Europe/Paris ») live in
 *    one tested seam, not scattered in the UI component.
 *
 * Tests run under `environment: "node"` (apps/admin/vitest.config.ts). The
 * helper uses `Intl.DateTimeFormat` with `timeZone: "Europe/Paris"` (a built-
 * in, available in every Node ICU build we ship) — no `date-fns-tz` dep
 * added (issue body « utiliser un helper timezone-aware si pas deja en place,
 * sinon date-fns-tz » — `Intl` IS already in place).
 */
import { describe, expect, it } from "vitest";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import {
  ALL_ORDER_STATUSES,
  filterOrders,
  type DateRangeKey,
} from "./orders-filtering";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TENANT = "tenants_fixture" as unknown as Id<"tenants">;
const CUSTOMER = "customers_fixture" as unknown as Id<"customers">;

function order(
  partial: Partial<Omit<Doc<"orders">, "_id">> & {
    _id: string;
    createdAt: number;
  },
): Doc<"orders"> {
  const { _id, createdAt, ...rest } = partial;
  return {
    _id: _id as unknown as Id<"orders">,
    _creationTime: createdAt,
    tenantId: TENANT,
    customerId: CUSTOMER,
    status: "nouvelle",
    mode: "delivery",
    source: "direct",
    createdAt,
    ...rest,
  } as Doc<"orders">;
}

/**
 * Build a millisecond UTC epoch for an instant expressed in Europe/Paris wall
 * clock. We need this because the "today" range is computed in Paris (the
 * gérant's local day), but the fixtures and the assertions are clearer when
 * written explicitly: "at 09h00 Paris of 2026-05-29".
 *
 * Paris is UTC+1 (CET) or UTC+2 (CEST). 2026-05-29 is in DST (CEST, UTC+2), so
 * 09h00 Paris = 07h00 UTC. We expose the helper instead of hard-coding the
 * offset so a future fixture in winter doesn't silently drift by 1h.
 */
function parisInstant(
  year: number,
  monthZeroIndexed: number,
  day: number,
  hour: number,
  minute = 0,
): number {
  // Build an `Intl.DateTimeFormat` view of a UTC instant at the target Paris
  // wall clock, then iteratively bisect until the formatted Paris components
  // match — robust across DST transitions without hard-coding the offset.
  const target = { year, month: monthZeroIndexed + 1, day, hour, minute };
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  // Initial guess: pretend Paris = UTC (will be 1-2h off, we'll correct).
  let guess = Date.UTC(year, monthZeroIndexed, day, hour, minute);
  for (let i = 0; i < 5; i += 1) {
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date(guess)).map((p) => [p.type, p.value]),
    );
    const got = {
      year: Number(parts.year),
      month: Number(parts.month),
      day: Number(parts.day),
      hour: Number(parts.hour),
      minute: Number(parts.minute),
    };
    const deltaHours = (target.day - got.day) * 24 + (target.hour - got.hour);
    const deltaMinutes = target.minute - got.minute;
    const drift =
      (deltaHours * 60 + deltaMinutes) * 60 * 1000 +
      (target.year - got.year) * 365 * 24 * 60 * 60 * 1000 +
      (target.month - got.month) * 30 * 24 * 60 * 60 * 1000;
    if (drift === 0) return guess;
    guess += drift;
  }
  return guess;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ALL_ORDER_STATUSES — imported from the `orderStatus` validator", () => {
  it("matches the 8 documented states of PRD 20 §5 + §6 / PRD 10 §10-§11", () => {
    // The issue body « Les 8 statuts du multi-select sont importes du validator
    // `orderStatus` (eviter le hard-code) ». We pin the full set so a future
    // status addition (e.g. V2 « ordonnée », « livraison en cours ») fires
    // here loudly — the front then needs an explicit choice to surface the
    // new status in the filter.
    expect(ALL_ORDER_STATUSES).toEqual([
      "en attente de paiement",
      "nouvelle",
      "en préparation",
      "prête",
      "remise",
      "livrée",
      "collectée",
      "refusée",
    ]);
  });
});

describe("filterOrders — F-COMMANDES-FILTERS (#238)", () => {
  // -------------------------------------------------------------------------
  // AC (d) — empty filters = passthrough
  // -------------------------------------------------------------------------
  describe("AC(d) — empty filters", () => {
    it("returns the whole input untouched when dateRange is 'tout' AND statuses is empty", () => {
      const input = [
        order({ _id: "orders_a", createdAt: parisInstant(2026, 4, 29, 10) }),
        order({
          _id: "orders_b",
          createdAt: parisInstant(2026, 0, 15, 14),
          status: "livrée",
        }),
        order({
          _id: "orders_c",
          createdAt: parisInstant(2025, 11, 31, 23),
          status: "refusée",
        }),
      ];
      const out = filterOrders(input, { dateRange: "tout", statuses: [] });
      expect(out).toEqual(input);
    });

    it("returns the same reference order (stable — preserves backend DESC sort)", () => {
      const input = [
        order({ _id: "orders_a", createdAt: parisInstant(2026, 4, 29, 10) }),
        order({ _id: "orders_b", createdAt: parisInstant(2026, 4, 29, 9) }),
      ];
      const out = filterOrders(input, { dateRange: "tout", statuses: [] });
      // The backend guarantees DESC sort via `listTenantOrders`; the filter
      // MUST not reorder (a future regression that wraps `.sort()` here
      // would silently break the table's chronological scan).
      expect(out[0]?._id).toBe(input[0]?._id);
      expect(out[1]?._id).toBe(input[1]?._id);
    });

    it("returns [] when input is []", () => {
      expect(filterOrders([], { dateRange: "tout", statuses: [] })).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // AC (a) — date 'aujourd'hui' in Europe/Paris
  // -------------------------------------------------------------------------
  describe("AC(a) — date range 'aujourd'hui' (Europe/Paris)", () => {
    it("keeps only orders whose createdAt falls within today's Paris day", () => {
      // Anchor "now" at a Paris midday so the day boundary is unambiguous.
      const now = parisInstant(2026, 4, 29, 12); // 2026-05-29 12h00 Paris
      const todayMorning = parisInstant(2026, 4, 29, 8); // same Paris day
      const todayLate = parisInstant(2026, 4, 29, 23, 59); // same Paris day
      const yesterday = parisInstant(2026, 4, 28, 23, 59); // previous Paris day
      const tomorrow = parisInstant(2026, 4, 30, 0); // next Paris day
      const input = [
        order({ _id: "orders_morning", createdAt: todayMorning }),
        order({ _id: "orders_late", createdAt: todayLate }),
        order({ _id: "orders_yesterday", createdAt: yesterday }),
        order({ _id: "orders_tomorrow", createdAt: tomorrow }),
      ];
      const out = filterOrders(
        input,
        { dateRange: "today", statuses: [] },
        { now },
      );
      const ids = out.map((o) => String(o._id));
      expect(ids).toContain("orders_morning");
      expect(ids).toContain("orders_late");
      expect(ids).not.toContain("orders_yesterday");
      expect(ids).not.toContain("orders_tomorrow");
    });

    it("handles the Paris↔UTC offset (an order at 23h30 Paris is 'today', not 'yesterday')", () => {
      // 23h30 Paris on 2026-05-29 = 21h30 UTC on 2026-05-29 (CEST).
      // A naive UTC slice [00:00 UTC, 24:00 UTC) would still include it, but
      // the contract is Paris-local. 01h30 Paris on 2026-05-30 = 23h30 UTC
      // 2026-05-29 — the UTC slice would wrongly include it.
      const now = parisInstant(2026, 4, 29, 12);
      const lateTonightParis = parisInstant(2026, 4, 29, 23, 30); // today
      const earlyTomorrowParis = parisInstant(2026, 4, 30, 1, 30); // tomorrow
      const input = [
        order({ _id: "orders_late", createdAt: lateTonightParis }),
        order({ _id: "orders_earlytomorrow", createdAt: earlyTomorrowParis }),
      ];
      const out = filterOrders(
        input,
        { dateRange: "today", statuses: [] },
        { now },
      );
      const ids = out.map((o) => String(o._id));
      expect(ids).toContain("orders_late");
      expect(ids).not.toContain("orders_earlytomorrow");
    });
  });

  // -------------------------------------------------------------------------
  // AC — date range '7d' and '30d'
  // -------------------------------------------------------------------------
  describe("AC — date range '7d' (last 7 days, inclusive of today)", () => {
    it("keeps orders within the last 7 Paris days, drops older", () => {
      const now = parisInstant(2026, 4, 29, 12);
      const today = parisInstant(2026, 4, 29, 10);
      const sixDaysAgo = parisInstant(2026, 4, 23, 12);
      const eightDaysAgo = parisInstant(2026, 4, 21, 12);
      const input = [
        order({ _id: "orders_today", createdAt: today }),
        order({ _id: "orders_6d", createdAt: sixDaysAgo }),
        order({ _id: "orders_8d", createdAt: eightDaysAgo }),
      ];
      const out = filterOrders(
        input,
        { dateRange: "7d", statuses: [] },
        { now },
      );
      const ids = out.map((o) => String(o._id));
      expect(ids).toContain("orders_today");
      expect(ids).toContain("orders_6d");
      expect(ids).not.toContain("orders_8d");
    });
  });

  describe("AC — date range '30d' (last 30 days)", () => {
    it("keeps orders within the last 30 Paris days, drops older", () => {
      const now = parisInstant(2026, 4, 29, 12);
      const day10Ago = parisInstant(2026, 4, 19, 12);
      const day29Ago = parisInstant(2026, 3, 30, 12);
      const day31Ago = parisInstant(2026, 3, 28, 12);
      const input = [
        order({ _id: "orders_10d", createdAt: day10Ago }),
        order({ _id: "orders_29d", createdAt: day29Ago }),
        order({ _id: "orders_31d", createdAt: day31Ago }),
      ];
      const out = filterOrders(
        input,
        { dateRange: "30d", statuses: [] },
        { now },
      );
      const ids = out.map((o) => String(o._id));
      expect(ids).toContain("orders_10d");
      expect(ids).toContain("orders_29d");
      expect(ids).not.toContain("orders_31d");
    });
  });

  // -------------------------------------------------------------------------
  // AC (b) — multi-statuts OR
  // -------------------------------------------------------------------------
  describe("AC(b) — statuses OR within the dimension", () => {
    it("keeps orders whose status is in the selected set", () => {
      const t = parisInstant(2026, 4, 29, 12);
      const input = [
        order({ _id: "orders_a", createdAt: t, status: "nouvelle" }),
        order({ _id: "orders_b", createdAt: t, status: "en préparation" }),
        order({ _id: "orders_c", createdAt: t, status: "prête" }),
        order({ _id: "orders_d", createdAt: t, status: "livrée" }),
      ];
      const out = filterOrders(input, {
        dateRange: "tout",
        statuses: ["nouvelle", "en préparation", "prête"],
      });
      const ids = out.map((o) => String(o._id));
      expect(ids).toEqual(["orders_a", "orders_b", "orders_c"]);
    });

    it("a single-status selection works the same as a multi-status selection (singleton OR)", () => {
      const t = parisInstant(2026, 4, 29, 12);
      const input = [
        order({ _id: "orders_a", createdAt: t, status: "nouvelle" }),
        order({ _id: "orders_b", createdAt: t, status: "refusée" }),
      ];
      const out = filterOrders(input, {
        dateRange: "tout",
        statuses: ["refusée"],
      });
      expect(out.map((o) => String(o._id))).toEqual(["orders_b"]);
    });
  });

  // -------------------------------------------------------------------------
  // AC (c) — AND between date and statuses
  // -------------------------------------------------------------------------
  describe("AC(c) — date AND statuses combine conjunctively", () => {
    it("keeps only orders that match BOTH dimensions (intersection, not union)", () => {
      const now = parisInstant(2026, 4, 29, 12);
      const today = parisInstant(2026, 4, 29, 10);
      const yesterday = parisInstant(2026, 4, 28, 10);
      const input = [
        // today + matches status: kept
        order({
          _id: "orders_today_nouvelle",
          createdAt: today,
          status: "nouvelle",
        }),
        // today + status NOT in set: dropped (status mismatch)
        order({
          _id: "orders_today_livree",
          createdAt: today,
          status: "livrée",
        }),
        // yesterday + matches status: dropped (date mismatch)
        order({
          _id: "orders_yesterday_nouvelle",
          createdAt: yesterday,
          status: "nouvelle",
        }),
        // yesterday + status mismatch: dropped (both mismatch)
        order({
          _id: "orders_yesterday_livree",
          createdAt: yesterday,
          status: "livrée",
        }),
      ];
      const out = filterOrders(
        input,
        { dateRange: "today", statuses: ["nouvelle"] },
        { now },
      );
      expect(out.map((o) => String(o._id))).toEqual(["orders_today_nouvelle"]);
    });
  });
});
