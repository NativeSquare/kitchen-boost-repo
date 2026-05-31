/**
 * F-SUPPORT/1 (#210) — `SupportContent` : the shared, static support surface
 * mounted by both support routes (admin supervision + tenant operational) of
 * the F-SUPPORT épique (#150). This first tracer-bullet builds ONLY the
 * shared component + its static config — no routes, no Convex query, no
 * analytics (PRD `70_kb_admin.md` §4.11, ADR 0014).
 *
 * Why React-tree serializer, not Testing Library?
 * -----------------------------------------------
 * `apps/admin/vitest.config.ts` runs vitest in node env (no jsdom, no RTL).
 * The codebase pins React components with the lean serializer pattern (see
 * `unauthorized-card.test.tsx`, `QrGeneratorView.test.tsx`). We reuse that
 * pattern verbatim so the tests stay lean + portable across the same
 * environment as everything else in `apps/admin`.
 *
 * The serializer recursively expands user-defined function components (and
 * shadcn `Card`/`Avatar` primitives) down to plain DOM tags. We therefore
 * assert on primitive tags + `data-slot` attributes (the shadcn convention
 * used across the codebase) rather than on component identity.
 *
 * Acceptance criteria covered (#210):
 *   - Renders the CSM block (name, email, phone when present, availability).
 *   - Email anchor uses `mailto:${csm.email}`; phone anchor uses
 *     `tel:${csm.phone}` (no wrapper).
 *   - Avatar slot renders an `<img>` (avatar-image) with the right `src`
 *     when `photoUrl` is provided; otherwise the avatar-fallback slot is
 *     populated with the initials.
 *   - Renders one card per entry in `resources`, with the entry's `href`,
 *     `target="_blank"`, and `rel="noopener noreferrer"`.
 *   - Each resource card carries an icon marked `aria-hidden` (decorative).
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { SupportContent } from "./SupportContent";
import type { SupportConfig } from "./support.config";

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
    // forwardRef: { $$typeof, render: (props, ref) => ReactNode }
    const obj = type as {
      render?: (props: unknown, ref: unknown) => ReactNode;
    };
    if (typeof obj.render === "function") {
      const render = obj.render;
      return { fn: (props) => render(props, null) };
    }
    // memo: { $$typeof, type: ComponentType }
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
// Fixtures
// ---------------------------------------------------------------------------
const CSM_WITH_EVERYTHING = {
  name: "Alex Michelet",
  email: "alex@kitchen-boost.fr",
  phone: "+33 6 12 34 56 78",
  photoUrl: "/csm/alex.jpg",
  availability: "Lun–Ven, 9h–19h",
} as const;

const CSM_NO_PHONE_NO_PHOTO = {
  name: "Alex Michelet",
  email: "alex@kitchen-boost.fr",
  availability: "Email uniquement, réponse < 24 h",
} as const;

const RESOURCES_THREE: SupportConfig["resources"] = [
  {
    title: "FAQ",
    description: "Réponses aux questions fréquentes.",
    url: "https://kitchen-boost.fr/faq",
  },
  {
    title: "Guide démarrage",
    url: "https://kitchen-boost.fr/onboarding",
  },
  {
    title: "Vidéo tuto",
    description: "Découvrir l'admin en 5 min.",
    url: "https://kitchen-boost.fr/tuto",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SupportContent — F-SUPPORT/1 (#210)", () => {
  it("renders one card per resource entry (parametrised on `resources`)", () => {
    const tree = serialize(
      SupportContent({
        csm: CSM_WITH_EVERYTHING,
        resources: RESOURCES_THREE,
      }),
    );
    const cards = findAllBySlot(tree, "card");
    // 1 CSM card + 3 resource cards = 4 (N+1 resources).
    expect(cards.length).toBe(RESOURCES_THREE.length + 1);
    const text = allText(tree);
    for (const r of RESOURCES_THREE) {
      expect(text).toContain(r.title);
    }
  });

  it("each resource link has target=_blank + rel=noopener noreferrer + correct href", () => {
    const tree = serialize(
      SupportContent({
        csm: CSM_WITH_EVERYTHING,
        resources: RESOURCES_THREE,
      }),
    );
    const anchors = findAllByType(tree, "a") as Array<{
      props: { href?: string; target?: string; rel?: string };
    }>;
    // External resource anchors (one per resource entry).
    const externals = anchors.filter(
      (a) =>
        typeof a.props.href === "string" && a.props.href.startsWith("http"),
    );
    expect(externals).toHaveLength(RESOURCES_THREE.length);
    const hrefs = externals.map((a) => a.props.href);
    for (const r of RESOURCES_THREE) {
      expect(hrefs).toContain(r.url);
    }
    for (const a of externals) {
      expect(a.props.target).toBe("_blank");
      expect(a.props.rel).toBe("noopener noreferrer");
    }
  });

  it("each resource card carries an icon marked aria-hidden (decorative)", () => {
    const tree = serialize(
      SupportContent({
        csm: CSM_WITH_EVERYTHING,
        resources: RESOURCES_THREE,
      }),
    );
    // lucide icons render an <svg> with `aria-hidden` forwarded. Collect every
    // svg in the tree and assert: at least one decorative one per resource
    // card, all of them marked aria-hidden (no svg should be announced to a
    // screen reader).
    const svgs = flatten(tree).filter(
      (
        x,
      ): x is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      } => x !== null && "type" in x && x.type === "svg",
    );
    // ≥ 1 svg per resource (the ExternalLink icon).
    expect(svgs.length).toBeGreaterThanOrEqual(RESOURCES_THREE.length);
    for (const svg of svgs) {
      const ariaHidden = svg.props["aria-hidden"];
      // React accepts both boolean `true` and string `"true"`.
      expect(ariaHidden === true || ariaHidden === "true").toBe(true);
    }
  });

  it("CSM block surfaces name, mailto: email anchor, and tel: phone anchor when phone is set", () => {
    const tree = serialize(
      SupportContent({
        csm: CSM_WITH_EVERYTHING,
        resources: [],
      }),
    );
    const text = allText(tree);
    expect(text).toContain(CSM_WITH_EVERYTHING.name);
    expect(text).toContain(CSM_WITH_EVERYTHING.availability);

    const anchors = findAllByType(tree, "a") as Array<{
      props: { href?: string };
    }>;
    const hrefs = anchors
      .map((a) => a.props.href)
      .filter((h): h is string => typeof h === "string");
    expect(hrefs).toContain(`mailto:${CSM_WITH_EVERYTHING.email}`);
    expect(hrefs).toContain(`tel:${CSM_WITH_EVERYTHING.phone}`);
  });

  it("omits the tel: anchor when CSM has no phone (email-only fallback)", () => {
    const tree = serialize(
      SupportContent({
        csm: CSM_NO_PHONE_NO_PHOTO,
        resources: [],
      }),
    );
    const anchors = findAllByType(tree, "a") as Array<{
      props: { href?: string };
    }>;
    const hrefs = anchors
      .map((a) => a.props.href)
      .filter((h): h is string => typeof h === "string");
    expect(hrefs).toContain(`mailto:${CSM_NO_PHONE_NO_PHOTO.email}`);
    expect(hrefs.some((h) => h.startsWith("tel:"))).toBe(false);
  });

  it("Avatar renders an <img> (avatar-image slot) with the right src + alt when photoUrl is set", () => {
    const tree = serialize(
      SupportContent({
        csm: CSM_WITH_EVERYTHING,
        resources: [],
      }),
    );
    const avatarImages = findAllBySlot(tree, "avatar-image") as Array<{
      props: { src?: string; alt?: string };
    }>;
    expect(avatarImages.length).toBeGreaterThanOrEqual(1);
    expect(avatarImages[0].props.src).toBe(CSM_WITH_EVERYTHING.photoUrl);
    expect(avatarImages[0].props.alt).toBeDefined();
    expect(String(avatarImages[0].props.alt)).toMatch(/Alex Michelet/);
  });

  it("Avatar falls back to initials (avatar-fallback slot, no avatar-image) when photoUrl is absent", () => {
    const tree = serialize(
      SupportContent({
        csm: CSM_NO_PHONE_NO_PHOTO,
        resources: [],
      }),
    );
    const avatarImages = findAllBySlot(tree, "avatar-image");
    expect(avatarImages).toHaveLength(0);
    const fallbacks = findAllBySlot(tree, "avatar-fallback");
    expect(fallbacks.length).toBeGreaterThanOrEqual(1);
    // Initials = first letter of first word + first letter of last word.
    // "Alex Michelet" → "AM".
    const fallbackText = allText(fallbacks[0]);
    expect(fallbackText).toContain("AM");
  });

  it("renders an empty resource grid cleanly when resources is []", () => {
    const tree = serialize(
      SupportContent({
        csm: CSM_WITH_EVERYTHING,
        resources: [],
      }),
    );
    const externalAnchors = (
      findAllByType(tree, "a") as Array<{ props: { href?: string } }>
    ).filter(
      (a) =>
        typeof a.props.href === "string" && a.props.href.startsWith("http"),
    );
    expect(externalAnchors).toHaveLength(0);
    // Only the CSM card remains.
    const cards = findAllBySlot(tree, "card");
    expect(cards).toHaveLength(1);
  });
});
