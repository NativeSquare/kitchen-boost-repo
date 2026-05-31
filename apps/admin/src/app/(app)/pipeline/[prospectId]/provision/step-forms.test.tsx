/**
 * F-WIZARD [1/10] (#265) + [3/10] (#267) + [5/10] (#269) + [6/10] (#270) +
 * [7/10] (#271) + [8/10] (#272) — Step{N}Form placeholders test matrix.
 *
 * Each step renders a placeholder « TODO Step N » + Prev/Next nav buttons,
 * EXCEPT Step 1 (real form, #267), Step 3 (real form, #269), Step 4 (real
 * form, #270), Step 5 (real form, #271) and Step 6 (real form, #272) which
 * are pinned by their own test files (`step1-provisioning-form.test.tsx` /
 * `step3-stripe-kyc-form.test.tsx` / `step4-branding-form.test.tsx` /
 * `step5-menu-form.test.tsx` / `step6-qr-form.test.tsx`). The placeholder
 * slots for the remaining steps (2, 7..8) stay stable so each follow-up
 * wizard slice can replace its own Step{N}Form without touching the wizard
 * shell.
 *
 * Why Step 1 / Step 3 / Step 4 / Step 5 / Step 6 are excluded from the placeholder iterations:
 * ---------------------------------------------------------------------------
 * Step 1 (« Compte resto ») is the SLICE CHARNIÈRE — without the provisioned
 * tenant, no subsequent step has an object to operate on. Step 3 (« Stripe
 * KYC ») is non-blocking but ships its own real form (generate / regenerate
 * link, copy-to-clipboard, continue). Step 4 (« Branding ») composes the
 * three reusable F-PARAMETRES editors (BrandingEditor + CoordonneesEditor +
 * ModesEditor) — its surface doesn't fit the « TODO Step N » placeholder
 * shape either. Step 5 (« Menu ») reuses the F-MENU editor surface
 * (categories + items + modifier groups CRUD) and layers a publish + gate UX
 * — also unfit for the « TODO Step N » shape. Step 6 (« QR sticker PDF »)
 * reuses the F-QR `QrGeneratorView` (#182) — same shape constraint. Each
 * form's contract is pinned in its own test file.
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

describe("STEP_FORMS — F-WIZARD [1/10] (#265)", () => {
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

  it("each placeholder form renders a placeholder mentioning its own step number (« Step N » or « Étape N »)", () => {
    // Step 1 (#267), Step 3 (#269), Step 4 (#270), Step 5 (#271) and Step 6
    // (#272) are real forms — pinned by their own test files, not by this
    // placeholder loop.
    for (const n of [2, 7, 8] as const) {
      const Form = STEP_FORMS[n];
      const tree = serialize(Form({ onPrev: () => {}, onNext: () => {} }));
      const text = allText(tree);
      // Either « Step N » or « Étape N » is acceptable; pinning either form
      // keeps the placeholder explicit but lets the FR copy improve later.
      expect(text).toMatch(new RegExp(`(Step|[ÉE]tape)\\s*${n}`, "i"));
    }
  });

  it("each form renders a « Précédent » button that triggers onPrev (Step 1's Précédent is disabled but still wired — issue spec « boutons Précédent / Suivant qui naviguent »)", () => {
    for (const n of [2, 7, 8] as const) {
      const Form = STEP_FORMS[n];
      const onPrev = vi.fn();
      const tree = serialize(Form({ onPrev, onNext: () => {} }));
      const prevBtn = findByText(tree, /Pr[ée]c[ée]dent/i);
      expect(prevBtn).not.toBeNull();
      const btn = prevBtn as { props: { onClick?: () => void } };
      btn.props.onClick?.();
      expect(onPrev).toHaveBeenCalledTimes(1);
    }
  });

  it("each placeholder form (steps 2, 7) renders a « Suivant » button that triggers onNext", () => {
    // Step 1 (« Créer le tenant » submit), Step 3 (« Continuer »), Step 4
    // (« Suivant » via composite nav strip), Step 5 (« Continuer » with
    // publication gate) and Step 6 (« Continuer » non-bloquant after the QR
    // PDF preview) own their own next-button UX — pinned in their respective
    // test files.
    for (const n of [2, 7] as const) {
      const Form = STEP_FORMS[n];
      const onNext = vi.fn();
      const tree = serialize(Form({ onPrev: () => {}, onNext }));
      const nextBtn = findByText(tree, /Suivant/i);
      expect(nextBtn).not.toBeNull();
      const btn = nextBtn as { props: { onClick?: () => void } };
      btn.props.onClick?.();
      expect(onNext).toHaveBeenCalledTimes(1);
    }
  });

  it("step 8 (« Activer ») does not render a « Suivant » (it's the terminal step — the real form lands in the activation slice with its own confirmation UX)", () => {
    const Form8 = STEP_FORMS[8];
    const tree = serialize(Form8({ onPrev: () => {}, onNext: () => {} }));
    const text = allText(tree);
    // No « Suivant » in the terminal step.
    expect(text).not.toMatch(/Suivant/);
  });
});
