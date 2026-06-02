/**
 * F-STATS-DASHBOARD [3/8] (#253) — `StatsView`, the page shell of the resto
 * stats UI (parent EPIC #151, PRD 70 §4.10).
 *
 * The view is the pure presentational shell of `/t/[tenantId]/stats/page.tsx`
 * — it owns the title, the `RangePicker`, the « chiffres bruts » bloc
 * (`KpiCard` reuse), and the responsive grid of 5 placeholder cards (the real
 * graph blocks land in stories 4-8). It receives :
 *   - `tenantId`            — forwarded to children that need it ;
 *   - `range`               — the current `RangeDays` value ;
 *   - `onRangeChange`       — the page-owned setter for `useState` ;
 *   - `rangeAggregates`     — the tri-state Convex payload (undefined /
 *     null / object) for the « chiffres bruts » bloc ;
 *   - `onRetry`             — optional callback for the error branch.
 *
 * Same React-tree-serializer pattern as `campagnes-view.test.tsx` and
 * `mes-clients-view.test.tsx` (`apps/admin/vitest.config.ts` runs in
 * `environment: "node"`, no jsdom, no RTL).
 *
 * Pins :
 *   - title « Statistiques » on every branch (no blank flash) ;
 *   - the 5 placeholder card titles (PRD 70 §4.10 surfaces) ;
 *   - loading branch surfaces skeletons (Convex sentinel) ;
 *   - error branch surfaces the error banner + retry CTA ;
 *   - populated branch surfaces the formatted EUR + count.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { StatsView } from "./stats-view";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (same shape as `campagnes-view.test.tsx`).
// ---------------------------------------------------------------------------
type SerializedNode =
  | { type: string; props: Record<string, unknown>; children: SerializedNode[] }
  | { text: string }
  | null;

function isReactElement(node: unknown): node is ReactElement {
  return (
    typeof node === "object" &&
    node !== null &&
    "type" in node &&
    "props" in node
  );
}

function typeName(t: unknown): string {
  if (typeof t === "string") return t;
  if (typeof t === "function") {
    return (
      (t as { displayName?: string; name?: string }).displayName ??
      (t as { name?: string }).name ??
      "Anonymous"
    );
  }
  return String(t);
}

function serialize(node: ReactNode): SerializedNode {
  if (node === null || node === undefined || node === false || node === true) {
    return null;
  }
  if (typeof node === "string" || typeof node === "number") {
    return { text: String(node) };
  }
  if (Array.isArray(node)) {
    return {
      type: "ArrayFragment",
      props: {},
      children: node
        .map((c) => serialize(c))
        .filter((c): c is SerializedNode => c !== null),
    };
  }
  if (isReactElement(node)) {
    if (typeof node.type === "function") {
      const fn = node.type as (p: unknown) => ReactNode;
      try {
        return serialize(fn(node.props));
      } catch {
        return { type: typeName(node.type), props: {}, children: [] };
      }
    }
    const props = { ...(node.props as Record<string, unknown>) };
    const rawChildren = props.children as ReactNode | undefined;
    delete props.children;
    const children: SerializedNode[] = [];
    if (rawChildren !== undefined) {
      const list = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
      for (const c of list) {
        const s = serialize(c);
        if (s !== null) children.push(s);
      }
    }
    return { type: typeName(node.type), props, children };
  }
  return null;
}

function flatten(n: SerializedNode): SerializedNode[] {
  if (n === null) return [];
  if ("text" in n) return [n];
  return [n, ...n.children.flatMap(flatten)];
}

function allText(n: SerializedNode): string {
  return flatten(n)
    .map((x) => (x && "text" in x ? x.text : null))
    .filter((x): x is string => x !== null)
    .join(" ");
}

const TENANT_ID = "tenant_abc" as Id<"tenants">;

/*
 * `Revenus` was retired by #257 (replaced by the real `RevenuePerDayBlock`).
 * The other 4 placeholders (Top items / Heures de pointe / Conversion /
 * Direct vs Marketplace) were COMMENTÉS V1 par issue #389 — leur libellé
 * leakait la nomenclature dev (« (story 5/6/7/8) »). À ré-activer (côté
 * stats-view.tsx + ici) quand les slices F-STATS 5-8 atterriront avec leur
 * vraie data + un wording final propre.
 *
 * const PLACEHOLDER_TITLES = [
 *   "Top items",
 *   "Heures de pointe",
 *   "Conversion",
 *   "Direct vs Marketplace",
 * ] as const;
 */

describe("StatsView — F-STATS-DASHBOARD [3/8] (#253)", () => {
  it("renders the page title « Statistiques » on the populated branch", () => {
    const text = allText(
      serialize(
        StatsView({
          tenantId: TENANT_ID,
          range: 30,
          onRangeChange: () => {},
          rangeAggregates: { panierMoyen: 1500, totalCommandes: 12 },
          revenuePerDay: [{ date: "2026-05-01", revenue: 1000 }],
        }),
      ),
    );
    expect(text).toMatch(/Statistiques/);
  });

  it("renders the page title on the loading branch (no blank flash)", () => {
    const text = allText(
      serialize(
        StatsView({
          tenantId: TENANT_ID,
          range: 30,
          onRangeChange: () => {},
          rangeAggregates: undefined,
          revenuePerDay: undefined,
        }),
      ),
    );
    expect(text).toMatch(/Statistiques/);
  });

  it("does NOT surface dev-nomenclature placeholder titles in V1 (issue #389)", () => {
    // Inverse pin de l'ancien test : tant que les slices F-STATS 5-8 ne sont
    // pas livrées, AUCUN libellé qui leakait la nomenclature dev ne doit
    // remonter à l'écran. Re-flip ce test (et dé-commenter PLACEHOLDER_TITLES
    // ci-dessus + le bloc JSX dans stats-view.tsx) quand ces slices arrivent.
    const text = allText(
      serialize(
        StatsView({
          tenantId: TENANT_ID,
          range: 30,
          onRangeChange: () => {},
          rangeAggregates: { panierMoyen: 0, totalCommandes: 0 },
          revenuePerDay: [],
        }),
      ),
    );
    for (const title of [
      "Top items",
      "Heures de pointe",
      "Conversion",
      "Direct vs Marketplace",
    ]) {
      expect(text).not.toContain(title);
    }
    // Et plus aucune carte n'expose le slot `stats-placeholder-card`.
    const tree = serialize(
      StatsView({
        tenantId: TENANT_ID,
        range: 30,
        onRangeChange: () => {},
        rangeAggregates: { panierMoyen: 0, totalCommandes: 0 },
        revenuePerDay: [],
      }),
    );
    const hasPlaceholderSlot = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      const slot = (n.props as Record<string, unknown>)["data-slot"];
      return slot === "stats-placeholder-card";
    });
    expect(hasPlaceholderSlot).toBe(false);
  });

  it("loading branch (rangeAggregates === undefined) surfaces at least one skeleton", () => {
    const tree = serialize(
      StatsView({
        tenantId: TENANT_ID,
        range: 30,
        onRangeChange: () => {},
        rangeAggregates: undefined,
        revenuePerDay: undefined,
      }),
    );
    const hasSkeleton = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      const slot = (n.props as Record<string, unknown>)["data-slot"];
      return slot === "skeleton";
    });
    expect(hasSkeleton).toBe(true);
  });

  it("error branch (rangeAggregates === null) surfaces an error banner + retry CTA", () => {
    const onRetry = vi.fn();
    const tree = serialize(
      StatsView({
        tenantId: TENANT_ID,
        range: 30,
        onRangeChange: () => {},
        rangeAggregates: null,
        revenuePerDay: undefined,
        onRetry,
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Réessayer/);
    // Error banner is the dashboard-error slot we already use on the home.
    const hasErrorSlot = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      const slot = (n.props as Record<string, unknown>)["data-slot"];
      return slot === "stats-error";
    });
    expect(hasErrorSlot).toBe(true);
  });

  it("populated branch formats panierMoyen as EUR and totalCommandes as count", () => {
    const text = allText(
      serialize(
        StatsView({
          tenantId: TENANT_ID,
          range: 30,
          onRangeChange: () => {},
          // 23.45 € panier, 42 commandes
          rangeAggregates: { panierMoyen: 2345, totalCommandes: 42 },
          revenuePerDay: [],
        }),
      ),
    );
    // fr-FR currency formatting puts a non-breaking space + €
    expect(text).toMatch(/23,45/);
    expect(text).toMatch(/€/);
    expect(text).toMatch(/\b42\b/);
  });

  it("surfaces FR labels for the 'chiffres bruts' bloc (panier moyen + commandes)", () => {
    const text = allText(
      serialize(
        StatsView({
          tenantId: TENANT_ID,
          range: 30,
          onRangeChange: () => {},
          rangeAggregates: { panierMoyen: 1000, totalCommandes: 5 },
          revenuePerDay: [],
        }),
      ),
    );
    expect(text).toMatch(/Panier moyen/i);
    // Allow "Total commandes" / "Commandes" — the spec says "total commandes"
    expect(text).toMatch(/commandes/i);
  });

  it("renders the RangePicker with the 3 options (7 / 30 / 90 jours)", () => {
    const text = allText(
      serialize(
        StatsView({
          tenantId: TENANT_ID,
          range: 30,
          onRangeChange: () => {},
          rangeAggregates: { panierMoyen: 0, totalCommandes: 0 },
          revenuePerDay: [],
        }),
      ),
    );
    expect(text).toMatch(/7 jours/);
    expect(text).toMatch(/30 jours/);
    expect(text).toMatch(/90 jours/);
  });

  it('mounts the RevenuePerDayBlock in the grid (data-slot="revenue-per-day")', () => {
    const tree = serialize(
      StatsView({
        tenantId: TENANT_ID,
        range: 30,
        onRangeChange: () => {},
        rangeAggregates: { panierMoyen: 0, totalCommandes: 0 },
        revenuePerDay: [
          { date: "2026-05-01", revenue: 1000 },
          { date: "2026-05-02", revenue: 2000 },
        ],
      }),
    );
    const hasBlock = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      const slot = (n.props as Record<string, unknown>)["data-slot"];
      return slot === "revenue-per-day";
    });
    expect(hasBlock).toBe(true);
  });
});
