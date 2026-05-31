/**
 * F-CAMPAGNES [4/7] (#215) — `CampaignPreview`, the live preview of the final
 * rendered message + the bound-aware « Envoyer maintenant » button (parent
 * EPIC #145, ADR 0006 / PRD 80 §4).
 *
 * Issue body verbatim:
 *   - Affiche le message final selon le canal du template (mock push notif ou
 *     mock email HTML simple).
 *   - Compteur visuel `< 200 chars` (vert / rouge).
 *   - Indicateur violation si présent (inline, FR).
 *   - Bouton « Envoyer maintenant » actif ssi `violation === null`,
 *     désactivé sinon.
 *   - Mise à jour temps réel quand l'utilisateur modifie le `VariablesForm`
 *     (testée via la prop contrôlée `values`).
 *
 * Pinned via the same pure React-tree-serializer pattern as the rest of the
 * campagnes folder — vitest runs in `environment: "node"` (no jsdom, no RTL).
 * We walk the React tree and assert text + structural shape (mock surface,
 * counter color, button disabled state, violation copy).
 *
 * Acceptance criteria covered (#215):
 *   - AC3 « `CampaignPreview` affiche le message final + canal » — pinned
 *     by the « mock push » / « mock email » surfaces below.
 *   - AC4 « Bouton « Envoyer maintenant » actif ssi pas de violation » —
 *     pinned by the `disabled` toggle on the button.
 *   - AC5 « Bouton désactivé affiche un message clair (tooltip ou inline)
 *     expliquant la violation » — pinned by the FR violation copy + the
 *     `title` attribute on the disabled button.
 *   - AC6 « Le preview se met à jour en temps réel à chaque changement de
 *     variable » — pinned by re-rendering with different `values` and
 *     asserting the rendered text changes.
 *
 * MOAT / cross-tenant fuzz: this is a presentational preview — no query, no
 * mutation, no recipient identity. Isolation owned upstream.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { CampaignPreview } from "./CampaignPreview";

// ---------------------------------------------------------------------------
// React-tree serializer (same shape as the rest of the campagnes tests).
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

function findAll(
  n: SerializedNode,
  predicate: (s: SerializedNode) => boolean,
): SerializedNode[] {
  return flatten(n).filter(predicate);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TEMPLATE: TenantTemplateSummary = {
  id: "tpl_promo" as Id<"notificationTemplates">,
  key: "weekend_promo",
  label: "Promo weekend",
  body: "Bonjour {prenom_client}, -{discount}% chez {nom_resto} !",
  variables: ["prenom_client", "discount", "nom_resto"],
  deepLinkTarget: "catalogue",
  language: "fr",
  maxDiscountPercent: 50,
  containsAlcohol: false,
};

const NOOP = () => {};

// ---------------------------------------------------------------------------
// Tests — AC3 mock surface (push / email)
// ---------------------------------------------------------------------------
describe("CampaignPreview — AC3 surfaces the rendered message inside a channel mock", () => {
  it("renders the interpolated body inside a push-notification mock surface", () => {
    const tree = serialize(
      <CampaignPreview
        template={TEMPLATE}
        values={{
          prenom_client: "Sophie",
          discount: "20",
          nom_resto: "Buns & Bao",
        }}
        onSubmit={NOOP}
      />,
    );
    const text = allText(tree);
    // The rendered text MUST surface.
    expect(text).toContain("Bonjour Sophie, -20% chez Buns & Bao !");
    // The channel mock carries a `data-slot="campaign-preview-mock"` marker
    // so the assertion stays decoupled from styling. The tenant cascade
    // primary channel is push (`marketingCascade.ts: TENANT_CASCADE`).
    const mocks = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (
        (n.props as Record<string, unknown>)["data-slot"] ===
        "campaign-preview-mock"
      );
    });
    expect(mocks.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Tests — AC4 « < 200 chars » counter (color flip on overflow)
// ---------------------------------------------------------------------------
describe("CampaignPreview — AC4 character counter < 200", () => {
  it("surfaces the rendered length and the 200-char ceiling", () => {
    const tree = serialize(
      <CampaignPreview
        template={TEMPLATE}
        values={{
          prenom_client: "Sophie",
          discount: "20",
          nom_resto: "Buns & Bao",
        }}
        onSubmit={NOOP}
      />,
    );
    const text = allText(tree);
    // "Bonjour Sophie, -20% chez Buns & Bao !" = 39 chars
    expect(text).toMatch(/39\s*\/\s*200/);
  });

  it("flips the counter to a destructive color when the rendered message reaches 200 chars", () => {
    const longTemplate: TenantTemplateSummary = {
      ...TEMPLATE,
      body: `${"a".repeat(195)}{prenom_client}`,
      variables: ["prenom_client"],
    };
    const tree = serialize(
      <CampaignPreview
        template={longTemplate}
        values={{ prenom_client: "Sophie" }}
        onSubmit={NOOP}
      />,
    );
    // Marker `data-slot="campaign-preview-counter"` so the test pins the
    // counter element regardless of where it ends up in the layout.
    const counters = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (
        (n.props as Record<string, unknown>)["data-slot"] ===
        "campaign-preview-counter"
      );
    });
    expect(counters.length).toBeGreaterThanOrEqual(1);
    const counter = counters[0] as { props: Record<string, unknown> };
    const className = String(counter.props["className"] ?? "");
    // Destructive shadcn token — the counter MUST visibly turn red on
    // overflow (color flip per the issue body « vert / rouge »).
    expect(className).toMatch(/destructive|red/i);
  });

  it("renders the counter in a non-destructive color when the message is comfortably under 200 chars", () => {
    const tree = serialize(
      <CampaignPreview
        template={TEMPLATE}
        values={{
          prenom_client: "Sophie",
          discount: "20",
          nom_resto: "Buns & Bao",
        }}
        onSubmit={NOOP}
      />,
    );
    const counters = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (
        (n.props as Record<string, unknown>)["data-slot"] ===
        "campaign-preview-counter"
      );
    });
    expect(counters.length).toBeGreaterThanOrEqual(1);
    const counter = counters[0] as { props: Record<string, unknown> };
    const className = String(counter.props["className"] ?? "");
    expect(className).not.toMatch(/destructive|red/i);
  });
});

// ---------------------------------------------------------------------------
// Tests — AC5 violation indicator (inline FR copy)
// ---------------------------------------------------------------------------
describe("CampaignPreview — AC5 violation indicator", () => {
  it("surfaces a FR violation message when the rendered discount > 50 %", () => {
    const tree = serialize(
      <CampaignPreview
        template={TEMPLATE}
        values={{
          prenom_client: "S",
          discount: "80",
          nom_resto: "X",
        }}
        onSubmit={NOOP}
      />,
    );
    const text = allText(tree);
    // Load-bearing FR word — pin without coupling to the exact wording.
    expect(text).toMatch(/réduction/i);
  });

  it("surfaces NO violation message when the rendered message respects every bound", () => {
    const tree = serialize(
      <CampaignPreview
        template={TEMPLATE}
        values={{
          prenom_client: "Sophie",
          discount: "20",
          nom_resto: "Buns & Bao",
        }}
        onSubmit={NOOP}
      />,
    );
    const violations = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (
        (n.props as Record<string, unknown>)["data-slot"] ===
        "campaign-preview-violation"
      );
    });
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Tests — AC4 (button) bound-aware « Envoyer maintenant »
// ---------------------------------------------------------------------------
describe("CampaignPreview — AC4 bound-aware « Envoyer maintenant » button", () => {
  it("renders the button as ENABLED when there is no violation", () => {
    const tree = serialize(
      <CampaignPreview
        template={TEMPLATE}
        values={{
          prenom_client: "Sophie",
          discount: "20",
          nom_resto: "Buns & Bao",
        }}
        onSubmit={NOOP}
      />,
    );
    const buttons = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "button";
    });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    const submit = buttons[0] as { props: Record<string, unknown> };
    // Either `disabled === false` or `disabled === undefined` — both are
    // "enabled" in DOM-speak.
    expect(submit.props["disabled"]).not.toBe(true);
  });

  it("renders the button as DISABLED when the rendered message has a violation", () => {
    const tree = serialize(
      <CampaignPreview
        template={TEMPLATE}
        values={{
          prenom_client: "S",
          discount: "80", // > 50 → DISCOUNT_TOO_HIGH
          nom_resto: "X",
        }}
        onSubmit={NOOP}
      />,
    );
    const buttons = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "button";
    });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    const submit = buttons[0] as { props: Record<string, unknown> };
    expect(submit.props["disabled"]).toBe(true);
    // Tooltip-style affordance: the disabled button carries a `title`
    // attribute with the FR violation message, so the gérant understands
    // WHY the button is greyed out even without hovering on the inline
    // banner (issue body: « tooltip ou inline expliquant la violation »).
    const title = String(submit.props["title"] ?? "");
    expect(title.length).toBeGreaterThan(0);
    expect(title).toMatch(/réduction/i);
  });

  it("the button surfaces the FR « Envoyer maintenant » label", () => {
    const tree = serialize(
      <CampaignPreview template={TEMPLATE} values={{}} onSubmit={NOOP} />,
    );
    const text = allText(tree);
    expect(text).toMatch(/Envoyer maintenant/);
  });
});

// ---------------------------------------------------------------------------
// Tests — AC6 live update (re-render with different `values` mutates rendered)
// ---------------------------------------------------------------------------
describe("CampaignPreview — AC6 live update on `values` change", () => {
  it("re-renders the message text when `values` change (controlled prop branch)", () => {
    const treeA = serialize(
      <CampaignPreview
        template={TEMPLATE}
        values={{
          prenom_client: "Alice",
          discount: "10",
          nom_resto: "Chez Alice",
        }}
        onSubmit={NOOP}
      />,
    );
    const treeB = serialize(
      <CampaignPreview
        template={TEMPLATE}
        values={{
          prenom_client: "Bob",
          discount: "30",
          nom_resto: "Chez Bob",
        }}
        onSubmit={NOOP}
      />,
    );
    expect(allText(treeA)).toContain("Alice");
    expect(allText(treeA)).toContain("-10%");
    expect(allText(treeB)).toContain("Bob");
    expect(allText(treeB)).toContain("-30%");
    // The opposite identity does NOT leak across renders.
    expect(allText(treeA)).not.toContain("Bob");
    expect(allText(treeB)).not.toContain("Alice");
  });
});

// ---------------------------------------------------------------------------
// Tests — FR-only across every branch
// ---------------------------------------------------------------------------
describe("CampaignPreview — FR-only", () => {
  it("no English fallback in any branch", () => {
    const branches = [
      allText(
        serialize(
          <CampaignPreview
            template={TEMPLATE}
            values={{
              prenom_client: "Sophie",
              discount: "20",
              nom_resto: "Buns & Bao",
            }}
            onSubmit={NOOP}
          />,
        ),
      ),
      allText(
        serialize(
          <CampaignPreview
            template={TEMPLATE}
            values={{
              prenom_client: "S",
              discount: "80",
              nom_resto: "X",
            }}
            onSubmit={NOOP}
          />,
        ),
      ),
    ];
    for (const text of branches) {
      expect(text).not.toMatch(/\bSend now\b/i);
      expect(text).not.toMatch(/\bPreview\b/);
      expect(text).not.toMatch(/\bDiscount too high\b/i);
      expect(text).not.toMatch(/\bAlcohol\b/i);
    }
  });
});
