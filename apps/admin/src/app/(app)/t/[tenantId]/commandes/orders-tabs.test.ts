/**
 * #415 — `orders-tabs`, the pure module backing the 4 history tabs
 * (`Toutes | Livrées-Collectées | Refusées | Manquées`) + the orderId
 * search predicate on the KB Admin Commandes page.
 *
 * PRD 20 §8 (KB Admin onglet Manquées + alerte ops si auto_expired > seuil):
 *   « Côté KB Admin (#415) : mêmes 4 onglets + métrique calculée par tenant
 *     + alerte ops si `auto_expired/jour` > seuil (~3-5 par défaut). »
 *
 * Two responsibilities, both pure (no React, no Convex), both tested in
 * isolation under `environment: "node"`:
 *
 *  1. The 4 tab keys + the canonical status set each tab maps to. The
 *     « Toutes » tab is a passthrough (status dimension untouched); the
 *     other three combine an exact subset of `orderStatus` values:
 *        - `delivered_collected` → `livrée` + `collectée`
 *        - `refused`             → `refusée`
 *        - `missed`              → `auto_expired`
 *     A future status addition surfaces here loudly (test pins the literal
 *     mapping; backend additions to `orderStatus` produce a TS error in
 *     `STATUSES_FOR_TAB`).
 *
 *  2. `searchOrdersById(orders, query)` — case-insensitive substring match
 *     over `String(order._id)`. Empty / whitespace-only query is a
 *     passthrough (preserves the existing filter pipeline shape). The
 *     filter is ID-only by design: PRD 90 / MOAT / ADR 0010 — customer
 *     names are NEVER indexed or queryable from KB Admin (the kb_manager
 *     view of customers is KPI-only, cf. PRD 70 §4.4); a name search would
 *     leak the moat. Issue body « par ID cmd, par nom client si possible
 *     avec MOAT » → MOAT forbids name, so we keep ID only.
 */
import { describe, expect, it } from "vitest";

import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import {
  ORDER_TABS,
  STATUSES_FOR_TAB,
  applyTabFilter,
  searchOrdersById,
  type OrderTabKey,
} from "./orders-tabs";

// ---------------------------------------------------------------------------
// Fixtures (re-used from orders-filtering.test.ts pattern)
// ---------------------------------------------------------------------------
const TENANT = "tenants_fixture" as unknown as Id<"tenants">;
const CUSTOMER = "customers_fixture" as unknown as Id<"customers">;

function order(
  partial: Partial<Omit<Doc<"orders">, "_id">> & {
    _id: string;
    status?: Doc<"orders">["status"];
  },
): Doc<"orders"> {
  const { _id, ...rest } = partial;
  return {
    _id: _id as unknown as Id<"orders">,
    _creationTime: 0,
    tenantId: TENANT,
    customerId: CUSTOMER,
    status: "nouvelle",
    mode: "delivery",
    source: "direct",
    createdAt: 0,
    ...rest,
  } as Doc<"orders">;
}

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------
describe("ORDER_TABS — 4 tabs in canonical PRD 20 §8 order", () => {
  it("exposes the 4 tabs in left-to-right reading order", () => {
    // PRD 20 §8: « Toutes | Livrées/Collectées | Refusées | Manquées ».
    // We pin the canonical order so a future refactor that scrambles them
    // (e.g. alphabetising) fails here — the tab order encodes the gérant's
    // mental model (most-used on the left).
    expect(ORDER_TABS.map((t) => t.key)).toEqual<OrderTabKey[]>([
      "all",
      "delivered_collected",
      "refused",
      "missed",
    ]);
  });

  it("labels each tab in French (UI copy)", () => {
    // Pinning the labels so a vocabulary drift away from PRD 20 §8 surfaces
    // here. « Manquées » is the load-bearing word — that's the whole point
    // of #415 (vs the generic « refusée » bucket).
    const labels = Object.fromEntries(ORDER_TABS.map((t) => [t.key, t.label]));
    expect(labels.all).toBe("Toutes");
    expect(labels.delivered_collected).toBe("Livrées / Collectées");
    expect(labels.refused).toBe("Refusées");
    expect(labels.missed).toBe("Manquées");
  });
});

describe("STATUSES_FOR_TAB — mapping tab key → orderStatus subset", () => {
  it("« Toutes » is a passthrough (no status restriction)", () => {
    // Returning `null` (vs `[]`) so the page-level applier can distinguish
    // « no filter on this dimension » (passthrough) from « empty set »
    // (matches nothing) — same convention as orders-filtering's
    // « `statuses.length === 0` ⇒ passthrough ».
    expect(STATUSES_FOR_TAB("all")).toBeNull();
  });

  it("« Livrées / Collectées » maps to the two happy terminal states", () => {
    // PRD 20 §5: `livrée` (mode livraison) + `collectée` (click & collect)
    // are the two happy-path terminals — semantically equivalent (cmd
    // completed, money settled). The tab merges them so the gérant scans
    // the full « completed cmds » bucket without juggling modes.
    expect(STATUSES_FOR_TAB("delivered_collected")?.sort()).toEqual([
      "collectée",
      "livrée",
    ]);
  });

  it("« Refusées » maps to the human-refusal terminal only", () => {
    // PRD 20 §6a: human refusal with motif (rupture / fermeture / surcharge
    // / autre). DISTINCT from `auto_expired` (ADR 0016 orthogonal signals).
    // Keeping them in separate tabs is the whole #415 point.
    expect(STATUSES_FOR_TAB("refused")).toEqual(["refusée"]);
  });

  it("« Manquées » maps to auto_expired ONLY (PRD 20 §6b + ADR 0016)", () => {
    // The load-bearing assertion of #415. `auto_expired` ≠ `refusée` —
    // refusing this would conflate ops signals (tablette HS, Khan AFK)
    // with business signals (rupture chronique), the very bug ADR 0016
    // explicitly fixes.
    expect(STATUSES_FOR_TAB("missed")).toEqual(["auto_expired"]);
  });
});

// ---------------------------------------------------------------------------
// applyTabFilter
// ---------------------------------------------------------------------------
describe("applyTabFilter — restrict orders to the tab's status subset", () => {
  const fixtures = [
    order({ _id: "o_new", status: "nouvelle" }),
    order({ _id: "o_delivered", status: "livrée" }),
    order({ _id: "o_collected", status: "collectée" }),
    order({ _id: "o_refused", status: "refusée" }),
    order({ _id: "o_missed", status: "auto_expired" }),
  ];

  it("« Toutes » returns the input untouched (passthrough, preserves order)", () => {
    // The backend hands orders DESC by createdAt; the tab must NOT resort
    // (a future regression that wraps `.sort()` here would silently break
    // the table's chronological scan, same discipline as filterOrders).
    const out = applyTabFilter(fixtures, "all");
    expect(out).toEqual(fixtures);
    expect(out[0]?._id).toBe(fixtures[0]?._id);
  });

  it("« Livrées / Collectées » keeps only the two happy terminals", () => {
    const out = applyTabFilter(fixtures, "delivered_collected");
    expect(out.map((o) => String(o._id)).sort()).toEqual([
      "o_collected",
      "o_delivered",
    ]);
  });

  it("« Refusées » keeps only refusée (NOT auto_expired — orthogonal signals)", () => {
    // The DISTINCTION pinning: a regression that merges the two terminals
    // back together (« refusée OR auto_expired ») would silently re-introduce
    // the bug ADR 0016 fixes. We assert auto_expired is NOT in the refused
    // tab and refusée is NOT in the missed tab.
    const refused = applyTabFilter(fixtures, "refused");
    expect(refused.map((o) => String(o._id))).toEqual(["o_refused"]);
    const missed = applyTabFilter(fixtures, "missed");
    expect(missed.map((o) => String(o._id))).toEqual(["o_missed"]);
  });

  it("returns [] when input is []", () => {
    expect(applyTabFilter([], "missed")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// searchOrdersById (ID-only, MOAT)
// ---------------------------------------------------------------------------
describe("searchOrdersById — case-insensitive substring on order _id (MOAT)", () => {
  // Issue body « par ID cmd, par nom client si possible avec MOAT ». MOAT /
  // ADR 0010 / PRD 70 §4.4: the kb_manager view of customers is KPI-only —
  // names are NEVER indexed or queryable from KB Admin. A name search would
  // leak the moat (it'd expose a customer rolodex one resto-issued search
  // at a time). #415 therefore restricts the search to order id.
  const o1 = order({ _id: "orders_abc123" });
  const o2 = order({ _id: "orders_xyz789" });
  const o3 = order({ _id: "orders_ABC_uppercase" });

  it("empty query is a passthrough (returns input as-is)", () => {
    const input = [o1, o2];
    expect(searchOrdersById(input, "")).toEqual(input);
  });

  it("whitespace-only query is a passthrough (« trim then test »)", () => {
    expect(searchOrdersById([o1, o2], "   ")).toEqual([o1, o2]);
  });

  it("matches a substring of the order id, case-insensitive", () => {
    const out = searchOrdersById([o1, o2, o3], "abc");
    // case-insensitive: both « orders_abc123 » and « orders_ABC_uppercase »
    // surface — the gérant is searching by the order id Stripe receipt
    // shows, not by an exact match.
    expect(out.map((o) => String(o._id))).toEqual([
      "orders_abc123",
      "orders_ABC_uppercase",
    ]);
  });

  it("returns [] when no order matches", () => {
    expect(searchOrdersById([o1, o2], "nope")).toEqual([]);
  });

  it("preserves input order (no defensive sort)", () => {
    // Same discipline as `filterOrders` / `applyTabFilter` — the backend
    // sorted by createdAt DESC; the search must not reorder.
    const out = searchOrdersById([o2, o1], "orders");
    expect(out.map((o) => String(o._id))).toEqual([
      "orders_xyz789",
      "orders_abc123",
    ]);
  });
});
