/**
 * F-COMMANDES-PAGE-SHELL (#222) — `CommandesView`, pure presentational shell of
 * the tenant Commandes page (header + placeholder, first tracer-bullet of EPIC
 * F-COMMANDES #141).
 *
 * Slice 1 (this issue) ships ONLY the scaffold (issue body « pas de données
 * encore — juste le scaffold prouvant que la route est joignable, le tenant
 * context est résolu via le segment `[tenantId]`, et la page hérite du layout
 * chrome-less »). The live orders table, filters, detail modal, refund flow,
 * and CSV export land in subsequent slices of EPIC #141; this view stays
 * deliberately dumb and renders the « La liste arrive dans le prochain slice »
 * placeholder so the navigation surface is in place from day one without
 * misleading the gérant into believing the data is wired.
 *
 * What this test pins (acceptance criteria #222) :
 *   - AC3 « Le header "Commandes" est affiché » → the page title surfaces on
 *     every render branch.
 *   - The placeholder copy explicitly signals the slice-1 intent (« la liste
 *     arrive dans le prochain slice ») so future agents and Alex can grep for
 *     it when wiring the table.
 *   - A stable `data-slot="commandes-page-placeholder"` marker is exposed so
 *     subsequent slices (and tests) can target the placeholder without
 *     scraping copy.
 *
 * Split out of `page.tsx` (which is a thin wrapper around the view, matching
 * the menu / mes-clients / parametres pattern) so vitest can pin every branch
 * under `environment: "node"` — same React-tree-serializer pattern as
 * `parametres-view.test.tsx`. Scope is `apps/admin/src/app/(app)/t/[tenantId]/
 * commandes/` only (issue #222 hard constraint).
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { CommandesView } from "./commandes-view";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as parametres-view.test.tsx,
// trimmed to what we need here.
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

function dataSlots(n: SerializedNode): string[] {
  return flatten(n)
    .map((x) => {
      if (x === null || "text" in x) return null;
      const ds = x.props["data-slot"];
      return typeof ds === "string" ? ds : null;
    })
    .filter((s): s is string => s !== null);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CommandesView — F-COMMANDES-PAGE-SHELL (#222)", () => {
  it("AC3 — surfaces the page title « Commandes »", () => {
    const text = allText(serialize(CommandesView()));
    expect(text).toMatch(/Commandes/);
  });

  it("AC1 — renders the slice-1 placeholder copy (« La liste arrive dans le prochain slice »)", () => {
    // The placeholder is the explicit slice-1 signal — it tells the gérant
    // (and any future agent picking up the next F-COMMANDES slice) that the
    // table is not yet wired. Pinning the copy keeps the intent visible.
    const text = allText(serialize(CommandesView()));
    expect(text).toMatch(/La liste arrive dans le prochain slice/);
  });

  it("AC1 — placeholder carries a stable `data-slot` marker so subsequent slices can target it", () => {
    const slots = dataSlots(serialize(CommandesView()));
    expect(slots).toContain("commandes-page-placeholder");
  });

  it("AC7 — the view renders without crashing (no props required this slice — scaffold only)", () => {
    // The view is a pure function with no props in slice 1 (no data wired
    // yet). It must serialise to a non-null tree on a bare call — this is
    // the minimal « render the skeleton without crash » test demanded by the
    // issue body.
    const tree = serialize(CommandesView());
    expect(tree).not.toBeNull();
  });
});
