/**
 * F-WIZARD [1/10] (#265) + [3/10] (#267) + [4/10] (#268) + [5/10] (#269) +
 * [6/10] (#270) + [7/10] (#271) + [8/10] (#272) + [9/10] (#273) + [10/10]
 * (#274) — Step{N}Form dispatch-map test.
 *
 * Every step now ships its own real form; the map is exhaustive, indexed
 * 1..8. Each form's behaviour is pinned in a dedicated test file:
 *   - Step 1 (#267) — `step1-provisioning-form.test.tsx`
 *   - Step 2 (#268) — `step2-domain-form.test.tsx`
 *   - Step 3 (#269) — `step3-stripe-kyc-form.test.tsx`
 *   - Step 4 (#270) — `step4-branding-form.test.tsx`
 *   - Step 5 (#271) — `step5-menu-form.test.tsx`
 *   - Step 6 (#272) — `step6-qr-form.test.tsx`
 *   - Step 7 (#273) — `step7-manager-invite-form.test.tsx`
 *   - Step 8 (#274) — `step8-activation-form.test.tsx`
 *
 * This file's role shrinks to ONE invariant: the `STEP_FORMS` map exposes
 * exactly 8 entries keyed `1..8`. Anything finer-grained belongs in a
 * step-specific test file.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

import { STEP_FORMS } from "./step-forms";

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

function findByText(n: SerializedNode, label: RegExp): SerializedNode | null {
  // Find the MOST SPECIFIC element whose own rendered text matches the
  // label — i.e. an interactive element (button) whose children carry the
  // label. We prefer nodes that look button-like (have an onClick handler)
  // so the click test actually targets the clickable surface rather than
  // an outer wrapper that happens to contain the same text.
  const candidates = flatten(n).filter((x) => {
    if (x === null || "text" in x) return false;
    const t = allText(x);
    return label.test(t);
  });
  // Prefer nodes carrying an onClick (the actual <button>); fall back to
  // the deepest match if none has a handler.
  const withHandler = candidates.find(
    (x) =>
      x !== null &&
      "props" in x &&
      typeof (x.props as { onClick?: unknown }).onClick === "function",
  );
  if (withHandler !== undefined) return withHandler;
  return candidates[candidates.length - 1] ?? null;
}

describe("STEP_FORMS — F-WIZARD [1/10] (#265) + [4/10] (#268)", () => {
  it("exposes exactly 8 step form components, indexed 1..8", () => {
    expect(Object.keys(STEP_FORMS).sort()).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
    ]);
  });

  it("F-WIZARD [4/10] (#268): step 2 is no longer a placeholder — the map binds the real Step2Form wrapper", () => {
    // The wrapper has its own `useQuery` calls so we can't render it under
    // the lean `node` env; the serializer's try/catch swallows the « invalid
    // hook call » and yields a typed stub. We only assert that the map slot
    // is now wired to a SEPARATE component (not the previous placeholder
    // factory `makeStepForm(2)`). The pure form's behaviour is pinned by
    // `step2-domain-form.test.tsx`.
    const Form = STEP_FORMS[2];
    expect(typeof Form).toBe("function");
    // The previous placeholder was named `Step2Form` via `makeStepForm(2)`'s
    // displayName. The new wrapper is also a function component named
    // `Step2Form`, so we just check it doesn't render the placeholder marker
    // « TODO Step 2 — Domaine » (the old placeholder body).
    let text = "";
    try {
      const tree = serialize(Form({ onPrev: () => {}, onNext: () => {} }));
      text = allText(tree);
    } catch {
      // Serializer threw — that's fine, the wrapper uses hooks. The mere
      // fact it threw confirms it's NOT the placeholder (the placeholder
      // returned plain JSX with no hooks).
      text = "";
    }
    expect(text).not.toMatch(/TODO\s+Step\s+2/i);
  });
});

// `findByText` was previously consumed by the placeholder tests removed
// above; kept here as a reference for future cross-step tests. Silence
// unused-import lint until then.
void findByText;
void vi;
