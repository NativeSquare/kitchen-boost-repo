/**
 * F-SUPPORT/3 (#235) — Smoke test for the tenant operational route
 * `/t/[tenantId]/support`.
 *
 * Troisième tracer-bullet de l'épique F-SUPPORT (#150) : la route monte EXACTEMENT
 * le même composant partagé `SupportContent` (figé en #210) que la route
 * supervision `/support` (#232), sans la moindre divergence de config — zéro
 * duplication, zéro fetch, zéro state, zéro router dep.
 *
 * Why React-tree serializer (no jsdom, no Testing Library)?
 * --------------------------------------------------------
 * `apps/admin/vitest.config.ts` runs vitest in `environment: "node"` — there
 * is no DOM. The codebase pins React components by recursively expanding the
 * tree to plain DOM nodes (same shape as `(app)/support/page.test.tsx`,
 * `SupportContent.test.tsx`, `unauthorized-card.test.tsx`,
 * `QrGeneratorView.test.tsx`). We reuse the EXACT pattern verbatim so this
 * smoke test stays portable in the same env as the rest of `apps/admin`.
 *
 * Acceptance criteria covered (#235):
 *   - AC1 « `page.tsx` existe et rend `SupportContent` » → the page module's
 *     default export, when invoked, renders the `SupportContent` component
 *     (asserted via the CSM name + every resource title from the live
 *     `supportConfig`).
 *   - AC3 « rendu strictement identique à `/support` (même composant, même
 *     config) » → text-content equality between this page and the supervision
 *     `/support` page (both must surface the same visible markers — CSM name
 *     and every resource title). Asserts the operational route reuses the
 *     SHARED `SupportContent` + `supportConfig` without any divergence.
 *   - AC5 « Smoke test vérifie rendu + présence d'un marqueur visible de
 *     `SupportContent` » → asserts the page invocation does not throw AND
 *     surfaces the CSM name + every resource title.
 *
 * AC2 « accessible à `/t/[tenantId]/support` dans l'espace opérationnel »
 * is OWNED by Next.js' file-system router — placing the file at
 * `apps/admin/src/app/(app)/t/[tenantId]/support/page.tsx` IS the binding
 * (the `(app)` group is parenthesised → it does NOT segment the URL ; the
 * `t/[tenantId]` segments DO, cf. ADR 0014 §3). Route resolution itself is a
 * framework concern that an E2E (Playwright) covers, not a unit test. We do
 * NOT pin Next's URL resolution in this node-env smoke test.
 *
 * AC4 « accessible même quand le tenant est suspendu » is OWNED by the
 * parent `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04 #175). That layout
 * gates on existence + ownership ONLY (`decideTenantGate` — `allow` /
 * `not-found` / `not-authorized` / `wait`) — there is NO `suspended` branch.
 * A KB Manager attached to a suspended tenant therefore reaches this route
 * exactly like an active one. No code is needed here to "allow suspended" —
 * the absence of a suspended gate IS the allow. If a future F-SHELL slice
 * introduces such a gate, it MUST explicitly except `/support` (PRD
 * `70_kb_admin.md` §Edge cases : « KB Manager attaché à un tenant suspendu
 * uniquement : message d'explication + lien vers support »). Documented in
 * the page header comment.
 *
 * AC6 « pnpm typecheck / lint / test passent » is OWNED by CI (it runs the
 * triple on every push to `agent/<n>`).
 *
 * Scope discipline (#235 hard constraint, mirrors `(app)/support/page.test.tsx`):
 * this file (and its sibling `page.tsx` under
 * `apps/admin/src/app/(app)/t/[tenantId]/support/`) is the ONLY surface
 * touched by this story. Zero touch to `apps/web`, `apps/native`,
 * `packages/backend/convex/`, the shared `@/components/support` (figé en
 * #210), or the supervision route `(app)/support/`.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { supportConfig } from "@/components/support";

import SupervisionSupportPage from "../../../support/page";
import TenantSupportPage from "./page";

// ---------------------------------------------------------------------------
// React-tree serializer — same shape as `(app)/support/page.test.tsx`.
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
describe("TenantSupportPage — F-SUPPORT/3 (#235) smoke", () => {
  it("renders without throwing", () => {
    expect(() => serialize(TenantSupportPage())).not.toThrow();
  });

  it("surfaces the CSM name from the live `supportConfig` (visible marker)", () => {
    const tree = serialize(TenantSupportPage());
    const text = allText(tree);
    expect(text).toContain(supportConfig.csm.name);
  });

  it("surfaces every static resource title (one card per entry)", () => {
    const tree = serialize(TenantSupportPage());
    const text = allText(tree);
    for (const r of supportConfig.resources) {
      expect(text).toContain(r.title);
    }
  });

  it("AC3 — renders the EXACT same visible content as `/support` (zero duplication, single shared SupportContent + supportConfig)", () => {
    // Text-content equality between the operational and supervision routes.
    // If they ever diverge (e.g. someone forks the config or wraps one with
    // an extra header), this test fails — which is the whole point of the
    // tracer-bullet pattern: both routes are a thin call site of the SAME
    // pre-built component. We compare collapsed text streams to absorb
    // whitespace differences that don't affect the visible UI.
    const tenantText = allText(serialize(TenantSupportPage())).replace(
      /\s+/g,
      " ",
    );
    const supervisionText = allText(
      serialize(SupervisionSupportPage()),
    ).replace(/\s+/g, " ");
    expect(tenantText).toBe(supervisionText);
  });
});
