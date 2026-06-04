/**
 * #417 — KB Orders Historique (PRD 20 §8). Pure decision-functions test
 * suite for the 4 tabs (Toutes / Livrées-Collectées / Refusées / Manquées) +
 * the ID search + the date-range period filter + the auto_expired detail
 * note. Same split convention as `decide-order-card.test.ts` (#401) and
 * `decide-refuse-flow.test.ts` (#403/#413): React, Convex and Expo stay out
 * of the matrix so the truth table is pinned by node-env vitest, no jsdom,
 * no native mocks.
 *
 * The 4 tabs map to the closed set of TERMINAL statuses (PRD 20 §8) :
 *
 *  - `all`                 → no status restriction (passthrough),
 *  - `delivered_collected` → `livrée` + `collectée` (happy-path terminals),
 *  - `refused`             → `refusée` (human refus with motif),
 *  - `missed`              → `auto_expired` (system timeout 5 min, ADR 0016).
 *
 * The mapping is DISJOINT — `refusée` and `auto_expired` are signaux
 * orthogonaux (business vs operational), so the « Refusées » and
 * « Manquées » tabs never share a row even though both represent a refund.
 *
 * The home queue (`tenantOrders`, PRD 20 §2) shows IN-FLIGHT orders only —
 * the history shows TERMINAL orders only. The 4 tabs slice that terminal
 * set; the « Toutes » tab is the union, NOT the « show every status »
 * passthrough (a `nouvelle` order would not belong here even with `all`).
 */
import { describe, expect, it } from "vitest";

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import {
  DATE_RANGE_PRESETS,
  HISTORY_TERMINAL_STATUSES,
  ORDER_HISTORY_TABS,
  STATUSES_FOR_HISTORY_TAB,
  applyHistoryTabFilter,
  decideAutoExpiredDetailNote,
  filterOrdersByDateRange,
  isHistoryTerminal,
  searchOrdersById,
  type DateRangeKey,
  type OrderHistoryTabKey,
} from "./decide-history";

/** Helper: build a minimal `Doc<"orders">` row for filter tests. We only
 * touch the fields the predicates read (`status`, `_id`, `createdAt`).
 * The cast is local to the test file — production code never builds an
 * order doc by hand. */
function orderOf(partial: {
  _id?: string;
  status: Doc<"orders">["status"];
  createdAt?: number;
}): Doc<"orders"> {
  return {
    _id: (partial._id ?? "orders_abc123") as Doc<"orders">["_id"],
    status: partial.status,
    createdAt: partial.createdAt ?? 0,
  } as Doc<"orders">;
}

describe("#417 ORDER_HISTORY_TABS — PRD 20 §8 « Toutes | Livrées/Collectées | Refusées | Manquées »", () => {
  it("exposes the 4 tabs in the canonical PRD 20 §8 left-to-right order", () => {
    // The order is the customer-facing reading order; flipping it forces a
    // test failure so a reorder is visible at review time.
    expect(ORDER_HISTORY_TABS.map((t) => t.key)).toEqual([
      "all",
      "delivered_collected",
      "refused",
      "missed",
    ]);
  });

  it("uses the PRD-frozen French labels (gérant vocabulary)", () => {
    const byKey = new Map<OrderHistoryTabKey, string>(
      ORDER_HISTORY_TABS.map((t) => [t.key, t.label]),
    );
    expect(byKey.get("all")).toBe("Toutes");
    expect(byKey.get("delivered_collected")).toBe("Livrées / Collectées");
    expect(byKey.get("refused")).toBe("Refusées");
    expect(byKey.get("missed")).toBe("Manquées");
  });
});

describe("#417 STATUSES_FOR_HISTORY_TAB — the closed terminal mapping", () => {
  it("`all` → null (passthrough on the terminal set)", () => {
    // Null = no further status restriction WITHIN the terminal set.
    // Distinguishes « all terminals » from « empty » (an empty array).
    expect(STATUSES_FOR_HISTORY_TAB("all")).toBeNull();
  });

  it("`delivered_collected` → [livrée, collectée]", () => {
    // PRD 20 §5: the two happy-path terminals (delivery handed off + click &
    // collect picked up). Pinned exactly so a future enum addition surfaces
    // here as a test failure.
    expect(STATUSES_FOR_HISTORY_TAB("delivered_collected")).toEqual([
      "livrée",
      "collectée",
    ]);
  });

  it("`refused` → [refusée] — human refus only, NOT auto_expired", () => {
    // ADR 0016 — orthogonal signals. Mixing them would conflate business
    // (refus) with operations (timeout), which is the exact bug ADR 0016
    // fixes.
    expect(STATUSES_FOR_HISTORY_TAB("refused")).toEqual(["refusée"]);
  });

  it("`missed` → [auto_expired] — system timeout only, NOT refusée", () => {
    // PRD 20 §6b + ADR 0016 — the « Manquées » tab is the PRD's exact term
    // for `auto_expired` (« le gérant mesure son propre taux de cmds
    // ratées »).
    expect(STATUSES_FOR_HISTORY_TAB("missed")).toEqual(["auto_expired"]);
  });
});

describe("#417 HISTORY_TERMINAL_STATUSES + isHistoryTerminal — the terminal set", () => {
  it("contains exactly the 4 terminal statuses (livrée, collectée, refusée, auto_expired)", () => {
    // The history shows TERMINAL orders only. In-flight statuses
    // (`nouvelle`, `en préparation`, `prête`) live on the home queue
    // (`tenantOrders`); `en attente de paiement` is never surfaced to the
    // resto. `remise` is a transitional in-between for the delivery flow
    // (PRD 20 §5) — the courier hasn't dropped the bag yet, so it's NOT
    // historised here; the order moves to `livrée` once the courier
    // confirms.
    expect([...HISTORY_TERMINAL_STATUSES].sort()).toEqual(
      ["auto_expired", "collectée", "livrée", "refusée"].sort(),
    );
  });

  it("isHistoryTerminal returns true for every terminal status", () => {
    expect(isHistoryTerminal("livrée")).toBe(true);
    expect(isHistoryTerminal("collectée")).toBe(true);
    expect(isHistoryTerminal("refusée")).toBe(true);
    expect(isHistoryTerminal("auto_expired")).toBe(true);
  });

  it("isHistoryTerminal returns false for every NON-terminal status", () => {
    expect(isHistoryTerminal("en attente de paiement")).toBe(false);
    expect(isHistoryTerminal("nouvelle")).toBe(false);
    expect(isHistoryTerminal("en préparation")).toBe(false);
    expect(isHistoryTerminal("prête")).toBe(false);
    // `remise` = courier has the bag but hasn't completed (transitional).
    expect(isHistoryTerminal("remise")).toBe(false);
  });
});

describe("#417 applyHistoryTabFilter — orders ∩ tab status subset", () => {
  const sample: Doc<"orders">[] = [
    orderOf({ _id: "orders_1", status: "livrée" }),
    orderOf({ _id: "orders_2", status: "collectée" }),
    orderOf({ _id: "orders_3", status: "refusée" }),
    orderOf({ _id: "orders_4", status: "auto_expired" }),
    // Non-terminal noise: should be excluded from EVERY tab (even `all`)
    // because the history is terminal-only by definition.
    orderOf({ _id: "orders_5", status: "nouvelle" }),
    orderOf({ _id: "orders_6", status: "en préparation" }),
  ];

  it("`all` returns ONLY the terminal subset (excludes in-flight noise)", () => {
    // The home queue (`tenantOrders`) excludes terminal states by design;
    // symmetrically, the history excludes in-flight states. Without this
    // first guard, a `nouvelle` order would leak into the history's « all »
    // bucket — the same conflation the PRD §8 split prevents.
    const out = applyHistoryTabFilter(sample, "all");
    expect(out.map((o) => o._id)).toEqual([
      "orders_1",
      "orders_2",
      "orders_3",
      "orders_4",
    ]);
  });

  it("`delivered_collected` returns ONLY the happy-path terminals", () => {
    const out = applyHistoryTabFilter(sample, "delivered_collected");
    expect(out.map((o) => o._id)).toEqual(["orders_1", "orders_2"]);
  });

  it("`refused` returns ONLY refusée orders (orthogonal to auto_expired)", () => {
    const out = applyHistoryTabFilter(sample, "refused");
    expect(out.map((o) => o._id)).toEqual(["orders_3"]);
  });

  it("`missed` returns ONLY auto_expired orders (orthogonal to refusée)", () => {
    const out = applyHistoryTabFilter(sample, "missed");
    expect(out.map((o) => o._id)).toEqual(["orders_4"]);
  });

  it("preserves input order (DESC by createdAt — backend already sorts)", () => {
    // The backend `listOrders` returns NEWEST FIRST through `by_tenant
    // .order('desc')`. The tab filter must NOT defensively re-sort — it
    // would either be a no-op (correct) or shuffle a tie-broken order.
    const ordered: Doc<"orders">[] = [
      orderOf({ _id: "z", status: "livrée", createdAt: 300 }),
      orderOf({ _id: "y", status: "livrée", createdAt: 200 }),
      orderOf({ _id: "x", status: "collectée", createdAt: 100 }),
    ];
    expect(
      applyHistoryTabFilter(ordered, "delivered_collected").map((o) => o._id),
    ).toEqual(["z", "y", "x"]);
  });

  it("empty input → empty output for every tab", () => {
    for (const t of ORDER_HISTORY_TABS) {
      expect(applyHistoryTabFilter([], t.key)).toEqual([]);
    }
  });
});

describe("#417 searchOrdersById — case-insensitive ID substring (MOAT: ID only)", () => {
  const sample: Doc<"orders">[] = [
    orderOf({ _id: "orders_ABC123", status: "livrée" }),
    orderOf({ _id: "orders_def456", status: "livrée" }),
    orderOf({ _id: "orders_ABC999", status: "livrée" }),
  ];

  it("empty / whitespace query → passthrough", () => {
    expect(searchOrdersById(sample, "").map((o) => o._id)).toEqual([
      "orders_ABC123",
      "orders_def456",
      "orders_ABC999",
    ]);
    expect(searchOrdersById(sample, "   ").map((o) => o._id)).toEqual([
      "orders_ABC123",
      "orders_def456",
      "orders_ABC999",
    ]);
  });

  it("substring match is case-insensitive (gérant types « abc » lowercase)", () => {
    expect(searchOrdersById(sample, "abc").map((o) => o._id)).toEqual([
      "orders_ABC123",
      "orders_ABC999",
    ]);
    expect(searchOrdersById(sample, "ABC").map((o) => o._id)).toEqual([
      "orders_ABC123",
      "orders_ABC999",
    ]);
  });

  it("trims surrounding whitespace before matching", () => {
    expect(searchOrdersById(sample, "  def  ").map((o) => o._id)).toEqual([
      "orders_def456",
    ]);
  });

  it("no match → empty list", () => {
    expect(searchOrdersById(sample, "zzz")).toEqual([]);
  });

  it("preserves the relative input order of matched rows", () => {
    // Same DESC-by-createdAt discipline as applyHistoryTabFilter.
    expect(searchOrdersById(sample, "ABC").map((o) => o._id)).toEqual([
      "orders_ABC123",
      "orders_ABC999",
    ]);
  });
});

describe("#417 DATE_RANGE_PRESETS + filterOrdersByDateRange — period filter (PRD 20 §8)", () => {
  // Pinned "now" — a deterministic Friday 14:00 local time so the day-based
  // windows are predictable.
  const NOW = new Date(2026, 5, 12, 14, 0, 0, 0).getTime(); // Friday 2026-06-12 14:00

  it("exposes the 4 presets in reading order (today / 7d / 30d / tout)", () => {
    expect(DATE_RANGE_PRESETS).toEqual(["today", "7d", "30d", "tout"]);
  });

  it("`tout` is a passthrough (no date filter)", () => {
    const sample: Doc<"orders">[] = [
      orderOf({ _id: "old", status: "livrée", createdAt: 0 }),
      orderOf({ _id: "now", status: "livrée", createdAt: NOW }),
    ];
    expect(
      filterOrdersByDateRange(sample, "tout", { now: NOW }).map((o) => o._id),
    ).toEqual(["old", "now"]);
  });

  it("`today` keeps only today's orders (local-midnight inclusive, tomorrow exclusive)", () => {
    const startToday = new Date(2026, 5, 12, 0, 0, 0, 0).getTime();
    const justBefore = startToday - 1;
    const startTomorrow = new Date(2026, 5, 13, 0, 0, 0, 0).getTime();
    const sample: Doc<"orders">[] = [
      orderOf({ _id: "yesterday", status: "livrée", createdAt: justBefore }),
      orderOf({ _id: "midnight", status: "livrée", createdAt: startToday }),
      orderOf({ _id: "noon", status: "livrée", createdAt: NOW }),
      orderOf({ _id: "tomorrow", status: "livrée", createdAt: startTomorrow }),
    ];
    const out = filterOrdersByDateRange(sample, "today", { now: NOW }).map(
      (o) => o._id,
    );
    expect(out).toContain("midnight");
    expect(out).toContain("noon");
    expect(out).not.toContain("yesterday");
    expect(out).not.toContain("tomorrow");
  });

  it("`7d` keeps the last 7 local days (today + 6 previous)", () => {
    const startToday = new Date(2026, 5, 12, 0, 0, 0, 0).getTime();
    const day = 24 * 60 * 60 * 1000;
    const sample: Doc<"orders">[] = [
      orderOf({
        _id: "7daysAgo_inside",
        status: "livrée",
        createdAt: startToday - 6 * day,
      }),
      orderOf({
        _id: "8daysAgo_outside",
        status: "livrée",
        createdAt: startToday - 7 * day,
      }),
      orderOf({ _id: "today", status: "livrée", createdAt: NOW }),
    ];
    const out = filterOrdersByDateRange(sample, "7d", { now: NOW }).map(
      (o) => o._id,
    );
    expect(out).toContain("today");
    expect(out).toContain("7daysAgo_inside");
    expect(out).not.toContain("8daysAgo_outside");
  });

  it("`30d` keeps the last 30 local days (today + 29 previous)", () => {
    const startToday = new Date(2026, 5, 12, 0, 0, 0, 0).getTime();
    const day = 24 * 60 * 60 * 1000;
    const sample: Doc<"orders">[] = [
      orderOf({
        _id: "30daysAgo_inside",
        status: "livrée",
        createdAt: startToday - 29 * day,
      }),
      orderOf({
        _id: "31daysAgo_outside",
        status: "livrée",
        createdAt: startToday - 30 * day,
      }),
    ];
    const out = filterOrdersByDateRange(sample, "30d", { now: NOW }).map(
      (o) => o._id,
    );
    expect(out).toContain("30daysAgo_inside");
    expect(out).not.toContain("31daysAgo_outside");
  });

  it("preserves input order on every preset", () => {
    const startToday = new Date(2026, 5, 12, 0, 0, 0, 0).getTime();
    const sample: Doc<"orders">[] = [
      orderOf({ _id: "z", status: "livrée", createdAt: startToday + 1 }),
      orderOf({ _id: "y", status: "livrée", createdAt: startToday + 2 }),
    ];
    expect(
      filterOrdersByDateRange(sample, "today", { now: NOW }).map((o) => o._id),
    ).toEqual(["z", "y"]);
  });

  it("predicates compose commutatively with applyHistoryTabFilter + searchOrdersById", () => {
    // The page applies the three predicates in series; their composition is
    // a pure set intersection, so order is irrelevant. Pin it.
    const startToday = new Date(2026, 5, 12, 0, 0, 0, 0).getTime();
    const day = 24 * 60 * 60 * 1000;
    const sample: Doc<"orders">[] = [
      orderOf({
        _id: "orders_target_today",
        status: "auto_expired",
        createdAt: startToday + 1,
      }),
      orderOf({
        _id: "orders_target_old",
        status: "auto_expired",
        createdAt: startToday - 10 * day,
      }),
      orderOf({
        _id: "orders_wrong_status_today",
        status: "livrée",
        createdAt: startToday + 2,
      }),
    ];
    const expected = ["orders_target_today"];

    // tab → date → search
    let pipe1 = applyHistoryTabFilter(sample, "missed");
    pipe1 = filterOrdersByDateRange(pipe1, "today", { now: NOW });
    pipe1 = searchOrdersById(pipe1, "target");
    expect(pipe1.map((o) => o._id)).toEqual(expected);

    // search → date → tab
    let pipe2 = searchOrdersById(sample, "target");
    pipe2 = filterOrdersByDateRange(pipe2, "today", { now: NOW });
    pipe2 = applyHistoryTabFilter(pipe2, "missed");
    expect(pipe2.map((o) => o._id)).toEqual(expected);

    // date → search → tab
    let pipe3 = filterOrdersByDateRange(sample, "today", { now: NOW });
    pipe3 = searchOrdersById(pipe3, "target");
    pipe3 = applyHistoryTabFilter(pipe3, "missed");
    expect(pipe3.map((o) => o._id)).toEqual(expected);
  });
});

describe("#417 decideAutoExpiredDetailNote — PRD 20 §8 « message neutre si auto_expired »", () => {
  it("auto_expired → shows the neutral missed-timeout note", () => {
    // PRD 20 §8 demands a « message neutre » for the auto_expired case (the
    // gérant should not feel blamed; the system did the refund). The exact
    // wording is from the issue body: « non prise dans les 5 min ».
    const verdict = decideAutoExpiredDetailNote("auto_expired");
    expect(verdict).toEqual({
      kind: "show",
      heading: "Commande manquée",
      body: "Cette commande n'a pas été prise dans les 5 minutes — elle a été automatiquement annulée et le client a été remboursé.",
    });
  });

  it("every NON-auto_expired status → hides the note", () => {
    // The note is specific to the auto_expired terminal. For `refusée`, the
    // existing « motif » row carries the human-facing label (PRD 20 §8) —
    // not this note.
    expect(decideAutoExpiredDetailNote("refusée")).toEqual({ kind: "hide" });
    expect(decideAutoExpiredDetailNote("livrée")).toEqual({ kind: "hide" });
    expect(decideAutoExpiredDetailNote("collectée")).toEqual({ kind: "hide" });
    expect(decideAutoExpiredDetailNote("nouvelle")).toEqual({ kind: "hide" });
    expect(decideAutoExpiredDetailNote("en préparation")).toEqual({
      kind: "hide",
    });
    expect(decideAutoExpiredDetailNote("prête")).toEqual({ kind: "hide" });
    expect(decideAutoExpiredDetailNote("remise")).toEqual({ kind: "hide" });
    expect(decideAutoExpiredDetailNote("en attente de paiement")).toEqual({
      kind: "hide",
    });
  });
});

describe("#417 — DateRangeKey typing pinned (TS-level)", () => {
  // The DateRangeKey union exists at the TS level only; pin its runtime
  // values so a refactor that loses one of them fails this test.
  it("DATE_RANGE_PRESETS is exactly the DateRangeKey union", () => {
    const keys: DateRangeKey[] = ["today", "7d", "30d", "tout"];
    expect([...DATE_RANGE_PRESETS]).toEqual(keys);
  });
});
