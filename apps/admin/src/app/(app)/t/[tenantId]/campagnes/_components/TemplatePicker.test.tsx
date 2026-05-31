/**
 * F-CAMPAGNES [2/7] (#188) — `TemplatePicker`, the grid+states wrapper above
 * `TemplateCard` for the campaigns picker (parent EPIC #145).
 *
 * Issue body verbatim: « `TemplatePicker` : grid responsive des `TemplateCard`,
 * branchée sur `listTenantTemplates`. Gère **loading** (skeleton cards) et
 * **vide** (« Aucun template disponible — contacte ton CSM pour en demander un »).
 *
 * Pinned via the pure React-tree-serializer pattern of slice 1 — vitest runs
 * in `environment: "node"` so we walk the React tree and assert text +
 * structure (no jsdom, no RTL).
 *
 * Acceptance criteria covered (#188):
 *   - AC2 « `TemplatePicker` liste les templates retournés par
 *     `listTenantTemplates` en grid responsive » — assert one `TemplateCard`
 *     per template AND that the outer wrapper carries a grid layout class.
 *   - AC3 « État vide affiché si la liste est vide, avec message FR clair »
 *     — empty array renders the issue-body verbatim copy
 *     « Aucun template disponible — contacte ton CSM pour en demander un »
 *     and surfaces ZERO `TemplateCard`.
 *   - AC4 « État loading affiché (skeleton cards) » — `undefined` renders
 *     N skeleton cards (carrying the shadcn `data-slot="skeleton"`) and NOT
 *     the empty-state copy.
 *   - AC7 « FR uniquement » — no English fallback.
 *
 * MOAT / cross-tenant fuzz: this is a presentational wrapper — `templates`
 * are passed in by the page (which calls `useTenantQuery` and inherits the
 * tenant-scoped `listTenantTemplates` isolation already pinned by
 * `campaigns.test.ts`). No fuzz needed here.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { TemplatePicker } from "./TemplatePicker";

// ---------------------------------------------------------------------------
// Serializer (same shape as the other tests in this folder).
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
// Fixtures
// ---------------------------------------------------------------------------
const TENANT_ID = "tenant_abc" as Id<"tenants">;

function makeTemplate(
  key: string,
  label: string,
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
  };
}

const TEMPLATES: TenantTemplateSummary[] = [
  makeTemplate("welcome_back", "Bienvenue de retour"),
  makeTemplate("happy_hour", "Happy Hour du jeudi"),
  makeTemplate("week_special", "Spécial weekend"),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TemplatePicker — F-CAMPAGNES [2/7] (#188)", () => {
  it("AC2 — populated branch surfaces every template's label", () => {
    const text = allText(
      serialize(
        <TemplatePicker tenantId={TENANT_ID} templates={TEMPLATES} />,
      ),
    );
    for (const t of TEMPLATES) {
      expect(text).toContain(t.label);
    }
  });

  it("AC2 — populated branch wraps cards in a grid container (responsive grid layout)", () => {
    const tree = serialize(
      <TemplatePicker tenantId={TENANT_ID} templates={TEMPLATES} />,
    );
    // Surface the grid via its tailwind classes — at minimum a `grid` token
    // is present somewhere in the outer wrapper. The responsive breakpoints
    // (sm:/md:/lg:) are not pinned exactly so a future polish can adjust
    // columns without breaking the test.
    const hasGrid = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      const cls = (n.props as Record<string, unknown>)["className"];
      return typeof cls === "string" && /\bgrid\b/.test(cls);
    });
    expect(hasGrid).toBe(true);
  });

  it("AC3 — empty branch surfaces the issue-body verbatim copy and ZERO cards", () => {
    const tree = serialize(
      <TemplatePicker tenantId={TENANT_ID} templates={[]} />,
    );
    const text = allText(tree);
    // Issue body verbatim: « Aucun template disponible — contacte ton CSM
    // pour en demander un ». We pin the load-bearing words ("aucun
    // template", "CSM") so a typographic polish doesn't fail the test.
    expect(text).toMatch(/aucun template disponible/i);
    expect(text).toMatch(/CSM/);
    // Empty state means no card surfaces are rendered.
    for (const t of TEMPLATES) {
      expect(text).not.toContain(t.label);
    }
  });

  it("AC4 — loading branch (templates === undefined) renders skeleton cards (not the empty state)", () => {
    const tree = serialize(
      <TemplatePicker tenantId={TENANT_ID} templates={undefined} />,
    );
    const text = allText(tree);
    // The empty-state copy MUST NOT leak during loading.
    expect(text).not.toMatch(/aucun template disponible/i);
    // The shadcn `<Skeleton/>` primitive carries `data-slot="skeleton"`
    // (see `components/ui/skeleton.tsx`). At least one skeleton MUST be
    // present so the user sees the affordance.
    const hasSkeleton = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      const slot = (n.props as Record<string, unknown>)["data-slot"];
      return slot === "skeleton";
    });
    expect(hasSkeleton).toBe(true);
  });

  it("AC4 — loading branch surfaces MULTIPLE skeleton cards (anticipates a grid, not a single line)", () => {
    const tree = serialize(
      <TemplatePicker tenantId={TENANT_ID} templates={undefined} />,
    );
    const skeletons = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      const slot = (n.props as Record<string, unknown>)["data-slot"];
      return slot === "skeleton";
    });
    // At least 2 skeletons → a "grid loading" rather than a "single
    // spinner". Strict enough to catch a regression that renders just one.
    expect(skeletons.length).toBeGreaterThanOrEqual(2);
  });

  it("AC5 — populated branch builds per-card hrefs pointing at `/t/[tenantId]/campagnes/[templateId]`", () => {
    const tree = serialize(
      <TemplatePicker tenantId={TENANT_ID} templates={TEMPLATES} />,
    );
    const anchors = flatten(tree).filter(
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    );
    // One anchor per template card (active state — all fixtures are active).
    expect(anchors).toHaveLength(TEMPLATES.length);
    const hrefs = anchors.map(
      (a) => (a as { props: Record<string, unknown> }).props["href"],
    );
    for (const t of TEMPLATES) {
      expect(hrefs).toContain(`/t/${TENANT_ID}/campagnes/${t.id}`);
    }
  });

  it("AC7 — FR-only: no English fallback across every branch", () => {
    const branches = [
      allText(
        serialize(
          <TemplatePicker tenantId={TENANT_ID} templates={undefined} />,
        ),
      ),
      allText(
        serialize(<TemplatePicker tenantId={TENANT_ID} templates={[]} />),
      ),
      allText(
        serialize(
          <TemplatePicker tenantId={TENANT_ID} templates={TEMPLATES} />,
        ),
      ),
    ];
    for (const text of branches) {
      expect(text).not.toMatch(/\bLoading\b/);
      expect(text).not.toMatch(/\bNo templates?\b/i);
      expect(text).not.toMatch(/\bAvailable\b/);
      expect(text).not.toMatch(/\bEmpty\b/i);
    }
  });
});
