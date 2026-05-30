/**
 * F-MES-CLIENTS [2/4] (#186) — `MesClientsView`, pure presentational shell
 * of the "Mes clients" KPI page. Owns the four branches the page can be in,
 * and renders the 3 segments cards from `aggregateCustomerKPIs` (PRD 90 §3 /
 * PRD 70 §4.4).
 *
 * Same React-tree-serializer pattern as
 * `monitoring/monitoring-view.test.tsx` and `mes-clients/empty-state.test.tsx`:
 * `apps/admin/vitest.config.ts` runs in `environment: "node"` (no jsdom, no
 * RTL), so we walk the React tree the view returns and assert text content +
 * structural shape. Function components are unwrapped down to native tags; a
 * primitive that throws outside a real render (next/link, Radix Slot) surfaces
 * as a leaf with its component name so its presence stays observable.
 *
 * Acceptance criteria covered (#186):
 *   - AC1 « La page binde `aggregateCustomerKPIs` via `useTenantQuery` » → the
 *     page wiring is asserted at the source-file level (see `page.test.tsx`-
 *     style imports below) — here we pin the VIEW contract: with KPIs in
 *     hand, it renders the 3 cards.
 *   - AC2 « 3 cards segments rendues avec les bons chiffres et libellés
 *     (Actifs / Inactifs / VIP) » → assert each label + each number surfaces
 *     in the rendered tree.
 *   - AC3 « Loading skeleton rendu pendant le chargement initial » →
 *     `kpis === undefined` MUST render a skeleton (animate-pulse marker), NOT
 *     blank, NOT the empty state.
 *   - AC4 « Error fallback rendu si la query échoue (incl. accès refusé) »
 *     → `kpis === null` MUST render an error fallback. NO crash. NO leak of
 *     PII labels (the error path stays MOAT-safe — PRD 70 §4.4 / ADR 0010).
 *   - AC5 « Test : avec un mock retournant des KPI canoniques, les cards
 *     rendent les bons chiffres » → covered by the "renders cards" tests.
 *   - AC6 « Test anti-PII : scan regex sur le DOM rendu, aucun email / tel /
 *     prénom / adresse » → applied to EVERY branch (cards, loading, error,
 *     empty) so a future careless addition fails loudly.
 *   - AC7 « Empty state (slice 1) reste affiché si `total === 0` » → the
 *     `MesClientsEmptyState` is what the view returns when `kpis.total === 0`
 *     — assert the empty-state copy surfaces and the segment cards do NOT.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { CustomerKPIs } from "@packages/backend/convex/lib/customer/kpi";

import { MesClientsView } from "./mes-clients-view";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as
// monitoring/monitoring-view.test.tsx, trimmed to what we need here.
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
        // Some shadcn primitives (Slot, Radix wrappers) throw outside a real
        // React render — surface the component name as a leaf so its
        // presence is still observable in the tree.
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

function allClasses(n: SerializedNode): string {
  return flatten(n)
    .map((x) => {
      if (x === null || "text" in x) return null;
      const cls = x.props["className"];
      return typeof cls === "string" ? cls : null;
    })
    .filter((c): c is string => c !== null)
    .join(" ");
}

// ---------------------------------------------------------------------------
// Anti-PII assertion — reused across EVERY branch (cards, loading, error,
// empty) so a future careless addition of "Email"/"Téléphone"/"Prénom"/
// "Adresse"/"Nom" labels fails loudly on any state of the view. The matchers
// are intentionally broad (FR + EN, case-insensitive substrings) — the MOAT
// (PRD 70 §4.4 / Q90-Q2 / ADR 0010).
// ---------------------------------------------------------------------------
function assertNoPii(text: string): void {
  expect(text).not.toMatch(/\bemail\b/i);
  expect(text).not.toMatch(/\bt[ée]l[ée]phone\b/i);
  expect(text).not.toMatch(/\bphone\b/i);
  expect(text).not.toMatch(/\bpr[ée]nom\b/i);
  expect(text).not.toMatch(/\badresse\b/i);
  expect(text).not.toMatch(/\bnom\b/i);
  expect(text).not.toMatch(/\bname\b/i);
}

// ---------------------------------------------------------------------------
// Test fixtures — canonical KPI shapes.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MesClientsView — F-MES-CLIENTS [2/4] (#186)", () => {
  it("AC2 + AC5 — renders the 3 segment cards with the right labels AND numbers", () => {
    const tree = serialize(MesClientsView({ kpis: CANONICAL_KPIS }));
    const text = allText(tree);
    // Labels (FR — frozen V1 wording, PRD 90 §3 + issue body).
    expect(text).toMatch(/Actifs/);
    expect(text).toMatch(/Inactifs/);
    expect(text).toMatch(/VIP/);
    // Numbers from CANONICAL_KPIS — each segment count surfaces VERBATIM.
    // We assert them via word-boundary so "42" doesn't accidentally pass on a
    // "1042" leak somewhere; pinned to the rendered text.
    expect(text).toMatch(/\b42\b/);
    expect(text).toMatch(/\b17\b/);
    expect(text).toMatch(/\b8\b/);
  });

  it("AC2 — uses shadcn Card primitives (`components/ui/card`), not hand-rolled boxes", () => {
    const tree = serialize(MesClientsView({ kpis: CANONICAL_KPIS }));
    // The serializer unwraps function components down to native tags. shadcn
    // `Card` ends up as a `<div data-slot="card">` — assert the data-slot
    // markers surface (the cleanest cross-shadcn-version pin).
    const slots = flatten(tree)
      .map((n) => {
        if (n === null || "text" in n) return null;
        const ds = n.props["data-slot"];
        return typeof ds === "string" ? ds : null;
      })
      .filter((s): s is string => s !== null);
    const cardSlots = slots.filter((s) => s === "card");
    // Exactly 3 cards (one per segment) — no more (no random extra card),
    // no less (a regression to a single grid would betray the 3-card design).
    expect(cardSlots).toHaveLength(3);
  });

  it("AC6 — anti-PII: card branch leaks no email / tel / prénom / adresse / nom labels", () => {
    const text = allText(serialize(MesClientsView({ kpis: CANONICAL_KPIS })));
    assertNoPii(text);
  });

  it("AC6 — anti-PII: card branch renders no table / list element (KPI-only surface)", () => {
    // Even on the cards branch, the V1 view is KPI-only — no <table>, no
    // <ul>/<ol>/<li>. If those surface, the issue scope was violated.
    const types = flatten(serialize(MesClientsView({ kpis: CANONICAL_KPIS })))
      .map((n) => (n && "type" in n ? n.type : null))
      .filter((t): t is string => t !== null)
      .map((t) => t.toLowerCase());
    expect(types).not.toContain("table");
    expect(types).not.toContain("thead");
    expect(types).not.toContain("tbody");
    expect(types).not.toContain("tr");
    expect(types).not.toContain("ul");
    expect(types).not.toContain("ol");
    expect(types).not.toContain("li");
  });

  it("AC2 — surfaces the page title « Mes clients » on the cards branch", () => {
    // The h1 promised by slice 1 stays on the page when KPIs are present —
    // the cards REPLACE the empty-state body, not the page header.
    const text = allText(serialize(MesClientsView({ kpis: CANONICAL_KPIS })));
    expect(text).toMatch(/Mes clients/i);
  });

  it("AC3 — loading branch (kpis === undefined) renders a skeleton, NOT the empty state, NOT a crash", () => {
    const tree = serialize(MesClientsView({ kpis: undefined }));
    expect(tree).not.toBeNull();
    const text = allText(tree);
    // Empty state is NOT shown during loading — distinguishing flash vs zero.
    expect(text).not.toMatch(/aucun client encore/i);
    // The skeleton primitive (shadcn `Skeleton`) is `<div data-slot="skeleton"
    // class="bg-accent animate-pulse rounded-md">`. We pin its presence via
    // the `animate-pulse` className marker — that's the user-visible "loading"
    // affordance, and it's unique to the Skeleton primitive in the view.
    const classes = allClasses(tree);
    expect(classes).toMatch(/animate-pulse/);
  });

  it("AC3 — loading branch shows the page title (no blank flash, no jarring shell-swap)", () => {
    // The shell (title + container) stays mounted across loading → ready,
    // so the user doesn't see a blank flash before the cards land.
    const text = allText(serialize(MesClientsView({ kpis: undefined })));
    expect(text).toMatch(/Mes clients/i);
  });

  it("AC6 — anti-PII: loading branch leaks no email / tel / prénom / adresse / nom labels", () => {
    const text = allText(serialize(MesClientsView({ kpis: undefined })));
    assertNoPii(text);
  });

  it("AC4 — error branch (kpis === null) renders an explicit error fallback, NOT a crash", () => {
    const tree = serialize(MesClientsView({ kpis: null }));
    expect(tree).not.toBeNull();
    const text = allText(tree);
    // Issue body: "Error fallback explicite si la query échoue, incluant le
    // cas 'Accès refusé' propre côté front." We pin a load-bearing word
    // ("erreur" OR "impossible") so a polish stays free, but a missing
    // fallback fails loudly.
    expect(text).toMatch(/(erreur|impossible)/i);
    // Empty state and cards must NOT show on the error branch (otherwise an
    // error is indistinguishable from "0 clients" or fake data).
    expect(text).not.toMatch(/aucun client encore/i);
  });

  it("AC4 — error branch keeps the page title (so the user knows what page failed)", () => {
    const text = allText(serialize(MesClientsView({ kpis: null })));
    expect(text).toMatch(/Mes clients/i);
  });

  it("AC6 — anti-PII: error branch leaks no email / tel / prénom / adresse / nom labels (MOAT-safe even when broken)", () => {
    // Critical: the error message must not betray PII labels either — a
    // careless "impossible de charger emails clients" copy would leak intent.
    const text = allText(serialize(MesClientsView({ kpis: null })));
    assertNoPii(text);
  });

  it("AC7 — empty state (slice 1 regression): `total === 0` keeps rendering MesClientsEmptyState, NOT 3 zero cards", () => {
    const tree = serialize(MesClientsView({ kpis: EMPTY_KPIS }));
    const text = allText(tree);
    // The empty-state copy from slice 1 (#181) MUST still surface — the
    // contract is "if total === 0, fall back to the empty state".
    expect(text).toMatch(/aucun client encore/i);
    expect(text).toMatch(/KPI/);
    expect(text).toMatch(/premi[èe]re commande/i);
    // The 3 cards MUST NOT render alongside an empty state (would be a
    // confusing "0 actifs / 0 inactifs / 0 VIP" surface on top of "aucun
    // client encore" — pick one).
    const slots = flatten(tree)
      .map((n) => {
        if (n === null || "text" in n) return null;
        const ds = n.props["data-slot"];
        return typeof ds === "string" ? ds : null;
      })
      .filter((s): s is string => s !== null);
    expect(slots.filter((s) => s === "card")).toHaveLength(0);
  });

  it("AC6 — anti-PII: empty branch leaks no email / tel / prénom / adresse / nom labels", () => {
    const text = allText(serialize(MesClientsView({ kpis: EMPTY_KPIS })));
    assertNoPii(text);
  });
});
