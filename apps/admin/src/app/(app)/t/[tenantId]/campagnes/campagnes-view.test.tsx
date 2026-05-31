/**
 * F-CAMPAGNES [1/7] (#179) — `CampagnesView`, pure presentational shell of the
 * first tracer-bullet of the resto campaign UI (parent EPIC #145, PRD 80 §4 +
 * ADR 0006).
 *
 * Tracer-bullet contract — issue body verbatim: « afficher la liste BRUTE des
 * templates retournés (titre + JSON dump suffit à ce stade). Aucun composant
 * carte, aucune navigation, aucun style — juste la chaîne complète route
 * tenant-scopée → query Convex tenant-scopée → rendu liste ». Subsequent slices
 * (2..7) wire the picker, form, preview, send, result.
 *
 * Same React-tree-serializer pattern as `mes-clients-view.test.tsx` and
 * `monitoring-view.test.tsx`: `apps/admin/vitest.config.ts` runs in
 * `environment: "node"` (no jsdom, no RTL), so we walk the React tree the view
 * returns and assert text content + structural shape.
 *
 * Acceptance criteria covered (#179):
 *   - AC1 (route accessible) — pinned at the source-file level via the page
 *     test (`page.test.ts`), not here (we test the pure view's branches).
 *   - AC2 (binds `useTenantQuery` on `listTenantTemplates`) — same, page-level.
 *   - AC3 « Les templates retournés sont rendus en liste minimale (un item =
 *     un nom de template) » — the view, given a non-empty array, MUST surface
 *     every template's label (and the issue body explicitly accepts the JSON
 *     dump alongside — we assert label, leave the JSON as an explicit detail).
 *   - AC4 « État loading affiché tant que la query résout » — `undefined`
 *     branch MUST render a loading affordance, NOT the empty state, NOT crash.
 *   - AC5 « État vide affiché si la query retourne `[]` » — empty array
 *     renders the « Aucun template disponible » copy verbatim.
 *   - AC6 « FR uniquement (strings inline) » — every visible string is French
 *     (no English fallback like "Loading..." / "No templates").
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { CampagnesView } from "./campagnes-view";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as mes-clients-view.test.tsx,
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

// ---------------------------------------------------------------------------
// Fixtures — minimal `TenantTemplateSummary` shapes (the backend's narrow
// projection of a campaign template).
// ---------------------------------------------------------------------------
function makeTemplate(
  key: string,
  label: string,
  overrides: Partial<TenantTemplateSummary> = {},
): TenantTemplateSummary {
  return {
    id: `tpl_${key}` as Id<"notificationTemplates">,
    key,
    label,
    body: `Body for ${label}`,
    variables: [],
    deepLinkTarget: "catalogue",
    language: "fr",
    maxDiscountPercent: 0,
    containsAlcohol: false,
    ...overrides,
  };
}

const TEMPLATES: TenantTemplateSummary[] = [
  makeTemplate("welcome_back", "Bienvenue de retour"),
  makeTemplate("happy_hour", "Happy Hour du jeudi"),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CampagnesView — F-CAMPAGNES [1/7] (#179) tracer-bullet", () => {
  it("AC3 — renders one item per template (the label surfaces verbatim)", () => {
    const text = allText(serialize(CampagnesView({ templates: TEMPLATES })));
    for (const t of TEMPLATES) {
      // Every template label MUST surface. The issue body accepts « titre +
      // JSON dump » — we pin the title at minimum (load-bearing). A future
      // slice will polish the card layout; the contract is "one item per
      // template, the label is the user-visible anchor".
      expect(text).toContain(t.label);
    }
  });

  it("AC3 — the page title « Campagnes » is rendered on the populated branch", () => {
    // The h1 anchors the page across all branches (loading / empty / list) —
    // pinned here for the list branch.
    const text = allText(serialize(CampagnesView({ templates: TEMPLATES })));
    expect(text).toMatch(/Campagnes/);
  });

  it("AC4 — loading branch (templates === undefined) renders a loading affordance, NOT the empty state, NOT a crash", () => {
    const tree = serialize(CampagnesView({ templates: undefined }));
    expect(tree).not.toBeNull();
    const text = allText(tree);
    // Empty-state copy MUST NOT show during loading (would confuse "nothing
    // yet" with "still fetching" — the tracer-bullet pins both distinctly).
    expect(text).not.toMatch(/aucun template disponible/i);
    // FR loading affordance — accept "Chargement" or a generic "…" while
    // staying strict on FR (AC6 — no English fallback). Pinned via a
    // forgiving regex so the implementation can pick "Chargement…" or
    // "Chargement des templates…".
    expect(text).toMatch(/Chargement/i);
  });

  it("AC4 — loading branch keeps the page title (no blank flash before data lands)", () => {
    const text = allText(serialize(CampagnesView({ templates: undefined })));
    expect(text).toMatch(/Campagnes/);
  });

  it("AC5 — empty branch (templates === []) renders « Aucun template disponible » verbatim (issue body wording)", () => {
    const text = allText(serialize(CampagnesView({ templates: [] })));
    // Issue body verbatim: « État vide (« Aucun template disponible ») ».
    expect(text).toMatch(/Aucun template disponible/);
    // No loading copy should leak when we know there's nothing.
    expect(text).not.toMatch(/Chargement/i);
  });

  it("AC5 — empty branch keeps the page title (the shell stays mounted)", () => {
    const text = allText(serialize(CampagnesView({ templates: [] })));
    expect(text).toMatch(/Campagnes/);
  });

  it("AC6 — FR-only: every visible string is French (no English fallback)", () => {
    // Walk the three branches and assert no obvious English placeholders
    // sneak in. Strict but bounded: we don't lex the language, we just guard
    // against the usual copy/paste English ("Loading", "No templates",
    // "Error", "Templates", title-cased English headings).
    const branches = [
      allText(serialize(CampagnesView({ templates: undefined }))),
      allText(serialize(CampagnesView({ templates: [] }))),
      allText(serialize(CampagnesView({ templates: TEMPLATES }))),
    ];
    for (const text of branches) {
      expect(text).not.toMatch(/\bLoading\b/);
      expect(text).not.toMatch(/\bNo templates?\b/i);
      expect(text).not.toMatch(/\bAvailable\b/);
    }
  });

  it("AC3 — populated branch surfaces a list landmark (one DOM item per template)", () => {
    // The issue body accepts « titre + JSON dump » — i.e. we don't need
    // shadcn Cards yet. But we DO need a list with one item per template so
    // a future slice replaces the rendering without losing the count.
    const tree = serialize(CampagnesView({ templates: TEMPLATES }));
    const liNodes = flatten(tree).filter(
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "li",
    );
    // Exactly as many `<li>` as templates — pinned so a regression that
    // accidentally renders one big blob (no list) fails loudly.
    expect(liNodes).toHaveLength(TEMPLATES.length);
  });
});
