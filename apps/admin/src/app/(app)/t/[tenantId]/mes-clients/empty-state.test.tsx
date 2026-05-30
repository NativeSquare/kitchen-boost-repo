/**
 * F-MES-CLIENTS [1/4] (#181) — `MesClientsEmptyState`, the presentational
 * empty state of the route.
 *
 * Pinned via the same pure React-tree-serializer pattern as
 * `QrPdfDocument.test.tsx` so the assertions run under the lean `node` vitest
 * env (no jsdom, no RTL). We never render to a DOM; we walk the React tree the
 * component returns and assert text content + structural shape.
 *
 * Acceptance criteria covered (#181):
 *   - AC1 « la route rend sans crash » → the function is callable and returns
 *     a non-null React element tree.
 *   - AC6 « Empty state lisible rendu par défaut (pas de loading infini) »
 *     → the visible copy contains both the title "Mes clients" AND the empty-
 *     state sentence promised by the issue body.
 *   - AC7 « Aucune liste nominative, aucun champ email/tel/prénom/adresse
 *     dans le DOM rendu » → the rendered tree contains NONE of the canonical
 *     PII field labels (anti-MOAT leak — PRD 70 §4.4 / Q90-Q2 / ADR 0010).
 *     The matchers are intentionally broad (case-insensitive substrings of
 *     the FR + EN labels we'd ever use) so a future careless addition fails
 *     loudly.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { MesClientsEmptyState } from "./empty-state";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (same shape as QrPdfDocument.test.tsx, trimmed
// to what we need here — no @react-pdf primitive aliasing).
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
      return serialize(fn(node.props));
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MesClientsEmptyState — F-MES-CLIENTS [1/4] (#181)", () => {
  it("AC1 — renders without crashing (callable as a pure function, returns a tree)", () => {
    const tree = serialize(MesClientsEmptyState());
    expect(tree).not.toBeNull();
  });

  it("AC6 — surfaces the page title « Mes clients »", () => {
    const text = allText(serialize(MesClientsEmptyState()));
    expect(text).toMatch(/Mes clients/i);
  });

  it("AC6 — surfaces the empty-state sentence promised by the issue body", () => {
    // The issue prescribes the EXACT shape of the empty-state copy:
    //   « Aucun client encore — vos KPI s'afficheront dès la première commande ».
    // We assert the load-bearing words ("aucun client" + "KPI" + "première
    // commande") rather than the literal string, so a minor copy polish (e.g.
    // typographic em-dash, smart quotes) doesn't fail the test, but a missing
    // empty state does.
    const text = allText(serialize(MesClientsEmptyState()));
    expect(text).toMatch(/aucun client/i);
    expect(text).toMatch(/KPI/);
    expect(text).toMatch(/premi[èe]re commande/i);
  });

  it("AC7 — does NOT leak PII field labels (no email / tel / prénom / adresse / nom)", () => {
    // The MOAT (PRD 70 §4.4 / Q90-Q2 / ADR 0010): V1 surfaces ZERO nominative
    // data — no list, no field, no label. This test catches a future careless
    // addition of "Email" / "Téléphone" / "Prénom" / "Adresse" labels in the
    // empty state itself (the rest of the page is also asserted by the route
    // structure: no list, no table — Slices 2-4 will add KPI tiles only).
    const text = allText(serialize(MesClientsEmptyState()));
    expect(text).not.toMatch(/\bemail\b/i);
    expect(text).not.toMatch(/\bt[ée]l[ée]phone\b/i);
    expect(text).not.toMatch(/\bphone\b/i);
    expect(text).not.toMatch(/\bpr[ée]nom\b/i);
    expect(text).not.toMatch(/\badresse\b/i);
    expect(text).not.toMatch(/\bnom\b/i);
    expect(text).not.toMatch(/\bname\b/i);
  });

  it("AC7 — does NOT render a table or list element (no nominative table surface)", () => {
    // Even an empty <table>/<ul>/<li> would betray intent for a future list
    // — the V1 view is KPI-only. Slices 2-4 will add tiles (<div>/cards), not
    // tables. If a real list lands here, the issue scope was violated.
    const tree = serialize(MesClientsEmptyState());
    const tags = flatten(tree)
      .map((n) => (n && "type" in n ? n.type : null))
      .filter((t): t is string => t !== null)
      .map((t) => t.toLowerCase());
    expect(tags).not.toContain("table");
    expect(tags).not.toContain("thead");
    expect(tags).not.toContain("tbody");
    expect(tags).not.toContain("tr");
    expect(tags).not.toContain("ul");
    expect(tags).not.toContain("ol");
    expect(tags).not.toContain("li");
  });
});
