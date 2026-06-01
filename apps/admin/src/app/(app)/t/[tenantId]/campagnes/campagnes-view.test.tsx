/**
 * F-CAMPAGNES [1/7] (#179) + [2/7] (#188) — `CampagnesView`, the page shell of
 * the resto campaign UI (parent EPIC #145, PRD 80 §4 + ADR 0006).
 *
 * Slice 1 (#179) — tracer-bullet: route + Convex tenant-scoped query + brute
 * list rendering, to prove the chain end-to-end.
 *
 * Slice 2 (#188) — dresses the brute list with the shadcn `TemplateCard` +
 * `TemplatePicker` (the picker owns the loading/empty/list branches now);
 * the page-level shell keeps only the title + the picker container. The
 * branch-level assertions live in `_components/TemplatePicker.test.tsx`; this
 * file keeps the LOAD-BEARING page-shell invariants:
 *   - the page title « Campagnes » is rendered on every branch (no blank
 *     flash, the shell stays mounted);
 *   - the `TemplatePicker` is the surface that owns each branch (so a future
 *     slice changing the picker contract fails ONE place, not two).
 *
 * Same React-tree-serializer pattern as `mes-clients-view.test.tsx` and
 * `monitoring-view.test.tsx`: `apps/admin/vitest.config.ts` runs in
 * `environment: "node"` (no jsdom, no RTL), so we walk the React tree the view
 * returns and assert text content + structural shape.
 *
 * Acceptance criteria covered:
 *   - AC1 (route accessible) — pinned at the source-file level via the page
 *     test (`page.test.ts`), not here.
 *   - AC2 (binds `useTenantQuery` on `listTenantTemplates`) — same.
 *   - AC3 (#179) « Les templates retournés sont rendus en liste minimale » —
 *     the view, given a non-empty array, MUST surface every template's label
 *     (the picker renders the cards; we assert the labels surface).
 *   - AC4 (#179) « État loading affiché » — `undefined` branch keeps the
 *     title and DOES NOT show the empty-state copy.
 *   - AC5 (#179) « État vide affiché » — empty array renders the verbatim
 *     « Aucun template disponible » copy (now polished with the CSM CTA in
 *     slice 2 per the issue body).
 *   - AC6 (#179) « FR uniquement (strings inline) » — every visible string
 *     is French.
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

const FORWARD_REF_TYPE = Symbol.for("react.forward_ref");

/** Whether `t` is a React `forwardRef` value (true for `next/link`'s
 *  `Link`). We don't invoke `Link.render(...)` because it uses hooks
 *  internally — instead we shim it to its public anchor shape. */
function isLinkLikeForwardRef(t: unknown): boolean {
  return (
    typeof t === "object" &&
    t !== null &&
    (t as { $$typeof?: symbol }).$$typeof === FORWARD_REF_TYPE
  );
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
    // `next/link`'s `Link` is a `forwardRef` whose `.render()` uses React
    // hooks internally — invoking it outside a real React render throws
    // « Invalid hook call ». But the public contract Link expresses IS a
    // `<a href>`, so we shim it: treat any forwardRef element with an
    // `href` prop as if it had rendered `<a href={...}>{children}</a>`.
    if (
      isLinkLikeForwardRef(node.type) &&
      "href" in (node.props as Record<string, unknown>)
    ) {
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
      return { type: "a", props, children };
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

const TENANT_ID = "tenant_abc" as Id<"tenants">;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CampagnesView — F-CAMPAGNES [1/7] (#179) + [2/7] (#188)", () => {
  it("AC3 — renders one item per template (the label surfaces verbatim)", () => {
    const text = allText(
      serialize(CampagnesView({ tenantId: TENANT_ID, templates: TEMPLATES })),
    );
    for (const t of TEMPLATES) {
      // Every template label MUST surface. Slice 2 (#188) renders a
      // `TemplateCard` per template; the label is the load-bearing
      // user-visible anchor inside each card.
      expect(text).toContain(t.label);
    }
  });

  it("AC3 — the page title « Campagnes » is rendered on the populated branch", () => {
    // The h1 anchors the page across all branches (loading / empty / list) —
    // pinned here for the list branch.
    const text = allText(
      serialize(CampagnesView({ tenantId: TENANT_ID, templates: TEMPLATES })),
    );
    expect(text).toMatch(/Campagnes/);
  });

  it("AC4 — loading branch (templates === undefined) renders a loading affordance, NOT the empty state, NOT a crash", () => {
    const tree = serialize(
      CampagnesView({ tenantId: TENANT_ID, templates: undefined }),
    );
    expect(tree).not.toBeNull();
    const text = allText(tree);
    // Empty-state copy MUST NOT show during loading (would confuse "nothing
    // yet" with "still fetching" — both branches stay distinct).
    expect(text).not.toMatch(/aucun template disponible/i);
    // FR loading affordance — slice 2 polishes the slice-1 "Chargement…"
    // copy with shadcn `<Skeleton/>` primitives (carry
    // `data-slot="skeleton"`). At least one skeleton MUST be present so the
    // user sees a loading affordance (AC4 acceptance criterion).
    const hasSkeleton = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      const slot = (n.props as Record<string, unknown>)["data-slot"];
      return slot === "skeleton";
    });
    expect(hasSkeleton).toBe(true);
  });

  it("AC4 — loading branch keeps the page title (no blank flash before data lands)", () => {
    const text = allText(
      serialize(CampagnesView({ tenantId: TENANT_ID, templates: undefined })),
    );
    expect(text).toMatch(/Campagnes/);
  });

  it("AC5 — empty branch (templates === []) renders « Aucun template disponible » verbatim (issue body wording)", () => {
    const text = allText(
      serialize(CampagnesView({ tenantId: TENANT_ID, templates: [] })),
    );
    // Issue body verbatim: « État vide (« Aucun template disponible ») »,
    // polished in slice 2 with « — contacte ton CSM pour en demander un ».
    expect(text).toMatch(/Aucun template disponible/);
    // No skeleton/loading should leak when we know there's nothing.
    const hasSkeleton = flatten(
      serialize(CampagnesView({ tenantId: TENANT_ID, templates: [] })),
    ).some((n) => {
      if (n === null || "text" in n) return false;
      const slot = (n.props as Record<string, unknown>)["data-slot"];
      return slot === "skeleton";
    });
    expect(hasSkeleton).toBe(false);
  });

  it("AC5 — empty branch keeps the page title (the shell stays mounted)", () => {
    const text = allText(
      serialize(CampagnesView({ tenantId: TENANT_ID, templates: [] })),
    );
    expect(text).toMatch(/Campagnes/);
  });

  it("AC6 — FR-only: every visible string is French (no English fallback)", () => {
    // Walk the three branches and assert no obvious English placeholders
    // sneak in. Strict but bounded: we don't lex the language, we just guard
    // against the usual copy/paste English ("Loading", "No templates",
    // "Error", "Templates", title-cased English headings).
    const branches = [
      allText(
        serialize(CampagnesView({ tenantId: TENANT_ID, templates: undefined })),
      ),
      allText(serialize(CampagnesView({ tenantId: TENANT_ID, templates: [] }))),
      allText(
        serialize(CampagnesView({ tenantId: TENANT_ID, templates: TEMPLATES })),
      ),
    ];
    for (const text of branches) {
      expect(text).not.toMatch(/\bLoading\b/);
      expect(text).not.toMatch(/\bNo templates?\b/i);
      expect(text).not.toMatch(/\bAvailable\b/);
    }
  });

  it("AC3 (#188) — populated branch surfaces one anchor per template (the picker built per-card links)", () => {
    // Slice 2 (#188) replaces the brute `<li>` list with the shadcn
    // `TemplatePicker` / `TemplateCard`. The load-bearing contract is now
    // "one navigation surface per template" — pinned via the per-card `<a>`
    // built from `/t/[tenantId]/campagnes/[templateId]`. The detailed
    // grid/loading/empty branches are pinned by `TemplatePicker.test.tsx`
    // and `TemplateCard.test.tsx`; here we only assert the page-level
    // delegation didn't lose the count. Slice 6 (#240) adds ONE extra
    // anchor — the « Historique » link to /campagnes/historique — so the
    // count is `templates.length + 1`.
    const tree = serialize(
      CampagnesView({ tenantId: TENANT_ID, templates: TEMPLATES }),
    );
    const anchors = flatten(tree).filter(
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    );
    expect(anchors).toHaveLength(TEMPLATES.length + 1);
  });

  it("AC (#240) — page shell exposes a « Historique » link pointing at /t/[tenantId]/campagnes/historique", () => {
    // Slice 6 (#240) adds a navigation entry from the picker shell to the
    // « historique des lancements » sub-route so the gérant can review past
    // campaign runs without leaving the campagnes section.
    const branches = [
      serialize(CampagnesView({ tenantId: TENANT_ID, templates: undefined })),
      serialize(CampagnesView({ tenantId: TENANT_ID, templates: [] })),
      serialize(CampagnesView({ tenantId: TENANT_ID, templates: TEMPLATES })),
    ];
    for (const tree of branches) {
      const text = allText(tree);
      expect(text).toMatch(/Historique/);
      const anchors = flatten(tree).filter(
        (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
      ) as Array<{ type: string; props: Record<string, unknown> }>;
      const hrefs = anchors
        .map((a) => a.props["href"])
        .filter((h): h is string => typeof h === "string");
      expect(hrefs).toContain(`/t/${TENANT_ID}/campagnes/historique`);
    }
  });
});
