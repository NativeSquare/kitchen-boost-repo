/**
 * F-SUPPORT/3 (#235) — Smoke test for the tenant operational route
 * `/t/[tenantId]/support`.
 *
 * La route monte EXACTEMENT le même composant partagé `SupportContent` que la
 * route supervision `/support` (#232) — zéro divergence de config, zéro
 * duplication. Cette propriété AC3 « rendu strictement identique » est ce qui
 * justifie l'épique tracer-bullet F-SUPPORT.
 *
 * Post-E2E SUP revisit (2026-06-03) — la surface a été drastiquement réduite
 * (cf. `SupportContent.tsx` docblock). L'invariant « les deux routes rendent
 * la même chose » reste intact : les deux pages prennent la même
 * `supportConfig` en argument.
 *
 * Why React-tree serializer (no jsdom, no Testing Library)?
 * --------------------------------------------------------
 * `apps/admin/vitest.config.ts` runs vitest in `environment: "node"`. Le
 * pattern serializer est utilisé partout dans `apps/admin`.
 *
 * AC2 « accessible à `/t/[tenantId]/support` dans l'espace opérationnel »
 * is OWNED par Next.js' file-system router — placer le fichier à
 * `apps/admin/src/app/(app)/t/[tenantId]/support/page.tsx` EST le binding.
 *
 * AC4 « accessible même quand le tenant est suspendu » is OWNED par le
 * parent `(app)/t/[tenantId]/layout.tsx` (F-SHELL-04 #175) : aucune branche
 * `suspended` n'existe dans `decideTenantGate`. L'absence de gate suspendue
 * EST l'autorisation.
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TenantSupportPage — F-SUPPORT/3 (#235) smoke", () => {
  it("renders without throwing", () => {
    expect(() => serialize(TenantSupportPage())).not.toThrow();
  });

  it("surface l'email contact du live `supportConfig` (marqueur visible)", () => {
    const tree = serialize(TenantSupportPage());
    const text = allText(tree);
    expect(text).toContain(supportConfig.contactEmail);
  });

  it("ne porte QUE le mailto vers `contactEmail` (zéro autre anchor)", () => {
    const tree = serialize(TenantSupportPage());
    const anchors = findAllByType(tree, "a") as Array<{
      props: { href?: string };
    }>;
    expect(anchors).toHaveLength(1);
    expect(anchors[0].props.href).toBe(`mailto:${supportConfig.contactEmail}`);
  });

  it("AC3 — rend EXACTEMENT le même contenu visible que `/support` (zéro duplication, single shared SupportContent + supportConfig)", () => {
    // Text-content equality entre les routes opérationnelle et supervision.
    // Si elles divergent (fork de config ou wrapper extra), ce test casse —
    // c'est le coeur de la promesse tracer-bullet : les deux routes sont un
    // call site mince du MÊME composant pré-construit. On compare les flux de
    // texte normalisés pour absorber les diffs whitespace sans impact UI.
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
