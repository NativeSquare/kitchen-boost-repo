/**
 * F-SHELL-08 (#214) — `ImpersonationBanner` presentational tests.
 *
 * The component itself is pure-presentational (no Convex, no router). The
 * data hooks (`useSession`, `useCurrentTenantId`, `useAllTenants`) and the
 * navigation handler live in the parent shell wrapper. So we test the inner
 * presentational component (`ImpersonationBannerView`) directly with the
 * same React-tree serializer pattern as `UnauthorizedCard.test.tsx` —
 * vitest node env, no jsdom.
 *
 * What we pin:
 *   - When the decision is `hidden`, the view returns null (no DOM at all).
 *   - When `visible`, the banner surfaces the canonical text « Mode admin —
 *     tu consultes <name> » (the vocabulary from issue #214 + ADR 0014 §8).
 *   - The « Quitter » CTA renders as a clickable element and forwards to
 *     the injected `onQuit` handler.
 *   - The banner carries the KB accent gold/orange class hook
 *     (`data-slot="impersonation-banner"`) so downstream Playwright /
 *     a11y audits can latch onto it without coupling to Tailwind classes.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Id } from "@packages/backend/convex/_generated/dataModel";
import { ImpersonationBannerView } from "./impersonation-banner";

const TENANT_A = "tenants_aaa" as unknown as Id<"tenants">;

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

function findAllByPropSlot(
  n: SerializedNode,
  slot: string,
): Array<{ props: Record<string, unknown>; children: SerializedNode[] }> {
  return flatten(n)
    .filter(
      (
        x,
      ): x is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      } =>
        x !== null &&
        "type" in x &&
        (x.props as Record<string, unknown>)["data-slot"] === slot,
    )
    .map((x) => ({ props: x.props, children: x.children }));
}

function findAllOfType(
  n: SerializedNode,
  type: string,
): Array<{ props: Record<string, unknown>; children: SerializedNode[] }> {
  return flatten(n)
    .filter(
      (
        x,
      ): x is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      } => x !== null && "type" in x && x.type === type,
    )
    .map((x) => ({ props: x.props, children: x.children }));
}

describe("ImpersonationBannerView — F-SHELL-08 (#214)", () => {
  it("decision=hidden → renders nothing (null), no DOM at all", () => {
    const tree = serialize(
      ImpersonationBannerView({
        decision: { kind: "hidden" },
        onQuit: () => {},
      }),
    );
    expect(tree).toBeNull();
  });

  it("decision=visible → surfaces the canonical « Mode admin — tu consultes <name> » text", () => {
    const tree = serialize(
      ImpersonationBannerView({
        decision: {
          kind: "visible",
          tenantId: TENANT_A,
          tenantName: "L'Artisan",
        },
        onQuit: () => {},
      }),
    );
    const text = allText(tree);
    expect(text).toContain("Mode admin");
    expect(text).toContain("tu consultes");
    expect(text).toContain("L'Artisan");
  });

  it("renders the « Quitter » CTA and forwards clicks to onQuit", () => {
    let clicked = false;
    const tree = serialize(
      ImpersonationBannerView({
        decision: {
          kind: "visible",
          tenantId: TENANT_A,
          tenantName: "L'Artisan",
        },
        onQuit: () => {
          clicked = true;
        },
      }),
    );
    expect(allText(tree)).toContain("Quitter");

    const buttons = findAllOfType(tree, "button") as Array<{
      props: { onClick?: () => void };
    }>;
    const quit = buttons.find((b) => typeof b.props.onClick === "function");
    expect(quit).toBeDefined();
    quit?.props.onClick?.();
    expect(clicked).toBe(true);
  });

  it('exposes a stable `data-slot="impersonation-banner"` hook so Playwright / a11y audits can latch on without coupling to Tailwind classes', () => {
    const tree = serialize(
      ImpersonationBannerView({
        decision: {
          kind: "visible",
          tenantId: TENANT_A,
          tenantName: "L'Artisan",
        },
        onQuit: () => {},
      }),
    );
    const banners = findAllPropSlotOrTopLevel(tree, "impersonation-banner");
    expect(banners.length).toBeGreaterThanOrEqual(1);
  });
});

/**
 * Match either the top-level node carrying `data-slot` or any descendant —
 * lets the implementation choose whether the slot lives on the outer wrapper
 * or on an inner element, as long as ONE element bears the contract.
 */
function findAllPropSlotOrTopLevel(
  n: SerializedNode,
  slot: string,
): Array<{ props: Record<string, unknown>; children: SerializedNode[] }> {
  return findAllByPropSlot(n, slot);
}
