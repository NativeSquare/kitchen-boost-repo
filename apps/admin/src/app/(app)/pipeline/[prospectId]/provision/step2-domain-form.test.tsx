/**
 * F-WIZARD [4/10] (#268) — `Step2DomainForm` test matrix.
 *
 * Pure presentational form for Step 2 of the provisioning wizard (« domaine
 * personnalisé optionnel », modèle Owner.com). The Convex wiring (read
 * tenant via `loadTenantForStripe`, mutation `tenant.updateSettings({ patch:
 * { customDomain }})`) is owned by the wrapper in `step-forms.tsx` and
 * threaded down as props (`initialCustomDomain`, `bootstrapHost`,
 * `onSave`, `isSubmitting`, `submitError`, `onSkip`). Same testability
 * pattern as `Step1ProvisioningForm` / `Step4BrandingForm`.
 *
 * Acceptance criteria covered (issue #268):
 *   - Render the `customDomain` input + the bootstrap sub-domain read-only
 *     for info.
 *   - Pre-fill from the persisted value (re-visite).
 *   - Client-side validation when the field is filled (regex
 *     `^[a-z0-9.-]+\.[a-z]{2,}$`); submit disabled on invalid input.
 *   - Empty input is allowed for submit (server-side it would be a no-op);
 *     the « Skip » button is the explicit no-mutation path.
 *   - Submit calls `onSave({ customDomain })` with the trimmed value.
 *   - Skip calls `onSkip()` (no mutation).
 *   - Backend error surfaced inline.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// React shim — same shape as `step1-provisioning-form.test.tsx`. Initial-
// render only; `useState` returns the seed + a no-op setter. Sufficient to
// assert on the rendered tree given initial props.
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

const { Step2DomainForm } = await import("./step2-domain-form");
type Step2DomainFormProps = import("./step2-domain-form").Step2DomainFormProps;

// React-tree serializer — verbatim from step1's test file.
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
function findInputByName(
  n: SerializedNode,
  name: string,
): SerializedNode | null {
  const matches = findAll(
    n,
    (x) => "props" in x && (x.props as { name?: string }).name === name,
  );
  return matches[0] ?? null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function defaultProps(
  overrides: Partial<Step2DomainFormProps> = {},
): Step2DomainFormProps {
  return {
    initialCustomDomain: undefined,
    bootstrapHost: "lartisan.kitchen-boost.fr",
    onSave: vi.fn().mockResolvedValue(undefined),
    onSkip: vi.fn(),
    isSubmitting: false,
    submitError: null,
    onPrev: () => {},
    onNext: () => {},
    ...overrides,
  };
}

describe("Step2DomainForm — F-WIZARD [4/10] (#268)", () => {
  it("renders the `customDomain` input + the bootstrap host (read-only display)", () => {
    const tree = serialize(Step2DomainForm(defaultProps()));
    expect(findInputByName(tree, "customDomain")).not.toBeNull();
    // The bootstrap host is rendered somewhere in the tree for info.
    expect(allText(tree)).toContain("lartisan.kitchen-boost.fr");
  });

  it("pre-fills the input from `initialCustomDomain` (re-visite après save)", () => {
    const tree = serialize(
      Step2DomainForm(
        defaultProps({ initialCustomDomain: "commander.le-petit-bistrot.fr" }),
      ),
    );
    const input = findInputByName(tree, "customDomain") as {
      props: { value?: string };
    } | null;
    expect(input?.props.value).toBe("commander.le-petit-bistrot.fr");
  });

  it("renders an empty input when no value is persisted", () => {
    const tree = serialize(Step2DomainForm(defaultProps()));
    const input = findInputByName(tree, "customDomain") as {
      props: { value?: string };
    } | null;
    expect(input?.props.value).toBe("");
  });

  it("renders the « Skip » button (rester sur le sous-domaine bootstrap)", () => {
    const tree = serialize(Step2DomainForm(defaultProps()));
    expect(findBySlot(tree, "wizard-step2-skip")).not.toBeNull();
  });

  it("renders the « Enregistrer et continuer » submit button", () => {
    const tree = serialize(Step2DomainForm(defaultProps()));
    expect(findBySlot(tree, "wizard-step2-submit")).not.toBeNull();
  });

  it("submit is enabled when the input is empty (treated as a no-op save by the parent OR the operator can use Skip)", () => {
    // Empty input — submit is technically allowed (no validation error to
    // surface yet) but the parent typically funnels this through `onSkip`
    // via a separate button. The form does NOT force-disable on empty so
    // the operator can clear a previously-saved domain by submitting empty
    // (V1 contract: empty input = no patch fired, the parent decides).
    const tree = serialize(Step2DomainForm(defaultProps()));
    const submit = findBySlot(tree, "wizard-step2-submit") as {
      props: { disabled?: boolean };
    } | null;
    expect(submit?.props.disabled).toBe(false);
  });

  it("submit is DISABLED when the input is filled but invalid (regex)", () => {
    const tree = serialize(
      Step2DomainForm(defaultProps({ initialCustomDomain: "not-a-domain" })),
    );
    const submit = findBySlot(tree, "wizard-step2-submit") as {
      props: { disabled?: boolean };
    } | null;
    expect(submit?.props.disabled).toBe(true);
  });

  it("submit is DISABLED when the input has uppercase (FQDN convention is lowercase)", () => {
    const tree = serialize(
      Step2DomainForm(defaultProps({ initialCustomDomain: "Artisan.fr" })),
    );
    const submit = findBySlot(tree, "wizard-step2-submit") as {
      props: { disabled?: boolean };
    } | null;
    expect(submit?.props.disabled).toBe(true);
  });

  it("submit is ENABLED when the input is a valid FQDN", () => {
    const tree = serialize(
      Step2DomainForm(
        defaultProps({ initialCustomDomain: "commander.le-petit-bistrot.fr" }),
      ),
    );
    const submit = findBySlot(tree, "wizard-step2-submit") as {
      props: { disabled?: boolean };
    } | null;
    expect(submit?.props.disabled).toBe(false);
  });

  it("submit is DISABLED while a save is in flight (isSubmitting)", () => {
    const tree = serialize(
      Step2DomainForm(
        defaultProps({
          initialCustomDomain: "valid.fr",
          isSubmitting: true,
        }),
      ),
    );
    const submit = findBySlot(tree, "wizard-step2-submit") as {
      props: { disabled?: boolean };
    } | null;
    expect(submit?.props.disabled).toBe(true);
  });

  it("clicking submit calls onSave with the trimmed customDomain", () => {
    const onSave = vi
      .fn<(p: { customDomain: string }) => Promise<void>>()
      .mockResolvedValue(undefined);
    const tree = serialize(
      Step2DomainForm(
        defaultProps({
          initialCustomDomain: "commander.le-petit-bistrot.fr",
          onSave,
        }),
      ),
    );
    const submit = findBySlot(tree, "wizard-step2-submit") as {
      props: { onClick?: () => void };
    } | null;
    submit?.props.onClick?.();
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0]?.[0]).toEqual({
      customDomain: "commander.le-petit-bistrot.fr",
    });
  });

  it("clicking Skip calls onSkip (NO save fired)", () => {
    const onSkip = vi.fn();
    const onSave = vi.fn();
    const tree = serialize(Step2DomainForm(defaultProps({ onSkip, onSave })));
    const skip = findBySlot(tree, "wizard-step2-skip") as {
      props: { onClick?: () => void };
    } | null;
    skip?.props.onClick?.();
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("surfaces the backend error inline when `submitError` is set", () => {
    const tree = serialize(
      Step2DomainForm(
        defaultProps({
          submitError: "Domain already taken",
        }),
      ),
    );
    const errorNode = findBySlot(tree, "wizard-step2-submit-error");
    expect(errorNode).not.toBeNull();
    expect(allText(errorNode)).toContain("Domain already taken");
  });

  it("shows an inline validation hint when the input is filled but invalid", () => {
    const tree = serialize(
      Step2DomainForm(defaultProps({ initialCustomDomain: "not-a-domain" })),
    );
    expect(findBySlot(tree, "wizard-step2-validation-hint")).not.toBeNull();
  });

  it("does NOT show the validation hint on an empty input (only on filled-invalid)", () => {
    const tree = serialize(Step2DomainForm(defaultProps()));
    expect(findBySlot(tree, "wizard-step2-validation-hint")).toBeNull();
  });
});
