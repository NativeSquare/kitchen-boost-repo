/**
 * F-WIZARD [8/10] (#272) — `Step6QrForm` test matrix.
 *
 * Pure presentational form for Step 6 of the provisioning wizard (QR sticker
 * PDF imprimable). The Convex wiring (prospect read for `tenantId` back-link
 * + tenant doc read via `loadTenantForStripe` for `slug` / `customDomain` /
 * branding) is owned by the `Step6Form` wrapper in `step-forms.tsx`; this
 * pure component just receives the already-resolved `pwaUrl` / `restoName` /
 * `logoUrl` / `primaryColor` and mounts the shared F-QR `QrGeneratorView`
 * (#182), which itself handles the @react-pdf/renderer → jspdf preview +
 * download + format selector.
 *
 * Acceptance criteria covered (issue #272):
 *   - The form mounts the SHARED F-QR `QrGeneratorView` (DO NOT duplicate
 *     PDF logic — explicit reuse is the WHOLE point of the epic F-QR #142).
 *   - The `pwaUrl` / `restoName` / `logoUrl` / `primaryColor` props are
 *     threaded straight through to `QrGeneratorView` (the wrapper resolves
 *     them — this form is a pure passthrough).
 *   - The « Continuer » button is ALWAYS active (« step non-bloquant » —
 *     issue body, PRD §4.7) and wired to `onNext`.
 *   - The « Précédent » button is wired to `onPrev`.
 *   - Scope discipline: the form module does not import from `apps/web` or
 *     `apps/native`.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

// ---------------------------------------------------------------------------
// React hooks shim — same lean shim as the sibling Step{N}Form tests.
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

const { Step6QrForm } = await import("./step6-qr-form");
type Step6QrFormProps = import("./step6-qr-form").Step6QrFormProps;

// ---------------------------------------------------------------------------
// React-tree serializer — mirror of step5-menu-form.test.tsx.
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

/**
 * Serializer that does NOT recurse into `QrGeneratorView` (and any other
 * component named below). Stops at the boundary so we can assert on the
 * mounted shape + threaded props WITHOUT executing the QR pipeline (which
 * would invoke `useEffect` + `URL.createObjectURL`, both unavailable / no-op
 * under the lean `node` vitest env).
 */
const STOP_AT_TYPE_NAMES = new Set(["QrGeneratorView"]);

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
    const name = typeName(node.type);
    // Hard stop at the F-QR boundary so we pin « mount + prop threading »
    // without executing the QR/PDF pipeline.
    if (STOP_AT_TYPE_NAMES.has(name)) {
      const props = { ...(node.props as Record<string, unknown>) };
      delete props.children;
      return { type: name, props, children: [] };
    }
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
        return { type: name, props, children };
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
    return { type: name, props, children };
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

function findByType(n: SerializedNode, name: string): SerializedNode | null {
  const matches = findAll(
    n,
    (x) => "type" in x && (x as { type: string }).type === name,
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
  overrides: Partial<Step6QrFormProps> = {},
): Step6QrFormProps {
  return {
    pwaUrl: "https://lartisan.kitchen-boost.fr",
    restoName: "L'Artisan",
    logoUrl: undefined,
    primaryColor: undefined,
    onPrev: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Step6QrForm — F-WIZARD [8/10] (#272)", () => {
  it("mounts the shared F-QR `QrGeneratorView` (NO PDF logic duplicated)", () => {
    const tree = serialize(Step6QrForm(defaultProps()));
    const qr = findByType(tree, "QrGeneratorView");
    expect(qr).not.toBeNull();
  });

  it("threads `pwaUrl` / `restoName` / `logoUrl` / `primaryColor` straight through to QrGeneratorView", () => {
    const tree = serialize(
      Step6QrForm(
        defaultProps({
          pwaUrl: "https://artisan-test.kitchen-boost.fr",
          restoName: "Test Artisan",
          logoUrl: "https://cdn.example.com/test/logo.png",
          primaryColor: "#1B7A3D",
        }),
      ),
    );
    const qr = findByType(tree, "QrGeneratorView") as {
      props: {
        pwaUrl?: string;
        restoName?: string;
        logoUrl?: string;
        primaryColor?: string;
      };
    } | null;
    expect(qr).not.toBeNull();
    expect(qr?.props.pwaUrl).toBe("https://artisan-test.kitchen-boost.fr");
    expect(qr?.props.restoName).toBe("Test Artisan");
    expect(qr?.props.logoUrl).toBe("https://cdn.example.com/test/logo.png");
    expect(qr?.props.primaryColor).toBe("#1B7A3D");
  });

  it("« Continuer » button is ALWAYS active (« step non-bloquant ») and wired to `onNext`", () => {
    const onNext = vi.fn();
    const tree = serialize(Step6QrForm(defaultProps({ onNext })));
    const btn = findButtonByText(tree, /Continuer|Suivant/i) as {
      props: { onClick?: () => void; disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    // « non-bloquant » — the button is NEVER disabled (no gate).
    expect(btn?.props.disabled).toBeFalsy();
    btn?.props.onClick?.();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("« Précédent » button is wired to `onPrev`", () => {
    const onPrev = vi.fn();
    const tree = serialize(Step6QrForm(defaultProps({ onPrev })));
    const btn = findButtonByText(tree, /Pr[ée]c[ée]dent/i) as {
      props: { onClick?: () => void };
    } | null;
    expect(btn).not.toBeNull();
    btn?.props.onClick?.();
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("scope discipline: the form module does not import from `apps/web` or `apps/native`", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./step6-qr-form.tsx"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
  });

  it("scope discipline: the form module does NOT call backend (zero `useMutation` / `useAction` / `useQuery` import)", () => {
    // The wrapper `Step6Form` in `step-forms.tsx` owns ALL the Convex wiring.
    // The pure form must remain backend-free (issue acceptance: « Aucun appel
    // backend (zéro mutation, zéro action) ») so its prop contract stays the
    // single contract surface.
    const source = readFileSync(
      path.resolve(__dirname, "./step6-qr-form.tsx"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/useMutation/);
    expect(code).not.toMatch(/useAction/);
    expect(code).not.toMatch(/useQuery/);
    expect(code).not.toMatch(/convex\/react/);
  });
});
