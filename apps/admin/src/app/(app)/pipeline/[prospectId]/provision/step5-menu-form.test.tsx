/**
 * F-WIZARD [7/10] (#271) — `Step5MenuForm` test matrix.
 *
 * Pure presentational form for Step 5 of the provisioning wizard (menu
 * inline CRUD + 1ère publication requise + gate dure sur step 6). The Convex
 * wiring (read categories / items / modifier groups / publication status,
 * mutations for category / item / publish) is owned by the `Step5Form`
 * wrapper in `step-forms.tsx` and threaded down as props. This keeps the
 * form testable under the lean `node` vitest env with the same React-tree
 * serializer pattern as the sibling Step{N}Form tests.
 *
 * Acceptance criteria covered (issue #271):
 *   - Form mounts the F-MENU editor surface (MenuView + ModifierGroupsSection
 *     are reused — same data-slot markers stay intact, the wizard's value-add
 *     is the publish + gate UX layered on top).
 *   - « Publier le menu » button visible, calls `onPublish()`.
 *   - Badge « Brouillon non publié » when `lastPublishedAt === null`.
 *   - Badge « Publié » + timestamp when `lastPublishedAt` is a number.
 *   - « Continuer » button is disabled iff `lastPublishedAt === null`; the
 *     tooltip text explains the gate.
 *   - When `lastPublishedAt` is a number, « Continuer » is enabled and
 *     clicking it fires `onNext`.
 *   - « Précédent » button always wired to `onPrev`.
 *   - Backend error (`publishError !== null`) → inline message rendered.
 *   - Publish-in-flight state (`publishLoading === true`) → button disabled
 *     + label change (« Publication… »).
 *   - Scope guard: the form module does not import from `apps/web` /
 *     `apps/native`.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

// ---------------------------------------------------------------------------
// React hooks shim — same lean shim as the sibling Step{N}Form tests. Walks
// the FIRST render only; `useState` returns the initial value + a no-op
// setter; `useMemo` calls its factory. Sufficient to assert on the rendered
// tree shape and the wiring of the load-bearing handlers.
// ---------------------------------------------------------------------------
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const v =
        typeof initial === "function" ? (initial as () => T)() : initial;
      return [v, () => {}];
    },
    useEffect: () => {},
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(initial: T) => ({ current: initial }),
    useCallback: <T,>(fn: T) => fn,
  };
});

const { Step5MenuForm } = await import("./step5-menu-form");
type Step5MenuFormProps = import("./step5-menu-form").Step5MenuFormProps;

// ---------------------------------------------------------------------------
// React-tree serializer — mirror of step4-branding-form.test.tsx.
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

function findAll(
  n: SerializedNode,
  predicate: (n: NonNullable<SerializedNode>) => boolean,
): SerializedNode[] {
  return flatten(n).filter(
    (x): x is NonNullable<SerializedNode> => x !== null && predicate(x),
  );
}

function findBySlot(n: SerializedNode, slot: string): SerializedNode | null {
  const matches = findAll(
    n,
    (x) =>
      "props" in x &&
      (x.props as { "data-slot"?: string })["data-slot"] === slot,
  );
  return matches[0] ?? null;
}

function findButtonByText(
  n: SerializedNode,
  label: RegExp,
): SerializedNode | null {
  const candidates = findAll(n, (x) => {
    if (!("props" in x)) return false;
    const text = allText(x);
    return label.test(text);
  });
  const withHandler = candidates.find(
    (x) =>
      x !== null &&
      "props" in x &&
      typeof (x.props as { onClick?: unknown }).onClick === "function",
  );
  if (withHandler !== undefined) return withHandler;
  return candidates[candidates.length - 1] ?? null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function defaultProps(
  overrides: Partial<Step5MenuFormProps> = {},
): Step5MenuFormProps {
  return {
    categories: [],
    itemsByCategory: {},
    modifierGroups: [],
    lastPublishedAt: null,
    publishLoading: false,
    publishError: null,
    onPublish: vi.fn(),
    onCreateCategory: vi.fn(),
    onRenameCategory: vi.fn(),
    onDeleteCategory: vi.fn(),
    onReorderCategories: vi.fn(),
    onToggleItemAvailability: vi.fn(),
    onCreateItem: vi.fn(),
    onItemClick: vi.fn(),
    onReorderItems: vi.fn(),
    onCreateModifierGroup: vi.fn(),
    onEditModifierGroup: vi.fn(),
    onDeleteModifierGroup: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Step5MenuForm — F-WIZARD [7/10] (#271)", () => {
  it("renders the MenuView surface (reuses the F-MENU editor)", () => {
    const tree = serialize(Step5MenuForm(defaultProps()));
    // The reused MenuView mounts a publish button with this stable slot
    // (frozen by F-MENU-10 #254). Asserting on the slot pins « the wizard
    // mounts the editor surface » without duplicating MenuView's full
    // internals.
    expect(findBySlot(tree, "menu-publish-button")).not.toBeNull();
  });

  it("renders the ModifierGroupsSection (issue spec « modifiers idéalement »)", () => {
    const tree = serialize(Step5MenuForm(defaultProps()));
    // ModifierGroupsSection stamps `data-slot="menu-modifier-groups-section"`
    // on its root — pin via that stable marker.
    expect(findBySlot(tree, "menu-modifier-groups-section")).not.toBeNull();
  });

  it("renders the « Brouillon non publié » badge when `lastPublishedAt === null`", () => {
    const tree = serialize(
      Step5MenuForm(defaultProps({ lastPublishedAt: null })),
    );
    expect(allText(tree)).toMatch(/Brouillon\s+non\s+publi[ée]/i);
  });

  it("renders the « Publié » badge + a localised timestamp when `lastPublishedAt` is a number", () => {
    const ts = Date.UTC(2026, 4, 31, 14, 30, 0); // 2026-05-31 14:30 UTC
    const tree = serialize(
      Step5MenuForm(defaultProps({ lastPublishedAt: ts })),
    );
    const text = allText(tree);
    expect(text).toMatch(/Publi[ée]/);
    // Should surface SOMETHING from the timestamp — year minimum (locale
    // varies, but 2026 appears in every reasonable format).
    expect(text).toMatch(/2026/);
  });

  it("« Publier le menu » button fires `onPublish` when clicked (no in-flight, no error)", () => {
    const onPublish = vi.fn();
    const tree = serialize(Step5MenuForm(defaultProps({ onPublish })));
    const btn = findBySlot(tree, "menu-publish-button") as {
      props: { onClick?: () => void; disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).toBeFalsy();
    btn?.props.onClick?.();
    expect(onPublish).toHaveBeenCalledTimes(1);
  });

  it("« Publier » button is disabled while `publishLoading === true` and shows « Publication… »", () => {
    const tree = serialize(
      Step5MenuForm(defaultProps({ publishLoading: true })),
    );
    const btn = findBySlot(tree, "menu-publish-button") as {
      props: { disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).toBe(true);
    expect(allText(tree)).toMatch(/Publication/i);
  });

  it("renders the backend error inline when `publishError` is provided", () => {
    const tree = serialize(
      Step5MenuForm(
        defaultProps({
          publishError: "INVALID_MENU: menu vide à la publication",
        }),
      ),
    );
    const slot = findBySlot(tree, "wizard-step5-publish-error");
    expect(slot).not.toBeNull();
    expect(allText(slot)).toMatch(/INVALID_MENU/);
  });

  it("« Continuer » button is DISABLED when `lastPublishedAt === null` (gate dure)", () => {
    const onNext = vi.fn();
    const tree = serialize(
      Step5MenuForm(defaultProps({ lastPublishedAt: null, onNext })),
    );
    const btn = findBySlot(tree, "wizard-step5-continue-button") as {
      props: { disabled?: boolean; onClick?: () => void };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).toBe(true);
    // Even if the test harness invokes onClick, the handler must not fire
    // when disabled (no-op guard inside the form).
    btn?.props.onClick?.();
    expect(onNext).not.toHaveBeenCalled();
  });

  it("renders an explicit gate tooltip / help text near the disabled « Continuer » (issue spec)", () => {
    const tree = serialize(
      Step5MenuForm(defaultProps({ lastPublishedAt: null })),
    );
    // The form ships a visible help text adjacent to the disabled Continuer.
    // We pin the slot rather than the exact string so the FR copy can be
    // refined without churning the test.
    const help = findBySlot(tree, "wizard-step5-continue-help");
    expect(help).not.toBeNull();
    expect(allText(help)).toMatch(/publi/i);
  });

  it("« Continuer » button is ENABLED + wired to `onNext` once `lastPublishedAt` is a number", () => {
    const onNext = vi.fn();
    const ts = Date.UTC(2026, 4, 31, 14, 30, 0);
    const tree = serialize(
      Step5MenuForm(defaultProps({ lastPublishedAt: ts, onNext })),
    );
    const btn = findBySlot(tree, "wizard-step5-continue-button") as {
      props: { disabled?: boolean; onClick?: () => void };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).toBeFalsy();
    btn?.props.onClick?.();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("« Précédent » button always wired to `onPrev`", () => {
    const onPrev = vi.fn();
    const tree = serialize(Step5MenuForm(defaultProps({ onPrev })));
    const btn = findButtonByText(tree, /Pr[ée]c[ée]dent/i) as {
      props: { onClick?: () => void };
    } | null;
    expect(btn).not.toBeNull();
    btn?.props.onClick?.();
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("scope discipline: the form module does not import from `apps/web` or `apps/native`", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./step5-menu-form.tsx"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
  });
});
