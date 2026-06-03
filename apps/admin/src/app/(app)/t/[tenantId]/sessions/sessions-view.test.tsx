/**
 * #396 (KB Admin — Page Sessions actives) — `SessionsView`, pure presentational
 * shell of the « Sessions actives » page (PRD 20 §13 « Révocation session
 * distante »).
 *
 * Owns the visible contract:
 *   - Page title « Sessions actives ».
 *   - Loading branch (sessions=undefined).
 *   - Empty branch (sessions=[]).
 *   - Populated branch: a table row per session with the minimal identity
 *     (userEmail / userName) + the lifetime (createdAt, expiresAt) + a
 *     « Révoquer » button.
 *   - The « Révoquer » button OPENS a 2-step confirmation dialog (NOT the
 *     revoke directly — destructive UX, PRD 70 / step8-activation pattern):
 *       • dialog header surfaces the targeted session's identity;
 *       • a SECOND confirm button « Révoquer la session » fires `onRevokeSession`.
 *   - Self-session warning : if a row's `sessionId` === `currentSessionId`,
 *     surface a visible « cette session » marker so the user knows they're
 *     about to log themselves out.
 *
 * Split out of `page.tsx` so vitest can pin every branch under
 * `environment: "node"` — same React-tree-serializer pattern as
 * `parametres-view.test.tsx` / `menu-view.test.tsx`. The page hands `sessions`
 * in as a prop (Convex's loading sentinel = `undefined`); the view is a pure
 * function of its props.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

// Under `environment: "node"` the real React hooks throw — stub them. Same
// pattern as parametres-view.test.tsx.
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

const { SessionsView } = await import("./sessions-view");
type SessionsViewProps = import("./sessions-view").SessionsViewProps;

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as parametres-view.test.tsx.
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

/**
 * Serialize props + children into a structural node — used both as the
 * default branch and the "fallback when a function/forwardRef component
 * throws" branch (so radix components that need DOM context still expose
 * their JSX children to the test).
 */
function structural(node: ReactElement): SerializedNode {
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
      try {
        return serialize(fn(node.props));
      } catch {
        // Radix components (Dialog, AlertDialog…) rely on DOM context we
        // can't supply under environment: "node". Fall back to a structural
        // serialization so the JSX children (e.g. our « Révoquer » button)
        // remain visible to assertions on text / data-slot.
        return structural(node);
      }
    }
    // ForwardRef / memo wrappers: unwrap one level for shadcn primitives.
    if (typeof node.type === "object" && node.type !== null) {
      const obj = node.type as {
        render?: (p: unknown, r: unknown) => ReactNode;
      };
      if (typeof obj.render === "function") {
        try {
          return serialize(obj.render(node.props, null));
        } catch {
          return structural(node);
        }
      }
    }
    return structural(node);
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
// Fixtures
// ---------------------------------------------------------------------------
const SID_A = "authSessions:aaa" as unknown as Id<"authSessions">;
const SID_B = "authSessions:bbb" as unknown as Id<"authSessions">;
const UID_A = "users:aaa" as unknown as Id<"users">;
const UID_B = "users:bbb" as unknown as Id<"users">;

const noopRevoke = async () => {};

const LOADING: SessionsViewProps = {
  sessions: undefined,
  onRevokeSession: noopRevoke,
  currentSessionId: undefined,
};

const EMPTY: SessionsViewProps = {
  sessions: [],
  onRevokeSession: noopRevoke,
  currentSessionId: undefined,
};

const POPULATED: SessionsViewProps = {
  sessions: [
    {
      sessionId: SID_A,
      userId: UID_A,
      userEmail: "khan@thai-street.fr",
      userName: "Khan",
      createdAt: Date.UTC(2026, 5, 1, 10, 0),
      expiresAt: Date.UTC(2026, 5, 31, 10, 0),
    },
    {
      sessionId: SID_B,
      userId: UID_B,
      userEmail: "walid@thai-street.fr",
      userName: undefined,
      createdAt: Date.UTC(2026, 5, 2, 12, 0),
      expiresAt: Date.UTC(2026, 6, 1, 12, 0),
    },
  ],
  onRevokeSession: noopRevoke,
  currentSessionId: undefined,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("SessionsView — #396", () => {
  it("surfaces the page title « Sessions actives » on every branch", () => {
    for (const props of [LOADING, EMPTY, POPULATED]) {
      const text = allText(serialize(SessionsView(props)));
      expect(text).toMatch(/Sessions actives/);
    }
  });

  it("loading branch surfaces a skeleton / chargement marker (no row, no empty copy)", () => {
    const text = allText(serialize(SessionsView(LOADING)));
    // We don't pin the exact copy ; we pin that the loading state is visually
    // distinct from the empty state.
    expect(text).not.toMatch(/Aucune session/);
    // No populated rows.
    expect(text).not.toMatch(/khan@thai-street\.fr/);
  });

  it("empty branch surfaces an explicit « Aucune session active » copy", () => {
    const text = allText(serialize(SessionsView(EMPTY)));
    expect(text).toMatch(/Aucune session active/i);
  });

  it("populated branch renders one row per session with the user email", () => {
    const text = allText(serialize(SessionsView(POPULATED)));
    expect(text).toMatch(/khan@thai-street\.fr/);
    expect(text).toMatch(/walid@thai-street\.fr/);
  });

  it("populated branch surfaces a « Révoquer » button on every row", () => {
    const tree = serialize(SessionsView(POPULATED));
    const text = allText(tree);
    // At least two « Révoquer » buttons (one per row).
    const matches = text.match(/R[ée]voquer/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("« Révoquer » trigger uses a destructive / red visual cue (button variant=destructive or visible red marker) — 2-step UX, PRD 70", () => {
    // The exact prop name is free, but at least ONE element rendered on the
    // populated branch must carry a destructive / red marker (the row button
    // or the confirm-dialog button).
    const tree = serialize(SessionsView(POPULATED));
    const flat = flatten(tree);
    const hasDestructive = flat.some((n) => {
      if (n === null || "text" in n) return false;
      const variant = n.props["variant"];
      if (variant === "destructive") return true;
      const className = n.props["className"];
      if (
        typeof className === "string" &&
        /destructive|text-red/.test(className)
      ) {
        return true;
      }
      return false;
    });
    expect(hasDestructive).toBe(true);
  });

  it("surfaces an « actuelle » / « cette session » marker on the row whose sessionId === currentSessionId (so the user knows they're about to log themselves out)", () => {
    const props: SessionsViewProps = {
      ...POPULATED,
      currentSessionId: SID_A,
    };
    const text = allText(serialize(SessionsView(props)));
    // Free polish — pin the load-bearing intent (the user must be warned).
    expect(text).toMatch(/(actuelle|cette session|votre session)/i);
  });

  it("a stable data-slot marker surfaces the « sessions table » region (E2E + future test targeting)", () => {
    const tree = serialize(SessionsView(POPULATED));
    const slots = flatten(tree)
      .map((x) => {
        if (x === null || "text" in x) return null;
        const ds = x.props["data-slot"];
        return typeof ds === "string" ? ds : null;
      })
      .filter((s): s is string => s !== null);
    expect(slots).toContain("sessions-table");
  });
});
