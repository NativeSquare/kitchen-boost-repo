/**
 * Tiny React-tree serializer shared by the Kanban `_components/*` tests
 * (`prospect-card.test.tsx`, `kanban-column.test.tsx`,
 * `active-clients-tab.test.tsx`, `prospect-search-bar.test.tsx`).
 *
 * Same shape as the established admin pattern (`prospect-fiche-view.test.tsx`,
 * `monitoring-view.test.tsx`, `support/page.test.tsx`,
 * `unauthorized-card.test.tsx`) — the admin vitest config runs in `node` env
 * (no DOM, no jsdom). We expand the React tree to plain nodes then assert on
 * the resulting text + types.
 *
 * Not exported from a barrel because it's strictly a test-helper — keeping
 * it scoped to `_components/` makes it obvious it's not production code.
 */
import type { ReactElement, ReactNode } from "react";

export type SerializedNode =
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
  if (typeof t === "object" && t !== null) {
    const obj = t as { displayName?: string; render?: { name?: string } };
    return obj.displayName ?? obj.render?.name ?? "ForwardRef";
  }
  return String(t);
}

function unwrap(type: unknown): { fn: (props: unknown) => ReactNode } | null {
  if (typeof type === "function") {
    return { fn: type as (p: unknown) => ReactNode };
  }
  if (typeof type === "object" && type !== null) {
    const obj = type as {
      render?: (props: unknown, ref: unknown) => ReactNode;
    };
    if (typeof obj.render === "function") {
      const render = obj.render;
      return { fn: (props) => render(props, null) };
    }
    const memo = type as { type?: unknown };
    if (memo.type !== undefined) {
      return unwrap(memo.type);
    }
  }
  return null;
}

export function serialize(node: ReactNode): SerializedNode {
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
    const unwrapped = unwrap(node.type);
    if (unwrapped !== null) {
      try {
        return serialize(unwrapped.fn(node.props));
      } catch {
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

export function flatten(n: SerializedNode): SerializedNode[] {
  if (n === null) return [];
  if ("text" in n) return [n];
  return [n, ...n.children.flatMap(flatten)];
}

export function allText(n: SerializedNode): string {
  return flatten(n)
    .map((x) => (x && "text" in x ? x.text : null))
    .filter((x): x is string => x !== null)
    .join(" ");
}

export function findAllByType(
  n: SerializedNode,
  type: string,
): Array<{
  type: string;
  props: Record<string, unknown>;
  children: SerializedNode[];
}> {
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

export function findFirstByName(
  n: SerializedNode,
  name: string,
): {
  type: string;
  props: Record<string, unknown>;
  children: SerializedNode[];
} | null {
  return findAllByType(n, name)[0] ?? null;
}
