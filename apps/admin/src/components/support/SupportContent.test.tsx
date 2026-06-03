/**
 * F-SUPPORT/1 (#210) — `SupportContent` : the shared, static support surface
 * mounted by both support routes (admin supervision + tenant operational) of
 * the F-SUPPORT épique (#150).
 *
 * Post-E2E SUP revisit (2026-06-03) — surface drastiquement réduite
 * -----------------------------------------------------------------
 * Sur retour terrain d'Alex (cf. docblock `SupportContent.tsx`) la surface
 * a perdu :
 *   - le bandeau CSM nommé (« Alex Michelet » → personne fictive trompeuse) ;
 *   - le téléphone CSM (`tel:` anchor) ;
 *   - le bloc créneaux/availability ;
 *   - la grid de cards ressources (URLs placeholders, pas de pages réelles).
 *
 * Ce qui RESTE et que ces tests pinnent :
 *   - un titre `<h1>` court (« Besoin d'aide ? ») ;
 *   - une ligne d'intro ;
 *   - un mailto unique vers `contactEmail` (carry-over `data-slot=
 *     "support-email"` pour Playwright).
 *
 * Why React-tree serializer, not Testing Library?
 * -----------------------------------------------
 * `apps/admin/vitest.config.ts` runs vitest in node env (no jsdom, no RTL).
 * Le codebase pin les composants React avec le pattern serializer (cf.
 * `unauthorized-card.test.tsx`, `QrGeneratorView.test.tsx`). On réutilise le
 * pattern verbatim pour rester portable dans le même env que tout `apps/admin`.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { SupportContent } from "./SupportContent";

// ---------------------------------------------------------------------------
// React-tree serializer (same shape as `unauthorized-card.test.tsx`).
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

/** Find every node whose `data-slot` prop equals `slot`. */
function findAllBySlot(n: SerializedNode, slot: string): SerializedNode[] {
  return flatten(n).filter(
    (
      x,
    ): x is {
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    } =>
      x !== null &&
      "props" in x &&
      (x.props as Record<string, unknown>)["data-slot"] === slot,
  );
}

// ---------------------------------------------------------------------------
// Tests — surface réduite post-E2E SUP (2026-06-03)
// ---------------------------------------------------------------------------
describe("SupportContent — surface email-only (post-E2E SUP revisit)", () => {
  it("renders a single mailto: anchor pointing at `contactEmail` (no other anchors)", () => {
    const tree = serialize(
      SupportContent({ contactEmail: "office@kitchen-boost.com" }),
    );
    const anchors = findAllByType(tree, "a") as Array<{
      props: { href?: string };
    }>;
    expect(anchors).toHaveLength(1);
    expect(anchors[0].props.href).toBe("mailto:office@kitchen-boost.com");
  });

  it("surfaces a sober page title and the contact email as visible text", () => {
    const tree = serialize(
      SupportContent({ contactEmail: "office@kitchen-boost.com" }),
    );
    const text = allText(tree);
    expect(text).toContain("Besoin d'aide");
    expect(text).toContain("office@kitchen-boost.com");
  });

  it('exposes a stable `data-slot="support-email"` on the mailto for Playwright', () => {
    const tree = serialize(
      SupportContent({ contactEmail: "office@kitchen-boost.com" }),
    );
    const emailSlots = findAllBySlot(tree, "support-email") as Array<{
      type: string;
      props: { href?: string };
    }>;
    expect(emailSlots).toHaveLength(1);
    expect(emailSlots[0].type).toBe("a");
    expect(emailSlots[0].props.href).toBe("mailto:office@kitchen-boost.com");
  });

  it("does NOT render any removed surface — no named CSM, no phone, no availability, no resource cards", () => {
    const tree = serialize(
      SupportContent({ contactEmail: "office@kitchen-boost.com" }),
    );
    const text = allText(tree);
    // No personally-named CSM ("Alex Michelet" was the V1 placeholder).
    expect(text).not.toMatch(/Alex\s+Michelet/i);
    expect(text).not.toMatch(/interlocuteur/i);
    // No phone anchor (Alex: "tu met pas de numéro de tel").
    const anchors = findAllByType(tree, "a") as Array<{
      props: { href?: string };
    }>;
    expect(
      anchors.every((a) => !String(a.props.href ?? "").startsWith("tel:")),
    ).toBe(true);
    // No availability mention (Alex: "enlève les mention du lundi au vendredi").
    expect(text).not.toMatch(/lun.?ven|9h|19h|24 h/i);
    // No resource cards (Alex: "Enlève les liens pour le moment on en a pas").
    // No external (http/https) anchors should survive.
    expect(
      anchors.every(
        (a) =>
          typeof a.props.href !== "string" ||
          !/^https?:\/\//i.test(a.props.href),
      ),
    ).toBe(true);
    // None of the V1 resource titles should leak back in.
    expect(text).not.toMatch(/FAQ KitchenBoost/i);
    expect(text).not.toMatch(/Guide de d.marrage/i);
    expect(text).not.toMatch(/Vid.o tuto/i);
    expect(text).not.toMatch(/Kit commercial/i);
  });

  it("renders the shell page convention wrapper (py-4 md:py-6 — fixes the « collé au bord » outlier)", () => {
    const tree = serialize(
      SupportContent({ contactEmail: "office@kitchen-boost.com" }),
    );
    const supportViews = findAllBySlot(tree, "support-view") as Array<{
      props: { className?: string };
    }>;
    expect(supportViews).toHaveLength(1);
    const cls = String(supportViews[0].props.className ?? "");
    // Same vertical-padding convention as `dashboard-view`, `menu-view`,
    // `pricing-view`, etc. — Support was the only outlier before this revisit.
    expect(cls).toContain("py-4");
    expect(cls).toContain("md:py-6");
  });
});
