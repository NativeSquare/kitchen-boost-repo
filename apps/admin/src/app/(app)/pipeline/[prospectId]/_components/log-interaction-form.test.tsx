/**
 * F-PIPELINE-CRM 08 (#263) — `LogInteractionForm` test matrix.
 *
 * Pure presentational form (no Convex hooks, but uses `useState`).
 * Renders the note textarea + canal select. Date is server-stamped by
 * the backend `appendInteraction` helper (`Date.now()` in
 * `lib/tenancy/prospectsStore.ts` — the caller never forges it), so the
 * form does NOT expose a date picker (no-invent — the validator on
 * `logInteraction` only accepts `prospectId`, `note`, `canal`).
 *
 * React hooks shim — mirror of `generate-contract-modal.test.tsx` so the
 * lean `node` vitest env can expand the form's first render.
 */
import { describe, expect, it, vi } from "vitest";

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

const { LogInteractionForm } = await import("./log-interaction-form");
type LogInteractionFormProps =
  import("./log-interaction-form").LogInteractionFormProps;

const { allText, flatten, serialize } =
  await import("../../_components/test-utils");

type SerializedShape = ReturnType<typeof serialize>;

function baseProps(
  overrides: Partial<LogInteractionFormProps> = {},
): LogInteractionFormProps {
  return {
    isSubmitting: false,
    submitError: null,
    onSubmit: vi.fn(async () => {}),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("LogInteractionForm — F-PIPELINE-CRM 08 (#263)", () => {
  it("renders a textarea for the note and a canal select", () => {
    const tree = serialize(LogInteractionForm(baseProps()));
    const textareas = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedShape[];
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "log-interaction-note",
    );
    expect(textareas.length).toBeGreaterThan(0);

    const canalControls = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedShape[];
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "log-interaction-canal",
    );
    expect(canalControls.length).toBeGreaterThan(0);
  });

  it("renders all 4 canonical canal options (acquisitionSource validator)", () => {
    const tree = serialize(LogInteractionForm(baseProps()));
    const text = allText(tree);
    expect(text).toMatch(/cold\s*call/i);
    expect(text).toMatch(/whatsapp/i);
    expect(text).toMatch(/r[ée]f[ée]rence|referral/i);
    expect(text).toMatch(/visite|physique/i);
  });

  it("disables submit when the note is empty (data-can-submit=false)", () => {
    const tree = serialize(LogInteractionForm(baseProps()));
    const submitBtns = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedShape[];
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "log-interaction-submit",
    );
    expect(submitBtns.length).toBe(1);
    expect(submitBtns[0].props["data-can-submit"]).toBe(false);
  });

  it('surfaces a `data-can-submit="true"` on the submit button when the form would be valid (pre-filled note)', () => {
    const tree = serialize(
      LogInteractionForm(
        baseProps({
          initialNote: "appel intéressé",
          initialCanal: "cold_call",
        }),
      ),
    );
    const submitBtns = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedShape[];
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "log-interaction-submit",
    );
    expect(submitBtns[0]?.props["data-can-submit"]).toBe(true);
  });

  it("disables the submit button when isSubmitting is true", () => {
    const tree = serialize(
      LogInteractionForm(
        baseProps({
          isSubmitting: true,
          initialNote: "x",
          initialCanal: "cold_call",
        }),
      ),
    );
    const submitBtns = flatten(tree).filter(
      (
        n,
      ): n is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedShape[];
      } =>
        n !== null &&
        "type" in n &&
        (n.props as Record<string, unknown>)["data-slot"] ===
          "log-interaction-submit",
    );
    expect(submitBtns[0]?.props["disabled"]).toBe(true);
  });

  it("surfaces submitError inline when set", () => {
    const tree = serialize(
      LogInteractionForm(baseProps({ submitError: "Boom" })),
    );
    expect(allText(tree)).toContain("Boom");
  });
});
