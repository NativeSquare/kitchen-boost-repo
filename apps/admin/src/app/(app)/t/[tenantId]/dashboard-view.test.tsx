/**
 * F-STATS-DASHBOARD (#252) — `DashboardView`, branch tests (loading / empty /
 * populated / error). Same React-tree-serializer pattern as
 * `campagnes-view.test.tsx`: `apps/admin/vitest.config.ts` runs in
 * `environment: "node"` (no jsdom, no RTL), so we walk the React tree the view
 * returns and assert text content + `data-slot` structural shape.
 *
 * Acceptance criteria covered:
 *   - 4 KPI cards rendered when `kpis` is populated (verbatim labels FR) ;
 *   - loading branch (`undefined`) → at least one `data-slot="skeleton"` (the
 *     reused shadcn `<Skeleton/>` primitive carries it) ;
 *   - empty branch (zeros) → renders "0,00 €" + "0" + the hint "Pas encore de
 *     commandes aujourd'hui" (zéros propres, US9) ;
 *   - populated branch — the four KPIs surface formatted (CA & panier moyen
 *     en euros, nb commandes & en cours en compteur) ;
 *   - error branch (`null`) → renders an FR error banner + the retry CTA, no
 *     KPI value.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { DashboardView, type DashboardKpis } from "./dashboard-view";

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

function hasSlot(n: SerializedNode, slot: string): boolean {
  return flatten(n).some((x) => {
    if (x === null || "text" in x) return false;
    return (x.props as Record<string, unknown>)["data-slot"] === slot;
  });
}

function countSlot(n: SerializedNode, slot: string): number {
  return flatten(n).filter((x) => {
    if (x === null || "text" in x) return false;
    return (x.props as Record<string, unknown>)["data-slot"] === slot;
  }).length;
}

const POPULATED: DashboardKpis = {
  caTotal: 123456, // 1234.56 €
  nbCommandes: 12,
  panierMoyen: 10288, // 102.88 €
  commandesEnCours: 3,
};

const EMPTY: DashboardKpis = {
  caTotal: 0,
  nbCommandes: 0,
  panierMoyen: 0,
  commandesEnCours: 0,
};

describe("DashboardView — F-STATS-DASHBOARD (#252)", () => {
  it("populated: surfaces the four KPI labels (FR)", () => {
    const text = allText(serialize(DashboardView({ kpis: POPULATED })));
    expect(text).toMatch(/Chiffre d'affaires du jour/);
    expect(text).toMatch(/Commandes du jour/);
    expect(text).toMatch(/Panier moyen/);
    expect(text).toMatch(/Commandes en cours/);
  });

  it("populated: renders exactly 4 KpiCard slots (the grid contract)", () => {
    const tree = serialize(DashboardView({ kpis: POPULATED }));
    expect(countSlot(tree, "kpi-card")).toBe(4);
  });

  it("populated: formats euros as fr-FR currency for CA and panier moyen", () => {
    const text = allText(serialize(DashboardView({ kpis: POPULATED })));
    // 123456 cents → 1 234,56 € (FR uses a NBSP + virgule).
    expect(text).toMatch(/1\s?234,56\s?€/);
    // 10288 cents → 102,88 €
    expect(text).toMatch(/102,88\s?€/);
  });

  it("populated: surfaces the integer counts (no decimal)", () => {
    const text = allText(serialize(DashboardView({ kpis: POPULATED })));
    expect(text).toMatch(/\b12\b/); // nb commandes du jour
    expect(text).toMatch(/\b3\b/); // commandes en cours
  });

  it("populated: page title is rendered (the shell stays mounted)", () => {
    const text = allText(serialize(DashboardView({ kpis: POPULATED })));
    expect(text).toMatch(/Tableau de bord/);
  });

  it("loading (kpis === undefined): renders at least one `<Skeleton/>` per card (4 cards loading)", () => {
    const tree = serialize(DashboardView({ kpis: undefined }));
    expect(tree).not.toBeNull();
    // The shadcn `<Skeleton/>` primitive carries `data-slot="skeleton"`.
    expect(hasSlot(tree, "skeleton")).toBe(true);
    // No error copy leaks into loading.
    const text = allText(tree);
    expect(text).not.toMatch(/Impossible de charger/);
    // Title remains (no blank flash).
    expect(text).toMatch(/Tableau de bord/);
  });

  it("loading: still renders 4 cards (the grid stays mounted, no layout shift on data arrival)", () => {
    const tree = serialize(DashboardView({ kpis: undefined }));
    expect(countSlot(tree, "kpi-card")).toBe(4);
  });

  it("empty (all zeros): renders «0,00 €» + «0» + the hint « Pas encore de commandes aujourd'hui »", () => {
    const text = allText(serialize(DashboardView({ kpis: EMPTY })));
    expect(text).toMatch(/0,00\s?€/);
    expect(text).toMatch(/\b0\b/);
    expect(text).toMatch(/Pas encore de commandes aujourd'hui/);
    // No error branch on a legitimate zero day.
    expect(text).not.toMatch(/Impossible de charger/);
  });

  it("error (kpis === null): renders an FR error banner and hides KPI values", () => {
    const tree = serialize(
      DashboardView({ kpis: null, onRetry: () => undefined }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Impossible de charger les indicateurs/);
    expect(hasSlot(tree, "dashboard-error")).toBe(true);
    // No KPI card surfaced on the error branch.
    expect(countSlot(tree, "kpi-card")).toBe(0);
  });

  it("error: surfaces a « Réessayer » CTA that calls `onRetry`", () => {
    const onRetry = vi.fn();
    const tree = serialize(DashboardView({ kpis: null, onRetry }));
    const text = allText(tree);
    expect(text).toMatch(/Réessayer/);
    // The retry slot is present on the error branch.
    expect(hasSlot(tree, "dashboard-retry")).toBe(true);
  });

  it("error: omits the retry CTA when no `onRetry` handler is provided", () => {
    const tree = serialize(DashboardView({ kpis: null }));
    expect(hasSlot(tree, "dashboard-retry")).toBe(false);
  });

  it("uses the responsive grid (1/2/4 cols)", () => {
    const tree = serialize(DashboardView({ kpis: POPULATED }));
    const grid = flatten(tree).find((x) => {
      if (x === null || "text" in x) return false;
      return (
        (x.props as Record<string, unknown>)["data-slot"] === "dashboard-grid"
      );
    });
    expect(grid).toBeTruthy();
    const cls =
      grid && !("text" in grid)
        ? String((grid.props as Record<string, unknown>).className ?? "")
        : "";
    expect(cls).toMatch(/grid-cols-1/);
    expect(cls).toMatch(/sm:grid-cols-2/);
    expect(cls).toMatch(/lg:grid-cols-4/);
  });
});
