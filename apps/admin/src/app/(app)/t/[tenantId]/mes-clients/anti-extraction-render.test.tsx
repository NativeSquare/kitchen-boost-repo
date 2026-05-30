/**
 * F-MES-CLIENTS [4/4] (#202) — DOM render scan: anti-extraction affordances.
 *
 * Companion to `anti-pii-static-guard.test.ts`. The static guard catches
 * field-name leakage in source; this one catches USER-FACING affordances
 * that, even if labelled innocuously in code, would surface as an
 * « Exporter », « Filtrer », or « Voir détail » button in the rendered tree.
 *
 * The view's rendered surface across all four branches (cards / loading /
 * error / empty) is exhaustively scanned for:
 *   - forbidden button labels (case-insensitive): voir détail, exporter,
 *     filtrer, télécharger, csv, download, export.
 *   - extraction-style HTML primitives where they have no business living
 *     in a KPI-only view: a `<select>` (filter picker), a `<input
 *     type="search">` / `<input type="email">` / `<input type="tel">`,
 *     a `<a download>` link.
 *
 * The route-segment Error Boundary (`error.tsx`) DOES render exactly one
 * legitimate `<button>`: « Réessayer » (Next-provided `reset()`). The test
 * pins that this is the ONLY button, with this exact label — anything else
 * fails. (A « Réessayer » is a UX retry, not an extraction affordance — the
 * spec for the Boundary is unchanged from slice 2.)
 *
 * The same React-tree-serializer pattern as the other tests in this folder
 * (no jsdom, no RTL — `apps/admin/vitest.config.ts` runs in `environment:
 * "node"`).
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { CustomerKPIs } from "@packages/backend/convex/lib/customer/kpi";

// `error.tsx` uses `useEffect` for ops tracing. In our pure node serializer
// (no real React renderer), we stub useEffect to a no-op so calling the
// component as a function returns its tree synchronously without throwing
// "Invalid hook call". This is the same trick used by static-render tests
// throughout the apps/admin suite. Must run BEFORE the component import.
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useEffect: () => undefined,
  };
});

import { MesClientsView } from "./mes-clients-view";
import { MesClientsEmptyState } from "./empty-state";
import MesClientsError from "./error";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (same shape as mes-clients-view.test.tsx).
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

function elementsOfType(
  n: SerializedNode,
  typeLower: string,
): Array<Exclude<SerializedNode, null | { text: string }>> {
  return flatten(n).filter(
    (node): node is Exclude<SerializedNode, null | { text: string }> =>
      node !== null && "type" in node && node.type.toLowerCase() === typeLower,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const CANONICAL_KPIS: CustomerKPIs = {
  segments: { actif: 42, inactif: 17, vip: 8 },
  reachability: { push: 30, email: 50, sms: 12 },
  total: 67,
  newThisMonth: 5,
  returnRate: 0.42,
};

const EMPTY_KPIS: CustomerKPIs = {
  segments: { actif: 0, inactif: 0, vip: 0 },
  reachability: { push: 0, email: 0, sms: 0 },
  total: 0,
  newThisMonth: 0,
  returnRate: 0,
};

/** Forbidden user-facing button labels (case-insensitive substrings). */
const FORBIDDEN_LABELS: ReadonlyArray<RegExp> = [
  /voir\s*d[ée]tail/i,
  /\bexporter\b/i,
  /\bfiltrer\b/i,
  /\bt[ée]l[ée]charger\b/i,
  /\bdownload\b/i,
  /\bexport\b/i,
  /\bcsv\b/i,
];

/**
 * Assert that every `<button>` rendered by `tree` has a label that does NOT
 * match any forbidden pattern. `<a>` elements are also screened (a styled
 * link can play the role of a button).
 */
function assertNoForbiddenButtonOrLink(
  tree: SerializedNode,
  branchHint: string,
): void {
  const buttonsAndLinks = [
    ...elementsOfType(tree, "button"),
    ...elementsOfType(tree, "a"),
  ];
  for (const el of buttonsAndLinks) {
    const text = allText(el);
    for (const pattern of FORBIDDEN_LABELS) {
      expect(
        pattern.test(text),
        `${branchHint}: forbidden affordance « ${text} » matches ${pattern}`,
      ).toBe(false);
    }
  }
}

/**
 * Assert that no extraction-style HTML primitive lives in the tree:
 *   - `<select>` (a filter picker)
 *   - `<input type="search" | "email" | "tel">`
 *   - `<a download>` (download link)
 */
function assertNoExtractionPrimitive(
  tree: SerializedNode,
  branchHint: string,
): void {
  expect(elementsOfType(tree, "select"), `${branchHint}: <select>`).toEqual([]);
  const inputs = elementsOfType(tree, "input");
  for (const inp of inputs) {
    const t = inp.props["type"];
    if (typeof t === "string") {
      expect(
        ["search", "email", "tel"].includes(t.toLowerCase()),
        `${branchHint}: <input type="${t}"> is an extraction primitive`,
      ).toBe(false);
    }
  }
  const anchors = elementsOfType(tree, "a");
  for (const a of anchors) {
    expect(
      "download" in a.props,
      `${branchHint}: <a download> is a download affordance`,
    ).toBe(false);
  }
}

// ---------------------------------------------------------------------------
// Tests — every branch of the route surface.
// ---------------------------------------------------------------------------
describe("F-MES-CLIENTS [4/4] (#202) — render scan: no extraction affordances", () => {
  it("MesClientsView (cards branch): no « Voir détail », « Exporter », « Filtrer », « CSV », « Télécharger » buttons or links", () => {
    const tree = serialize(MesClientsView({ kpis: CANONICAL_KPIS }));
    assertNoForbiddenButtonOrLink(tree, "cards branch");
  });

  it("MesClientsView (cards branch): no <select> / search-input / download-link", () => {
    const tree = serialize(MesClientsView({ kpis: CANONICAL_KPIS }));
    assertNoExtractionPrimitive(tree, "cards branch");
  });

  it("MesClientsView (cards branch): NO `<button>` rendered AT ALL (KPI-only surface, zero interactivity)", () => {
    // V1 spec: the cards branch is purely passive — no « Réessayer » here
    // (that's the error branch), no filter, no detail click-through. A
    // future careless `<button>` is the most likely vector for extraction.
    const tree = serialize(MesClientsView({ kpis: CANONICAL_KPIS }));
    expect(elementsOfType(tree, "button")).toEqual([]);
  });

  it("MesClientsView (loading branch): no forbidden buttons / links", () => {
    const tree = serialize(MesClientsView({ kpis: undefined }));
    assertNoForbiddenButtonOrLink(tree, "loading branch");
    assertNoExtractionPrimitive(tree, "loading branch");
    expect(elementsOfType(tree, "button")).toEqual([]);
  });

  it("MesClientsView (error branch, kpis === null): no forbidden buttons / links, NO <button> from the view itself", () => {
    // The view's null-error branch renders a passive error message; the
    // « Réessayer » button is on the route-segment Error Boundary
    // (`error.tsx`), NOT here. Pin: zero buttons on the view's null branch.
    const tree = serialize(MesClientsView({ kpis: null }));
    assertNoForbiddenButtonOrLink(tree, "error branch (view)");
    assertNoExtractionPrimitive(tree, "error branch (view)");
    expect(elementsOfType(tree, "button")).toEqual([]);
  });

  it("MesClientsView (empty branch, total === 0): no forbidden buttons / links, NO <button> rendered", () => {
    const tree = serialize(MesClientsView({ kpis: EMPTY_KPIS }));
    assertNoForbiddenButtonOrLink(tree, "empty branch");
    assertNoExtractionPrimitive(tree, "empty branch");
    expect(elementsOfType(tree, "button")).toEqual([]);
  });

  it("MesClientsEmptyState: no forbidden buttons / links, NO <button> rendered", () => {
    const tree = serialize(MesClientsEmptyState());
    assertNoForbiddenButtonOrLink(tree, "empty-state");
    assertNoExtractionPrimitive(tree, "empty-state");
    expect(elementsOfType(tree, "button")).toEqual([]);
  });

  it("MesClientsError (route-segment Boundary): renders exactly ONE button, labelled « Réessayer »", () => {
    // Spec (slice 2): the Boundary mounts one `<button onClick={reset}>`
    // labelled « Réessayer ». MOAT-aligned: a retry is not extraction. Pin
    // the exact shape so a future regression that adds an « Exporter
    // l'erreur » or « Télécharger les logs » button fails loudly.
    const tree = serialize(
      MesClientsError({
        error: new Error("test"),
        reset: () => undefined,
      }),
    );
    const buttons = elementsOfType(tree, "button");
    expect(buttons).toHaveLength(1);
    expect(allText(buttons[0])).toMatch(/r[ée]essayer/i);
  });

  it("MesClientsError: the lone button is NOT an extraction affordance (no forbidden label)", () => {
    const tree = serialize(
      MesClientsError({
        error: new Error("test"),
        reset: () => undefined,
      }),
    );
    assertNoForbiddenButtonOrLink(tree, "error-boundary");
    assertNoExtractionPrimitive(tree, "error-boundary");
  });
});
