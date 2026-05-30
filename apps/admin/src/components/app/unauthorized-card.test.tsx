/**
 * Tests for `UnauthorizedCard` — the shared auth-refusal surface (3 sites:
 * tenant gate, monitoring, no-tenant). The component is pure-presentational
 * (no router / Convex), so we reuse the lean React-tree serializer pattern
 * established by `QrGeneratorView.test.tsx` (vitest node env, no jsdom).
 *
 * What we pin:
 *   - Default title is "Accès non autorisé" (the canonical vocabulary).
 *   - Title can be overridden by the caller.
 *   - Description string surfaces.
 *   - Primary action renders as `<a>` when `href` is set; `<button>` when
 *     only `onClick` is set. Click forwards to the handler.
 *   - Both actions can be rendered side-by-side.
 *   - No-actions case still renders a clean card (no empty footer DOM).
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { UnauthorizedCard } from "./unauthorized-card";

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

function findAllByType(n: SerializedNode, type: string): SerializedNode[] {
  return flatten(n).filter(
    (
      x,
    ): x is {
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    } => x !== null && "type" in x && x.type === type,
  );
}

describe("UnauthorizedCard", () => {
  it("renders the default title « Accès non autorisé » when none is passed", () => {
    const tree = serialize(
      UnauthorizedCard({ description: "Some description." }),
    );
    expect(allText(tree)).toContain("Accès non autorisé");
  });

  it("renders the caller's title when one is passed", () => {
    const tree = serialize(
      UnauthorizedCard({
        title: "Page réservée à l'équipe KitchenBoost",
        description: "Some description.",
      }),
    );
    const text = allText(tree);
    expect(text).toContain("Page réservée à l'équipe KitchenBoost");
    expect(text).not.toContain("Accès non autorisé");
  });

  it("surfaces the description string in the rendered tree", () => {
    const tree = serialize(
      UnauthorizedCard({
        description:
          "Ce resto n'est pas dans votre périmètre. Revenez à votre resto.",
      }),
    );
    expect(allText(tree)).toContain("Ce resto n'est pas dans votre périmètre.");
  });

  it("renders the primary action as an <a> when `href` is set", () => {
    const tree = serialize(
      UnauthorizedCard({
        description: "x",
        primaryAction: { label: "Aller à mon resto", href: "/t/tenant_a" },
      }),
    );
    const anchors = findAllByType(tree, "a");
    expect(anchors).toHaveLength(1);
    const [a] = anchors;
    expect((a as { props: Record<string, unknown> }).props.href).toBe(
      "/t/tenant_a",
    );
    expect(allText(tree)).toContain("Aller à mon resto");
  });

  it("renders the primary action as a <button> when only `onClick` is set, and forwards clicks", () => {
    let clicked = false;
    const tree = serialize(
      UnauthorizedCard({
        description: "x",
        primaryAction: {
          label: "Se déconnecter",
          onClick: () => {
            clicked = true;
          },
        },
      }),
    );
    const buttons = findAllByType(tree, "button") as Array<{
      props: { onClick?: () => void };
    }>;
    const cta = buttons.find((b) => typeof b.props.onClick === "function");
    expect(cta).toBeDefined();
    cta?.props.onClick?.();
    expect(clicked).toBe(true);
  });

  it("renders both actions side by side when both are passed", () => {
    const tree = serialize(
      UnauthorizedCard({
        description: "x",
        primaryAction: { label: "Aller à mon resto", href: "/t/tenant_a" },
        secondaryAction: { label: "Se déconnecter", onClick: () => {} },
      }),
    );
    const text = allText(tree);
    expect(text).toContain("Aller à mon resto");
    expect(text).toContain("Se déconnecter");
  });

  it("renders no action footer when neither primary nor secondary is passed", () => {
    const tree = serialize(UnauthorizedCard({ description: "x" }));
    // EmptyContent is the action slot — should not be in the tree when no
    // action is passed (avoids an empty footer with margin/padding).
    const emptyContents = findAllByType(tree, "EmptyContent");
    expect(emptyContents).toHaveLength(0);
  });
});
