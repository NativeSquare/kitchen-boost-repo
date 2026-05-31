/**
 * F-SUPPORT/2 (#232) — Smoke test for the `/support` supervision route.
 *
 * The page is the second tracer-bullet of the F-SUPPORT épique (#150): it
 * mounts the shared `SupportContent` (figé en #210) under the supervision
 * shell. There is NO Convex query, NO router dependency, NO state — the page
 * is statically wired to the V1 `supportConfig` and renders.
 *
 * Why React-tree serializer (no jsdom, no Testing Library)?
 * --------------------------------------------------------
 * `apps/admin/vitest.config.ts` runs vitest in `environment: "node"` — there
 * is no DOM. The codebase pins React components by recursively expanding the
 * tree to plain DOM nodes (same shape as `SupportContent.test.tsx`,
 * `unauthorized-card.test.tsx`, `QrGeneratorView.test.tsx`). We reuse the
 * exact pattern verbatim so this smoke test stays portable in the same env
 * as the rest of `apps/admin`.
 *
 * Acceptance criteria covered (#232):
 *   - AC1 « `page.tsx` existe et rend `SupportContent` » → the page module's
 *     default export, when invoked, renders the `SupportContent` component
 *     (we assert on the CSM name + at least one resource card title, both
 *     visible markers fed by the static `supportConfig`).
 *   - AC3 « Smoke test vérifie que la page rend sans erreur et contient au
 *     moins un marqueur visible de `SupportContent` (nom CSM ou titre card) »
 *     → asserts the page invocation does not throw AND the rendered output
 *     surfaces the CSM name from the live `supportConfig` AND every static
 *     resource title.
 *
 * AC2 « accessible à `/support` » is OWNED by Next.js' file-system router —
 * placing the file at `apps/admin/src/app/(app)/support/page.tsx` IS the
 * binding (the `(app)` group is parenthesised → it does NOT segment the URL,
 * cf. ADR 0014 §3). The route resolution itself is a framework concern that
 * an E2E (Playwright) covers, not a unit test. No infra here would change
 * Next's URL resolution, so we don't pin it in this node-env smoke test.
 *
 * AC4 « pnpm typecheck / lint / test passent » is OWNED by CI (it runs the
 * triple on every push to `agent/<n>`).
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { supportConfig } from "@/components/support";

import SupportPage from "./page";

// ---------------------------------------------------------------------------
// React-tree serializer — same shape as `SupportContent.test.tsx`.
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
    const unwrapped = unwrap(node.type);
    if (unwrapped !== null) {
      try {
        return serialize(unwrapped.fn(node.props));
      } catch {
        // Radix primitives may use hooks that need a renderer; treat them as
        // opaque and surface their type name so we can still find them.
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
// Tests
// ---------------------------------------------------------------------------
describe("SupportPage — F-SUPPORT/2 (#232) smoke", () => {
  it("renders without throwing", () => {
    expect(() => serialize(SupportPage())).not.toThrow();
  });

  it("surfaces the CSM name from the live `supportConfig` (visible marker)", () => {
    const tree = serialize(SupportPage());
    const text = allText(tree);
    expect(text).toContain(supportConfig.csm.name);
  });

  it("surfaces every static resource title (one card per entry)", () => {
    const tree = serialize(SupportPage());
    const text = allText(tree);
    for (const r of supportConfig.resources) {
      expect(text).toContain(r.title);
    }
  });
});
