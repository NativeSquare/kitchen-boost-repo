/**
 * F-WIZARD [1/10] (#265) — `WizardStepper` test matrix.
 *
 * Stepper UI for the 8-step provisioning wizard. Pure presentational
 * component, pinned with the same React-tree serializer pattern used by
 * `wizard-view.test.tsx`.
 *
 * Acceptance criteria pinned (issue #265):
 *   - AC stepper — renders the 8 numbered steps with their short titles.
 *   - AC statut — each step renders with one of three visual states:
 *     `current` (highlight), `complete` (checked), `pending` (gray).
 *   - AC click — clicking a step ≤ currentStep fires `onStepChange(n)`;
 *     clicking a step > currentStep is a no-op (does NOT call onStepChange).
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { WIZARD_STEPS, WizardStepper } from "./wizard-stepper";

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

function findAllByDataSlot(n: SerializedNode, slot: string): SerializedNode[] {
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
      (x.props as { "data-slot"?: unknown })["data-slot"] === slot,
  );
}

describe("WIZARD_STEPS constant — F-WIZARD [1/10] (#265)", () => {
  it("exposes exactly 8 entries, numbered 1..8, in order", () => {
    expect(WIZARD_STEPS).toHaveLength(8);
    WIZARD_STEPS.forEach((step, idx) => {
      expect(step.number).toBe(idx + 1);
    });
  });

  it("step titles match the issue spec short titles", () => {
    const titles = WIZARD_STEPS.map((s) => s.title);
    expect(titles).toEqual([
      "Compte resto",
      "Domaine",
      "Stripe KYC",
      "Branding",
      "Menu",
      "QR",
      "Invitation",
      "Activer",
    ]);
  });
});

describe("WizardStepper — F-WIZARD [1/10] (#265)", () => {
  it("renders all 8 steps with their numbered titles", () => {
    const tree = serialize(
      WizardStepper({
        currentStep: 1,
        isStepComplete: () => false,
        onStepChange: () => {},
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/1\.\s*Compte resto/);
    expect(text).toMatch(/2\.\s*Domaine/);
    expect(text).toMatch(/3\.\s*Stripe KYC/);
    expect(text).toMatch(/4\.\s*Branding/);
    expect(text).toMatch(/5\.\s*Menu/);
    expect(text).toMatch(/6\.\s*QR/);
    expect(text).toMatch(/7\.\s*Invitation/);
    expect(text).toMatch(/8\.\s*Activer/);
  });

  it("each step renders with a data-state attribute reflecting current/complete/pending", () => {
    const tree = serialize(
      WizardStepper({
        currentStep: 3,
        isStepComplete: (n) => n < 3,
        onStepChange: () => {},
      }),
    );
    const stepNodes = findAllByDataSlot(tree, "wizard-step");
    expect(stepNodes.length).toBe(8);
    // Steps 1..2 complete, step 3 current, steps 4..8 pending.
    const states = stepNodes.map(
      (n) => (n as { props: { "data-state"?: string } }).props["data-state"],
    );
    expect(states).toEqual([
      "complete",
      "complete",
      "current",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
  });

  it("clicking a past step (≤ currentStep) fires `onStepChange(n)`", () => {
    const onStepChange = vi.fn();
    const tree = serialize(
      WizardStepper({
        currentStep: 5,
        isStepComplete: (n) => n < 5,
        onStepChange,
      }),
    );
    const stepNodes = findAllByDataSlot(tree, "wizard-step");
    const step2 = stepNodes[1] as { props: { onClick?: () => void } };
    expect(typeof step2.props.onClick).toBe("function");
    step2.props.onClick?.();
    expect(onStepChange).toHaveBeenCalledWith(2);
  });

  it("clicking the current step fires `onStepChange(currentStep)` (re-render itself, no-op semantically — but the handler must exist)", () => {
    const onStepChange = vi.fn();
    const tree = serialize(
      WizardStepper({
        currentStep: 4,
        isStepComplete: (n) => n < 4,
        onStepChange,
      }),
    );
    const stepNodes = findAllByDataSlot(tree, "wizard-step");
    const step4 = stepNodes[3] as { props: { onClick?: () => void } };
    step4.props.onClick?.();
    expect(onStepChange).toHaveBeenCalledWith(4);
  });

  it("clicking a future un-unlocked step is a no-op (AC #265: click step futur non-débloqué = no-op)", () => {
    const onStepChange = vi.fn();
    const tree = serialize(
      WizardStepper({
        currentStep: 2,
        isStepComplete: (n) => n < 2,
        onStepChange,
      }),
    );
    const stepNodes = findAllByDataSlot(tree, "wizard-step");
    // Steps 3..8 are future. Clicking any of them must NOT call
    // onStepChange (the issue spec is verbatim: « click sur un step futur
    // non-déverrouillé = no-op »).
    for (let i = 2; i < 8; i++) {
      const future = stepNodes[i] as { props: { onClick?: () => void } };
      future.props.onClick?.();
    }
    expect(onStepChange).not.toHaveBeenCalled();
  });
});
