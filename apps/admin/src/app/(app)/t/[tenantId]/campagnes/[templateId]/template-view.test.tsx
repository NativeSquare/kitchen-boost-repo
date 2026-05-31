/**
 * F-CAMPAGNES [3/7] (#205) — `TemplateView`, the pure presentational shell
 * of the per-template route (parent EPIC #145).
 *
 * Pinned via the same pure React-tree-serializer pattern as the other
 * `campagnes/*` views — vitest runs in `environment: "node"`. We walk the
 * tree and assert text + structural shape.
 *
 * Acceptance criteria covered (#205):
 *   - AC1 « Route /t/[tenantId]/campagnes/[templateId] accessible » — the
 *     route exists at the expected path (pinned by `page.test.ts`).
 *   - View-side: every branch (loading / not-found / loaded) keeps the page
 *     mounted with a load-bearing title; the loaded branch hands off to
 *     `VariablesForm`.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { TemplateView } from "./template-view";

// ---------------------------------------------------------------------------
// Serializer (same as campagnes-view.test.tsx).
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

function isForwardRef(t: unknown): boolean {
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
    if (isForwardRef(node.type)) {
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
      // `next/link`'s `Link` is a forwardRef whose render uses hooks
      // internally; shim it to its public anchor shape (same trick as
      // `TemplateCard.test.tsx`) so the test can pin the back link.
      if ("href" in (node.props as Record<string, unknown>)) {
        return { type: "a", props, children };
      }
      return {
        type: typeName(
          (node.type as { displayName?: string; name?: string }).displayName ??
            (node.type as { name?: string }).name ??
            "ForwardRef",
        ),
        props,
        children,
      };
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
const TEMPLATE_ID = "tpl_promo" as Id<"notificationTemplates">;

const TEMPLATE: TenantTemplateSummary = {
  id: TEMPLATE_ID,
  key: "weekend_promo",
  label: "Promo weekend",
  body: "Ce {jour}, -{discount}% chez {nom_resto} !",
  variables: ["jour", "discount", "nom_resto"],
  deepLinkTarget: "catalogue",
  language: "fr",
  maxDiscountPercent: 30,
  containsAlcohol: false,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TemplateView — F-CAMPAGNES [3/7] (#205)", () => {
  it("loading branch (template === undefined) does NOT show the not-found copy or crash", () => {
    const tree = serialize(
      TemplateView({
        tenantId: TENANT_ID,
        templateId: TEMPLATE_ID,
        template: undefined,
      }),
    );
    expect(tree).not.toBeNull();
    const text = allText(tree);
    expect(text).not.toMatch(/Template introuvable/i);
    // FR loading affordance — shadcn `<Skeleton/>` carries
    // `data-slot="skeleton"`. At least one MUST surface.
    const hasSkeleton = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "skeleton";
    });
    expect(hasSkeleton).toBe(true);
  });

  it("not-found branch (template === null) surfaces a FR « Template introuvable » message", () => {
    const text = allText(
      serialize(
        TemplateView({
          tenantId: TENANT_ID,
          templateId: TEMPLATE_ID,
          template: null,
        }),
      ),
    );
    expect(text).toMatch(/Template introuvable/i);
    // The not-found branch MUST surface a back link to the picker.
    const anchors = flatten(
      serialize(
        TemplateView({
          tenantId: TENANT_ID,
          templateId: TEMPLATE_ID,
          template: null,
        }),
      ),
    ).filter(
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    );
    expect(anchors.length).toBeGreaterThanOrEqual(1);
  });

  it("loaded branch surfaces the template label + the raw template body (preview anchor)", () => {
    const text = allText(
      serialize(
        TemplateView({
          tenantId: TENANT_ID,
          templateId: TEMPLATE_ID,
          template: TEMPLATE,
        }),
      ),
    );
    // The label is the load-bearing anchor — pinned at the page level
    // (the form's per-field labels are pinned in `VariablesForm.test.tsx`,
    // which renders the pure `VariablesFormView` directly).
    expect(text).toContain(TEMPLATE.label);
    // The raw body surfaces as a preview anchor so the gérant sees the
    // template they're filling — pinned here so a future polish that
    // hides the body without replacing it stays loud.
    expect(text).toContain(TEMPLATE.body);
  });

  it("loaded branch surfaces a delegated `VariablesForm` (the form's shell), and a back link to the picker", () => {
    const tree = serialize(
      TemplateView({
        tenantId: TENANT_ID,
        templateId: TEMPLATE_ID,
        template: TEMPLATE,
      }),
    );
    // The stateful `VariablesForm` shell uses `useState` internally so
    // its inner React tree CANNOT be walked under `environment: "node"`
    // (the serializer's `try/catch` swallows the hook throw and returns
    // an opaque node). What we CAN pin is that the view delegates to
    // the form by type name — if a regression drops the form entirely,
    // this fails.
    const formNode = flatten(tree).find((n) => {
      if (n === null || "text" in n) return false;
      return n.type === "VariablesForm";
    });
    expect(formNode).toBeDefined();
    // A back link to the picker MUST surface so the gérant can leave.
    const anchors = flatten(tree).filter(
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    );
    const backHrefs = anchors
      .map((a) => (a as { props: Record<string, unknown> }).props["href"])
      .filter((h): h is string => typeof h === "string");
    expect(backHrefs).toContain(`/t/${TENANT_ID}/campagnes`);
  });

  it("FR-only across every branch", () => {
    const branches = [
      allText(
        serialize(
          TemplateView({
            tenantId: TENANT_ID,
            templateId: TEMPLATE_ID,
            template: undefined,
          }),
        ),
      ),
      allText(
        serialize(
          TemplateView({
            tenantId: TENANT_ID,
            templateId: TEMPLATE_ID,
            template: null,
          }),
        ),
      ),
      allText(
        serialize(
          TemplateView({
            tenantId: TENANT_ID,
            templateId: TEMPLATE_ID,
            template: TEMPLATE,
          }),
        ),
      ),
    ];
    for (const text of branches) {
      expect(text).not.toMatch(/\bLoading\b/);
      expect(text).not.toMatch(/\bNot found\b/i);
      expect(text).not.toMatch(/\bAvailable\b/);
      expect(text).not.toMatch(/\bSubmit\b/);
    }
  });
});
