/**
 * F-WIZARD [9/10] (#273) — `Step7ManagerInviteForm` test matrix.
 *
 * Pure presentational form for Step 7 of the provisioning wizard (envoi du
 * magic-link d'invitation au gérant). The Convex wiring (`inviteManager`
 * mutation + `getLatestManagerInviteForTenant` read) is owned by the
 * `Step7Form` wrapper in `step-forms.tsx`; this pure component receives the
 * already-resolved `email` / `existingInvite` / `onSend` / `isSending` /
 * `sendError` and renders the form + the « envoyée » badge + the « Renvoyer »
 * affordance.
 *
 * Acceptance criteria covered (issue #273):
 *   - Email gérant pré-rempli + READ-ONLY (no <input/>'s value can be edited).
 *   - Optional « Nom du gérant » input (visible when no name yet, can be edited
 *     pre-send).
 *   - Bouton « Envoyer l'invitation » calls `onSend({ email, name? })`.
 *   - On success (existingInvite !== undefined): badge « Invitation envoyée le
 *     [DD/MM/YYYY] à [HH:MM] » + bouton « Renvoyer l'invitation » that fires
 *     `onSend` again.
 *   - « Continuer » button is ALWAYS active (step non-bloquant) and fires
 *     `onNext`.
 *   - Warning visible if `existingInvite === null` (user has not sent yet) —
 *     « Sans invitation, le gérant ne pourra pas se connecter. »
 *   - Backend error (`sendError !== null`) → inline message rendered.
 *   - Send-in-flight state (`isSending === true`) → button disabled.
 *   - « Précédent » button wired to `onPrev`.
 *   - Scope guard: the form module does not import from `apps/web` /
 *     `apps/native` and does NOT call backend directly (no useMutation /
 *     useAction / useQuery).
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

const { Step7ManagerInviteForm } = await import("./step7-manager-invite-form");
type Step7ManagerInviteFormProps =
  import("./step7-manager-invite-form").Step7ManagerInviteFormProps;

// ---------------------------------------------------------------------------
// React-tree serializer — mirror of step6-qr-form.test.tsx.
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
    const name = typeName(node.type);
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

function findButtonByText(
  n: SerializedNode,
  label: RegExp,
): SerializedNode | null {
  const candidates = findAll(n, (x) => {
    if (!("props" in x)) return false;
    const text = allText(x);
    return label.test(text);
  });
  // Prefer the deepest match with an onClick handler — buttons are typically
  // leaf elements; outer containers may inherit the same text content.
  const withHandler = candidates
    .reverse()
    .find(
      (x) =>
        x !== null &&
        "props" in x &&
        typeof (x.props as { onClick?: unknown }).onClick === "function",
    );
  if (withHandler !== undefined) return withHandler;
  return candidates[candidates.length - 1] ?? null;
}

function findInputByName(
  n: SerializedNode,
  name: string,
): SerializedNode | null {
  const candidates = findAll(n, (x) => {
    if (!("props" in x)) return false;
    const p = x.props as { name?: string };
    return p.name === name;
  });
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function defaultProps(
  overrides: Partial<Step7ManagerInviteFormProps> = {},
): Step7ManagerInviteFormProps {
  return {
    email: "gerant@example.fr",
    existingInvite: null, // not sent yet
    isSending: false,
    sendError: null,
    onSend: vi.fn(async () => {}),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Step7ManagerInviteForm — F-WIZARD [9/10] (#273)", () => {
  it("renders the email as READ-ONLY (cannot be edited)", () => {
    const tree = serialize(
      Step7ManagerInviteForm(defaultProps({ email: "alex@resto.fr" })),
    );
    const emailInput = findInputByName(tree, "email") as {
      props: {
        value?: string;
        readOnly?: boolean;
        disabled?: boolean;
        defaultValue?: string;
      };
    } | null;
    expect(emailInput).not.toBeNull();
    // The displayed value matches the prop. Either as `value` or `defaultValue`.
    const shown = emailInput?.props.value ?? emailInput?.props.defaultValue;
    expect(shown).toBe("alex@resto.fr");
    // READ-ONLY: either `readOnly` or `disabled` must be truthy.
    expect(
      emailInput?.props.readOnly === true ||
        emailInput?.props.disabled === true,
    ).toBe(true);
  });

  it("renders an editable « Nom du gérant » input when no invite has been sent", () => {
    const tree = serialize(
      defaultProps().onSend ? Step7ManagerInviteForm(defaultProps()) : null,
    );
    const nameInput = findInputByName(tree, "name") as {
      props: { readOnly?: boolean; disabled?: boolean };
    } | null;
    expect(nameInput).not.toBeNull();
    // The name input must be editable (NOT readOnly, NOT disabled) so the
    // operator can fill it in if absent.
    expect(nameInput?.props.readOnly).not.toBe(true);
    expect(nameInput?.props.disabled).not.toBe(true);
  });

  it("warning « Sans invitation… » is visible when no invite has been sent", () => {
    const tree = serialize(Step7ManagerInviteForm(defaultProps()));
    const text = allText(tree);
    // Warning copy spec verbatim per issue body: « Sans invitation, le gérant
    // ne pourra pas se connecter. »
    expect(text).toMatch(/Sans invitation/i);
    expect(text).toMatch(/ne pourra pas se connecter/i);
  });

  it("bouton « Envoyer l'invitation » calls `onSend({ email, name? })`", async () => {
    const onSend = vi.fn(async () => {});
    const tree = serialize(
      Step7ManagerInviteForm(
        defaultProps({
          email: "send@example.fr",
          onSend,
        }),
      ),
    );
    const btn = findButtonByText(tree, /Envoyer l[''’]invitation/i) as {
      props: { onClick?: () => void | Promise<void>; disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).not.toBe(true);
    await btn?.props.onClick?.();
    expect(onSend).toHaveBeenCalledTimes(1);
    const arg = onSend.mock.calls[0]?.[0] as { email: string; name?: string };
    expect(arg.email).toBe("send@example.fr");
  });

  it("when an invite already exists: badge « Invitation envoyée [timestamp] » is shown", () => {
    // Use a fixed timestamp so the formatted output is deterministic.
    // 2026-03-15T09:42:00Z; the badge displays it in fr-FR locale.
    const sentAt = new Date("2026-03-15T09:42:00Z").getTime();
    const tree = serialize(
      Step7ManagerInviteForm(
        defaultProps({
          existingInvite: {
            sentAt,
            email: "gerant@example.fr",
            name: "Le Gérant",
          },
        }),
      ),
    );
    const text = allText(tree);
    // The badge text contains « Invitation envoyée » + a localised date/time.
    expect(text).toMatch(/Invitation envoy[ée]e/i);
    // The day fragment must appear in either UTC or local-tz formatting (we
    // accept both 15 and the surrounding numbers — the formatter uses fr-FR
    // DD/MM/YYYY, so 15/03/2026 should match).
    expect(text).toMatch(/15\/03\/2026|2026-03-15/);
  });

  it("when an invite exists: « Renvoyer l'invitation » button is rendered and fires `onSend`", async () => {
    const onSend = vi.fn(async () => {});
    const tree = serialize(
      Step7ManagerInviteForm(
        defaultProps({
          email: "resend@example.fr",
          existingInvite: {
            sentAt: Date.now(),
            email: "resend@example.fr",
            name: "Resend",
          },
          onSend,
        }),
      ),
    );
    const btn = findButtonByText(tree, /Renvoyer l[''’]invitation/i) as {
      props: { onClick?: () => void | Promise<void>; disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).not.toBe(true);
    await btn?.props.onClick?.();
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("« Continuer » button is ALWAYS active (« step non-bloquant ») and wired to `onNext`", () => {
    const onNext = vi.fn();
    const tree = serialize(Step7ManagerInviteForm(defaultProps({ onNext })));
    const btn = findButtonByText(tree, /Continuer|Suivant/i) as {
      props: { onClick?: () => void; disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).not.toBe(true);
    btn?.props.onClick?.();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("« Continuer » remains active even AFTER an invite has been sent (still non-bloquant)", () => {
    const onNext = vi.fn();
    const tree = serialize(
      Step7ManagerInviteForm(
        defaultProps({
          existingInvite: {
            sentAt: Date.now(),
            email: "x@example.fr",
            name: "x",
          },
          onNext,
        }),
      ),
    );
    const btn = findButtonByText(tree, /Continuer|Suivant/i) as {
      props: { onClick?: () => void; disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).not.toBe(true);
    btn?.props.onClick?.();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("« Précédent » button wired to `onPrev`", () => {
    const onPrev = vi.fn();
    const tree = serialize(Step7ManagerInviteForm(defaultProps({ onPrev })));
    const btn = findButtonByText(tree, /Pr[ée]c[ée]dent/i) as {
      props: { onClick?: () => void };
    } | null;
    expect(btn).not.toBeNull();
    btn?.props.onClick?.();
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("backend error (`sendError !== null`) is rendered inline", () => {
    const tree = serialize(
      Step7ManagerInviteForm(defaultProps({ sendError: "Email invalide" })),
    );
    const text = allText(tree);
    expect(text).toMatch(/Email invalide/);
  });

  it("send-in-flight state disables the « Envoyer » button", () => {
    const tree = serialize(
      Step7ManagerInviteForm(defaultProps({ isSending: true })),
    );
    const btn = findButtonByText(tree, /Envoyer/i) as {
      props: { disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).toBe(true);
  });

  it("send-in-flight state disables the « Renvoyer » button when invite exists", () => {
    const tree = serialize(
      Step7ManagerInviteForm(
        defaultProps({
          isSending: true,
          existingInvite: {
            sentAt: Date.now(),
            email: "x@example.fr",
            name: "x",
          },
        }),
      ),
    );
    const btn = findButtonByText(tree, /Renvoyer/i) as {
      props: { disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).toBe(true);
  });

  it("scope discipline: the form module does not import from `apps/web` or `apps/native`", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./step7-manager-invite-form.tsx"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
  });

  it("scope discipline: the form module does NOT call backend (zero `useMutation` / `useAction` / `useQuery`)", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./step7-manager-invite-form.tsx"),
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
