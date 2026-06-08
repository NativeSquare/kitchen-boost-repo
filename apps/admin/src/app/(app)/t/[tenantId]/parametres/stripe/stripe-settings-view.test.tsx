/**
 * `StripeSettingsView` — pure presentational view for the « Stripe Connect
 * a posteriori » page (mirrors the `Step3StripeKycForm` test matrix from
 * the wizard, extended with the status-card branches that the wizard does
 * NOT carry).
 *
 * The page mounts ONE view: it renders the status card (no Stripe / pending /
 * ready / disabled) + the generate / regenerate CTA + the URL display + the
 * inline error. The Convex wiring (read of the tenant's Stripe state via
 * the new `api.lib.admin.tenantSettings.getStripeState` query, action call
 * `api.lib.stripe.account.createStripeAccountLink`) and the clipboard /
 * toast side-effects are owned by the parent `page.tsx` and threaded down
 * as props (`onGenerate`, `accountLink`, `isGenerating`, `genError`,
 * `onCopy`).
 *
 * Pinned branches:
 *   - status `no-account`   → « Non configuré » + Générer CTA
 *   - status `pending`      → « En attente de KYC » + acct_xxx + Régénérer
 *   - status `ready`        → « Prêt à recevoir les paiements » (badge vert)
 *                              + acct_xxx + Régénérer
 *   - status `disabled`     → « Refusé / Désactivé » + acct_xxx + Régénérer
 *   - URL present           → input read-only + Copier
 *   - isGenerating          → CTA disabled (prevents double-fire)
 *   - genError !== null     → inline error rendered
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// React hooks shim — same mirror as `step3-stripe-kyc-form.test.tsx`. The lean
// node vitest env does not run a real React renderer; the shim lets us exercise
// stateful function components without paying the jsdom installation tax.
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

const { StripeSettingsView } = await import("./stripe-settings-view");
type StripeSettingsViewProps =
  import("./stripe-settings-view").StripeSettingsViewProps;

// ---------------------------------------------------------------------------
// React-tree serializer — same shape as `step3-stripe-kyc-form.test.tsx`.
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
const ACCOUNT_ID = "acct_1ABCdefGHI";
const ACCOUNT_LINK_URL =
  "https://connect.stripe.com/setup/e/acct_1ABCdefGHI/abcdefXYZ";

function defaultProps(
  overrides: Partial<StripeSettingsViewProps> = {},
): StripeSettingsViewProps {
  return {
    tenantName: "Le Petit Bistrot",
    stripeAccountId: undefined,
    stripeStatus: undefined,
    accountLink: null,
    isGenerating: false,
    genError: null,
    onGenerate: vi.fn(),
    onCopy: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("StripeSettingsView — status card matrix", () => {
  it("no Stripe account → renders the « Non configuré » status", () => {
    const tree = serialize(StripeSettingsView(defaultProps()));
    const status = findBySlot(tree, "stripe-settings-status");
    expect(status).not.toBeNull();
    const text = allText(status);
    expect(text).toMatch(/Non configur[ée]/i);
  });

  it("status `pending` → renders the « En attente de KYC » status + acct_xxx", () => {
    const tree = serialize(
      StripeSettingsView(
        defaultProps({
          stripeAccountId: ACCOUNT_ID,
          stripeStatus: "pending",
        }),
      ),
    );
    const status = findBySlot(tree, "stripe-settings-status");
    expect(status).not.toBeNull();
    expect(allText(status)).toMatch(/attente de KYC/i);
    const accountInput = findBySlot(tree, "stripe-settings-account-id") as {
      props: { value?: string };
    } | null;
    expect(accountInput).not.toBeNull();
    expect(accountInput?.props.value).toBe(ACCOUNT_ID);
  });

  it("status `ready` → renders the green « Prêt à recevoir les paiements » badge + acct_xxx", () => {
    const tree = serialize(
      StripeSettingsView(
        defaultProps({
          stripeAccountId: ACCOUNT_ID,
          stripeStatus: "ready",
        }),
      ),
    );
    const status = findBySlot(tree, "stripe-settings-status");
    expect(status).not.toBeNull();
    expect(allText(status)).toMatch(/Pr[êe]t [àa] recevoir les paiements/i);
    const badge = findBySlot(tree, "stripe-settings-badge-ready");
    expect(badge).not.toBeNull();
    const accountInput = findBySlot(tree, "stripe-settings-account-id") as {
      props: { value?: string };
    } | null;
    expect(accountInput?.props.value).toBe(ACCOUNT_ID);
  });

  it("status `disabled` → renders the « Refusé / Désactivé » status + acct_xxx", () => {
    const tree = serialize(
      StripeSettingsView(
        defaultProps({
          stripeAccountId: ACCOUNT_ID,
          stripeStatus: "disabled",
        }),
      ),
    );
    const status = findBySlot(tree, "stripe-settings-status");
    expect(status).not.toBeNull();
    expect(allText(status)).toMatch(
      /Refus[ée].*D[ée]sactiv[ée]|D[ée]sactiv[ée]/i,
    );
    const accountInput = findBySlot(tree, "stripe-settings-account-id") as {
      props: { value?: string };
    } | null;
    expect(accountInput?.props.value).toBe(ACCOUNT_ID);
  });
});

describe("StripeSettingsView — generate / regenerate CTA", () => {
  it("no account yet → renders « Générer un lien Stripe Connect » CTA", () => {
    const tree = serialize(StripeSettingsView(defaultProps()));
    const generate = findBySlot(tree, "stripe-settings-generate");
    expect(generate).not.toBeNull();
    expect(allText(generate)).toMatch(/G[ée]n[ée]rer/i);
  });

  it("clicking « Générer » calls `onGenerate`", () => {
    const onGenerate = vi.fn();
    const tree = serialize(StripeSettingsView(defaultProps({ onGenerate })));
    const btn = findBySlot(tree, "stripe-settings-generate") as {
      props: { onClick?: () => void };
    } | null;
    btn?.props.onClick?.();
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });

  it("generate button is disabled while `isGenerating` is true", () => {
    const tree = serialize(
      StripeSettingsView(defaultProps({ isGenerating: true })),
    );
    const btn = findBySlot(tree, "stripe-settings-generate") as {
      props: { disabled?: boolean };
    } | null;
    expect(btn?.props.disabled).toBe(true);
  });

  it("account already exists (any status) → renders « Régénérer » instead of « Générer »", () => {
    const onGenerate = vi.fn();
    const tree = serialize(
      StripeSettingsView(
        defaultProps({
          stripeAccountId: ACCOUNT_ID,
          stripeStatus: "pending",
          onGenerate,
        }),
      ),
    );
    const regen = findBySlot(tree, "stripe-settings-regenerate");
    expect(regen).not.toBeNull();
    expect(allText(regen)).toMatch(/R[ée]g[ée]n[ée]rer/i);
    const btn = regen as { props: { onClick?: () => void } } | null;
    btn?.props.onClick?.();
    expect(onGenerate).toHaveBeenCalledTimes(1);
  });
});

describe("StripeSettingsView — generated URL display", () => {
  it("when `accountLink` is set, renders the URL in a read-only input", () => {
    const tree = serialize(
      StripeSettingsView(defaultProps({ accountLink: ACCOUNT_LINK_URL })),
    );
    const urlInput = findBySlot(tree, "stripe-settings-url-input") as {
      props: { value?: string; readOnly?: boolean };
    } | null;
    expect(urlInput).not.toBeNull();
    expect(urlInput?.props.value).toBe(ACCOUNT_LINK_URL);
    expect(urlInput?.props.readOnly).toBe(true);
  });

  it("renders a « Copier » button that calls `onCopy(url)`", () => {
    const onCopy = vi.fn();
    const tree = serialize(
      StripeSettingsView(
        defaultProps({ accountLink: ACCOUNT_LINK_URL, onCopy }),
      ),
    );
    const copyBtn = findBySlot(tree, "stripe-settings-copy") as {
      props: { onClick?: () => void };
    } | null;
    expect(copyBtn).not.toBeNull();
    copyBtn?.props.onClick?.();
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledWith(ACCOUNT_LINK_URL);
  });

  it("no URL yet → no URL input nor Copier rendered", () => {
    const tree = serialize(StripeSettingsView(defaultProps()));
    expect(findBySlot(tree, "stripe-settings-url-input")).toBeNull();
    expect(findBySlot(tree, "stripe-settings-copy")).toBeNull();
  });
});

describe("StripeSettingsView — inline error", () => {
  it("backend error → renders the error message inline", () => {
    const tree = serialize(
      StripeSettingsView(
        defaultProps({ genError: "Stripe API error: account disabled" }),
      ),
    );
    const errorEl = findBySlot(tree, "stripe-settings-error");
    expect(errorEl).not.toBeNull();
    expect(allText(errorEl)).toMatch(/Stripe API error/);
  });

  it("no error → no error slot rendered", () => {
    const tree = serialize(StripeSettingsView(defaultProps()));
    expect(findBySlot(tree, "stripe-settings-error")).toBeNull();
  });
});

describe("StripeSettingsView — page header", () => {
  it("renders the tenant name in the header", () => {
    const tree = serialize(
      StripeSettingsView(defaultProps({ tenantName: "Chez Mario" })),
    );
    const text = allText(tree);
    expect(text).toContain("Chez Mario");
  });

  it("renders the « Stripe Connect » page title", () => {
    const tree = serialize(StripeSettingsView(defaultProps()));
    const text = allText(tree);
    expect(text).toMatch(/Stripe Connect/i);
  });
});
