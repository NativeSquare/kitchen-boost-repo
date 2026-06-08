/**
 * `UberDirectSettingsView` — pure presentational view for the « Uber Direct
 * a posteriori » page. Mirror of `stripe-settings-view.test.tsx` (same
 * React-tree serializer + react-hooks shim under the lean `node` vitest env).
 *
 * Pinned branches :
 *   - status `not-configured` → form rendered, probe block hidden
 *   - status `configured`     → probe block visible (no probe result yet)
 *   - status `probe-ok`       → probe result block + checkmark lines
 *   - status `probe-failed`   → probe error block, no success lines
 *   - save button disabled when required fields are empty
 *   - save button calls `onSave` when all required fields present
 *   - typing in any field calls `onFormChange(field, value)`
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

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

const { UberDirectSettingsView } = await import("./uber-direct-settings-view");
type UberDirectSettingsViewProps =
  import("./uber-direct-settings-view").UberDirectSettingsViewProps;

// ---------------------------------------------------------------------------
// React-tree serializer
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
function emptyForm() {
  return {
    clientId: "",
    clientSecret: "",
    customerId: "",
    webhookSigningKey: "",
  };
}
function filledForm() {
  return {
    clientId: "cl_test_abc",
    clientSecret: "sec_test_xyz",
    customerId: "cust_test_123",
    webhookSigningKey: "",
  };
}

function defaultProps(
  overrides: Partial<UberDirectSettingsViewProps> = {},
): UberDirectSettingsViewProps {
  return {
    tenantName: "Le Petit Bistrot",
    isConfigured: false,
    form: emptyForm(),
    onFormChange: vi.fn(),
    isSaving: false,
    onSave: vi.fn(),
    saveError: null,
    isProbing: false,
    onProbe: vi.fn(),
    probeResult: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("UberDirectSettingsView — status card", () => {
  it("not configured → renders « Non configuré »", () => {
    const tree = serialize(UberDirectSettingsView(defaultProps()));
    const status = findBySlot(tree, "uber-settings-status");
    expect(status).not.toBeNull();
    expect(allText(status)).toMatch(/Non configur/i);
  });

  it("configured + no probe → renders « Configuré »", () => {
    const tree = serialize(
      UberDirectSettingsView(defaultProps({ isConfigured: true })),
    );
    const status = findBySlot(tree, "uber-settings-status");
    // Match the « Configuré » bare label (not « Configuré · Connexion … »
    // which is the probe-ok / probe-failed variant).
    expect(allText(status)).toMatch(/Configur[ée] Les credentials/i);
  });

  it("configured + probe ok → renders « Connexion validée »", () => {
    const tree = serialize(
      UberDirectSettingsView(
        defaultProps({
          isConfigured: true,
          probeResult: {
            ok: true,
            customerId: "cust_x",
            tokenObtained: true,
            customerReachable: true,
            hasWebhookSigningKey: true,
            deliveryCountSample: 0,
          },
        }),
      ),
    );
    const status = findBySlot(tree, "uber-settings-status");
    expect(allText(status)).toMatch(/Connexion valid/i);
  });

  it("configured + probe failed → renders « Erreur de connexion »", () => {
    const tree = serialize(
      UberDirectSettingsView(
        defaultProps({
          isConfigured: true,
          probeResult: { ok: false, error: "Uber OAuth error: invalid_client" },
        }),
      ),
    );
    const status = findBySlot(tree, "uber-settings-status");
    expect(allText(status)).toMatch(/Erreur de connexion/i);
  });
});

describe("UberDirectSettingsView — form & save", () => {
  it("renders the 4 credential inputs", () => {
    const tree = serialize(UberDirectSettingsView(defaultProps()));
    expect(findBySlot(tree, "uber-settings-client-id")).not.toBeNull();
    expect(findBySlot(tree, "uber-settings-client-secret")).not.toBeNull();
    expect(findBySlot(tree, "uber-settings-customer-id")).not.toBeNull();
    expect(findBySlot(tree, "uber-settings-webhook-key")).not.toBeNull();
  });

  it("save button is DISABLED when required fields are empty", () => {
    const tree = serialize(UberDirectSettingsView(defaultProps()));
    const btn = findBySlot(tree, "uber-settings-save") as {
      props: { disabled?: boolean };
    } | null;
    expect(btn?.props.disabled).toBe(true);
  });

  it("save button is DISABLED when only webhook key is empty (others filled)", () => {
    // Filled form has clientId/secret/customerId but empty webhookSigningKey
    // → that's OK, the field is optional → button should be ENABLED.
    const tree = serialize(
      UberDirectSettingsView(defaultProps({ form: filledForm() })),
    );
    const btn = findBySlot(tree, "uber-settings-save") as {
      props: { disabled?: boolean };
    } | null;
    expect(btn?.props.disabled).toBe(false);
  });

  it("save button is DISABLED while saving", () => {
    const tree = serialize(
      UberDirectSettingsView(
        defaultProps({ form: filledForm(), isSaving: true }),
      ),
    );
    const btn = findBySlot(tree, "uber-settings-save") as {
      props: { disabled?: boolean };
    } | null;
    expect(btn?.props.disabled).toBe(true);
  });

  it("clicking save calls `onSave`", () => {
    const onSave = vi.fn();
    const tree = serialize(
      UberDirectSettingsView(defaultProps({ form: filledForm(), onSave })),
    );
    const btn = findBySlot(tree, "uber-settings-save") as {
      props: { onClick?: () => void };
    } | null;
    btn?.props.onClick?.();
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("typing in clientId calls `onFormChange('clientId', value)`", () => {
    const onFormChange = vi.fn();
    const tree = serialize(
      UberDirectSettingsView(defaultProps({ onFormChange })),
    );
    const input = findBySlot(tree, "uber-settings-client-id") as {
      props: { onChange?: (e: { target: { value: string } }) => void };
    } | null;
    input?.props.onChange?.({ target: { value: "cl_new_value" } });
    expect(onFormChange).toHaveBeenCalledWith("clientId", "cl_new_value");
  });

  it("saveError renders inline next to save button", () => {
    const tree = serialize(
      UberDirectSettingsView(
        defaultProps({
          form: filledForm(),
          saveError: "VALIDATION: clientId must be non-empty",
        }),
      ),
    );
    const err = findBySlot(tree, "uber-settings-save-error");
    expect(err).not.toBeNull();
    expect(allText(err)).toMatch(/VALIDATION/i);
  });

  it("button label switches to « Mettre à jour » when isConfigured", () => {
    const tree = serialize(
      UberDirectSettingsView(
        defaultProps({ form: filledForm(), isConfigured: true }),
      ),
    );
    const btn = findBySlot(tree, "uber-settings-save");
    expect(allText(btn)).toMatch(/Mettre [àa] jour/i);
  });
});

describe("UberDirectSettingsView — probe block", () => {
  it("not configured → probe block is HIDDEN", () => {
    const tree = serialize(UberDirectSettingsView(defaultProps()));
    expect(findBySlot(tree, "uber-settings-probe-block")).toBeNull();
  });

  it("configured → probe block is VISIBLE", () => {
    const tree = serialize(
      UberDirectSettingsView(defaultProps({ isConfigured: true })),
    );
    expect(findBySlot(tree, "uber-settings-probe-block")).not.toBeNull();
    expect(findBySlot(tree, "uber-settings-probe")).not.toBeNull();
  });

  it("clicking probe calls `onProbe`", () => {
    const onProbe = vi.fn();
    const tree = serialize(
      UberDirectSettingsView(defaultProps({ isConfigured: true, onProbe })),
    );
    const btn = findBySlot(tree, "uber-settings-probe") as {
      props: { onClick?: () => void };
    } | null;
    btn?.props.onClick?.();
    expect(onProbe).toHaveBeenCalledTimes(1);
  });

  it("probe button disabled while isProbing", () => {
    const tree = serialize(
      UberDirectSettingsView(
        defaultProps({ isConfigured: true, isProbing: true }),
      ),
    );
    const btn = findBySlot(tree, "uber-settings-probe") as {
      props: { disabled?: boolean };
    } | null;
    expect(btn?.props.disabled).toBe(true);
  });

  it("probe ok → renders the success block with the 3 fact lines", () => {
    const tree = serialize(
      UberDirectSettingsView(
        defaultProps({
          isConfigured: true,
          probeResult: {
            ok: true,
            customerId: "cust_test_123",
            tokenObtained: true,
            customerReachable: true,
            hasWebhookSigningKey: false,
            deliveryCountSample: 0,
          },
        }),
      ),
    );
    const block = findBySlot(tree, "uber-settings-probe-result");
    expect(block).not.toBeNull();
    const text = allText(block);
    expect(text).toMatch(/OAuth client-credentials/i);
    expect(text).toMatch(/customer_id reconnu/i);
    expect(text).toMatch(/Webhook signing key/i);
    expect(text).toContain("cust_test_123");
  });

  it("probe failed → renders the error block, no success block", () => {
    const tree = serialize(
      UberDirectSettingsView(
        defaultProps({
          isConfigured: true,
          probeResult: { ok: false, error: "Uber OAuth error: invalid_client" },
        }),
      ),
    );
    const err = findBySlot(tree, "uber-settings-probe-error");
    expect(err).not.toBeNull();
    expect(allText(err)).toMatch(/invalid_client/);
    expect(findBySlot(tree, "uber-settings-probe-result")).toBeNull();
  });
});
