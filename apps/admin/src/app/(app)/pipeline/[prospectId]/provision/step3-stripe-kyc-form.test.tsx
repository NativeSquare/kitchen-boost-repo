/**
 * F-WIZARD [5/10] (#269) — `Step3StripeKycForm` test matrix.
 *
 * Pure presentational form for Step 3 of the provisioning wizard (Stripe
 * Connect KYC link). The Convex wiring (action `api.lib.stripe.account
 * .createStripeAccountLink`, prospect read via `api.lib.onboarding.crm
 * .getProspect`) and the clipboard / toast side-effects are owned by the
 * `Step3Form` wrapper in `step-forms.tsx` and threaded down as props
 * (`onGenerate`, `accountLinkUrl`, `isGenerating`, `genError`, `onCopy`,
 * `onPrev`, `onNext`). This keeps the form testable under the lean `node`
 * vitest env using the same React-tree serializer pattern as the wizard
 * view + step1-provisioning-form.
 *
 * Acceptance criteria covered (issue #269):
 *   - Bouton « Générer le lien Stripe KYC » avant première génération.
 *   - Click sur le bouton → appelle `onGenerate()`.
 *   - URL retournée affichée dans un champ read-only.
 *   - Bouton « Copier » → appelle `onCopy(url)`.
 *   - Bouton « Régénérer le lien » disponible après première génération.
 *   - Bouton « Continuer » → appelle `onNext`, toujours accessible (step
 *     non-bloquant).
 *   - Erreur backend (`genError !== null`) → message inline rendu.
 *   - Message d'aide affiché (« Transmets ce lien au gérant… »).
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// ---------------------------------------------------------------------------
// React hooks shim — same mirror as `step1-provisioning-form.test.tsx`. The
// lean `node` vitest env does not run a real React renderer; the shim lets
// us exercise stateful function components without paying the jsdom
// installation tax.
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
  };
});

const { Step3StripeKycForm } = await import("./step3-stripe-kyc-form");
type Step3StripeKycFormProps =
  import("./step3-stripe-kyc-form").Step3StripeKycFormProps;

// ---------------------------------------------------------------------------
// React-tree serializer — same shape as wizard-view.test.tsx / step1.
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ACCOUNT_LINK_URL =
  "https://connect.stripe.com/setup/e/acct_123/abcdefXYZ";

function defaultProps(
  overrides: Partial<Step3StripeKycFormProps> = {},
): Step3StripeKycFormProps {
  return {
    onGenerate: vi.fn(),
    accountLinkUrl: null,
    isGenerating: false,
    genError: null,
    onCopy: vi.fn(),
    onPrev: () => {},
    onNext: () => {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Step3StripeKycForm — F-WIZARD [5/10] (#269)", () => {
  it("initial render (no URL yet) — shows « Générer le lien Stripe KYC » button", () => {
    const tree = serialize(Step3StripeKycForm(defaultProps()));
    const generate = findBySlot(tree, "wizard-step3-generate");
    expect(generate).not.toBeNull();
    const text = allText(generate);
    expect(text).toMatch(/G[ée]n[ée]rer/i);
  });

  it("initial render shows the operator help message about transmitting the link", () => {
    const tree = serialize(Step3StripeKycForm(defaultProps()));
    const text = allText(tree);
    expect(text).toMatch(/Transmets|transmettre/i);
    expect(text).toMatch(/KYC/);
  });

  it("clicking « Générer » calls `onGenerate`", () => {
    const onGenerate = vi.fn();
    const tree = serialize(Step3StripeKycForm(defaultProps({ onGenerate })));
    const btn = findBySlot(tree, "wizard-step3-generate") as {
      props: { onClick?: () => void };
    } | null;
    btn?.props.onClick?.();
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("generate button is disabled while `isGenerating` is true (prevents double-fire)", () => {
    const tree = serialize(
      Step3StripeKycForm(defaultProps({ isGenerating: true })),
    );
    const btn = findBySlot(tree, "wizard-step3-generate") as {
      props: { disabled?: boolean };
    } | null;
    expect(btn?.props.disabled).toBe(true);
  });

  it("when `accountLinkUrl` is set, renders the URL in a read-only input", () => {
    const tree = serialize(
      Step3StripeKycForm(defaultProps({ accountLinkUrl: ACCOUNT_LINK_URL })),
    );
    const urlInput = findBySlot(tree, "wizard-step3-url-input") as {
      props: { value?: string; readOnly?: boolean };
    } | null;
    expect(urlInput).not.toBeNull();
    expect(urlInput?.props.value).toBe(ACCOUNT_LINK_URL);
    expect(urlInput?.props.readOnly).toBe(true);
  });

  it("when `accountLinkUrl` is set, renders a « Copier » button that calls `onCopy(url)`", () => {
    const onCopy = vi.fn();
    const tree = serialize(
      Step3StripeKycForm(
        defaultProps({ accountLinkUrl: ACCOUNT_LINK_URL, onCopy }),
      ),
    );
    const copyBtn = findBySlot(tree, "wizard-step3-copy") as {
      props: { onClick?: () => void };
    } | null;
    expect(copyBtn).not.toBeNull();
    copyBtn?.props.onClick?.();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledWith(ACCOUNT_LINK_URL);
  });

  it("when `accountLinkUrl` is set, replaces « Générer » CTA with a « Régénérer » button that also calls `onGenerate`", () => {
    const onGenerate = vi.fn();
    const tree = serialize(
      Step3StripeKycForm(
        defaultProps({ accountLinkUrl: ACCOUNT_LINK_URL, onGenerate }),
      ),
    );
    const regen = findBySlot(tree, "wizard-step3-regenerate");
    expect(regen).not.toBeNull();
    const text = allText(regen);
    expect(text).toMatch(/R[ée]g[ée]n[ée]rer/i);
    const regenBtn = regen as { props: { onClick?: () => void } } | null;
    regenBtn?.props.onClick?.();
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("backend error (`genError !== null`) → renders the error message inline", () => {
    const tree = serialize(
      Step3StripeKycForm(
        defaultProps({ genError: "Stripe API error: account disabled" }),
      ),
    );
    const errorEl = findBySlot(tree, "wizard-step3-error");
    expect(errorEl).not.toBeNull();
    expect(allText(errorEl)).toMatch(/Stripe API error/);
  });

  it("renders a « Continuer » button always (step non-bloquant) — calls `onNext`", () => {
    const onNext = vi.fn();
    const tree = serialize(Step3StripeKycForm(defaultProps({ onNext })));
    const next = findBySlot(tree, "wizard-step3-next");
    expect(next).not.toBeNull();
    const text = allText(next);
    expect(text).toMatch(/Continuer|Suivant/i);
    const nextBtn = next as { props: { onClick?: () => void } } | null;
    nextBtn?.props.onClick?.();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("« Continuer » remains active even on backend error (step non-bloquant)", () => {
    const tree = serialize(
      Step3StripeKycForm(
        defaultProps({
          genError: "Stripe API down",
          accountLinkUrl: null,
        }),
      ),
    );
    const next = findBySlot(tree, "wizard-step3-next") as {
      props: { disabled?: boolean };
    } | null;
    expect(next).not.toBeNull();
    expect(next?.props.disabled).not.toBe(true);
  });

  it("renders a « Précédent » button that calls `onPrev`", () => {
    const onPrev = vi.fn();
    const tree = serialize(Step3StripeKycForm(defaultProps({ onPrev })));
    const prev = findBySlot(tree, "wizard-step3-prev") as {
      props: { onClick?: () => void };
    } | null;
    expect(prev).not.toBeNull();
    prev?.props.onClick?.();
    expect(onPrev).toHaveBeenCalledTimes(1);
  });
});
