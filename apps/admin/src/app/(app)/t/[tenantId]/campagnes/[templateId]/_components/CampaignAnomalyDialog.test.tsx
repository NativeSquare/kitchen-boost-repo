/**
 * F-CAMPAGNES [5/7] (#228) — `CampaignAnomalyDialog`, the shadcn dialog that
 * surfaces when the backend `sendTenantCampaign` mutation throws
 * `ConvexError({ code: "CAMPAIGN_ANOMALY", message })` (parent EPIC #145,
 * PRD 80 §7 anti-anomaly).
 *
 * Issue body verbatim:
 *   - Dialog shadcn qui s ouvre sur réponse `ConvexError({code:"CAMPAIGN_ANOMALY"})`.
 *   - Message FR clair (« Tu as déjà lancé une campagne récemment / Tu approches
 *     ton quota / Audience anormalement large — réessaie plus tard »).
 *   - Bouton « Compris ».
 *
 * The dialog is a PURE controlled component: `open` + `onOpenChange` (shadcn
 * Dialog pattern). The optional `reason` prop is the backend anomaly tag (one
 * of `TOO_FREQUENT_48H` / `TOO_FREQUENT_WEEK` / `RECIPIENT_SURGE`, mirror of
 * `antiAnomaly.ts: CampaignAnomaly`) used to pick the FR copy; an unknown
 * reason falls back to a generic FR message.
 *
 * Pinned via the same pure React-tree-serializer pattern as the rest of the
 * campagnes folder — vitest runs in `environment: "node"`. The shadcn Dialog
 * primitive is a Radix portal; in node-env the serializer walks the React
 * tree directly, so we can pin the title + body text without a DOM.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// Shadcn Dialog wraps Radix Dialog primitives — Radix Portal + Root use hooks
// internally, which our node-env serializer cannot exercise. We replace the
// dialog primitives with passthrough children renderers so the dialog body
// (title / description / button) is reachable by the React-tree walker. Same
// pattern as `modifier-group-modal.test.tsx`.
vi.mock("@/components/ui/dialog", () => {
  const passthrough = ({
    children,
  }: {
    children?: React.ReactNode;
  }): React.ReactNode => children ?? null;
  return {
    Dialog: passthrough,
    DialogContent: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogClose: passthrough,
    DialogTrigger: passthrough,
    DialogPortal: passthrough,
    DialogOverlay: passthrough,
  };
});

const { CampaignAnomalyDialog } = await import("./CampaignAnomalyDialog");

// ---------------------------------------------------------------------------
// Serializer (same shape as the rest of the campagnes folder).
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
  return String(t);
}

const FORWARD_REF_TYPE = Symbol.for("react.forward_ref");

function isForwardRef(t: unknown): boolean {
  return (
    typeof t === "object" &&
    t !== null &&
    (t as { $$typeof?: symbol }).$$typeof === FORWARD_REF_TYPE
  );
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
        return { type: typeName(node.type), props: {}, children: [] };
      }
    }
    if (isForwardRef(node.type)) {
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
      return {
        type: typeName(
          (node.type as { displayName?: string; name?: string }).displayName ??
            (node.type as { name?: string }).name ??
            "ForwardRef",
        ),
        props,
        children,
      };
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

const NOOP = () => {};

// ---------------------------------------------------------------------------
// Tests — open prop drives mount of the Radix Dialog
// ---------------------------------------------------------------------------
describe("CampaignAnomalyDialog — controlled `open` prop", () => {
  it("does not render the title/body text when `open === false`", () => {
    const text = allText(
      serialize(
        <CampaignAnomalyDialog
          open={false}
          onOpenChange={NOOP}
          reason={null}
        />,
      ),
    );
    // Closed dialog — nothing user-visible. The shadcn Dialog primitive
    // unmounts the content when `open === false` (Radix portal contract).
    expect(text).not.toMatch(/Compris/);
  });

  it("renders the dialog content when `open === true`", () => {
    const text = allText(
      serialize(
        <CampaignAnomalyDialog
          open={true}
          onOpenChange={NOOP}
          reason="TOO_FREQUENT_48H"
        />,
      ),
    );
    expect(text).toMatch(/Compris/);
  });
});

// ---------------------------------------------------------------------------
// Tests — per-reason FR copy (issue body verbatim)
// ---------------------------------------------------------------------------
describe("CampaignAnomalyDialog — per-reason FR copy", () => {
  it("`TOO_FREQUENT_48H` → « Tu as déjà lancé une campagne récemment »", () => {
    const text = allText(
      serialize(
        <CampaignAnomalyDialog
          open={true}
          onOpenChange={NOOP}
          reason="TOO_FREQUENT_48H"
        />,
      ),
    );
    expect(text).toMatch(/déjà lancé une campagne récemment/i);
  });

  it("`TOO_FREQUENT_WEEK` → « Tu approches ton quota »", () => {
    const text = allText(
      serialize(
        <CampaignAnomalyDialog
          open={true}
          onOpenChange={NOOP}
          reason="TOO_FREQUENT_WEEK"
        />,
      ),
    );
    expect(text).toMatch(/quota/i);
  });

  it("`RECIPIENT_SURGE` → « Audience anormalement large — réessaie plus tard »", () => {
    const text = allText(
      serialize(
        <CampaignAnomalyDialog
          open={true}
          onOpenChange={NOOP}
          reason="RECIPIENT_SURGE"
        />,
      ),
    );
    expect(text).toMatch(/anormalement large/i);
  });

  it("unknown / null reason → generic FR fallback message + « Compris » button", () => {
    const text = allText(
      serialize(
        <CampaignAnomalyDialog open={true} onOpenChange={NOOP} reason={null} />,
      ),
    );
    // Some FR copy explaining the dialog purpose MUST surface even on null
    // (the backend message could be missing / future code unrecognised).
    expect(text).toMatch(/campagne/i);
    expect(text).toMatch(/Compris/);
  });
});

// ---------------------------------------------------------------------------
// Tests — bouton « Compris »
// ---------------------------------------------------------------------------
describe("CampaignAnomalyDialog — « Compris » dismiss button", () => {
  it("renders a button with the FR label « Compris »", () => {
    const tree = serialize(
      <CampaignAnomalyDialog
        open={true}
        onOpenChange={NOOP}
        reason="TOO_FREQUENT_48H"
      />,
    );
    const buttons = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "button";
    });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    const labelText = buttons
      .map((b) => allText(b as SerializedNode).trim())
      .join(" ");
    expect(labelText).toMatch(/Compris/);
  });
});

// ---------------------------------------------------------------------------
// Tests — FR-only
// ---------------------------------------------------------------------------
describe("CampaignAnomalyDialog — FR-only", () => {
  it("no English fallback in any reason branch", () => {
    const reasons = [
      "TOO_FREQUENT_48H",
      "TOO_FREQUENT_WEEK",
      "RECIPIENT_SURGE",
      null,
    ] as const;
    for (const reason of reasons) {
      const text = allText(
        serialize(
          <CampaignAnomalyDialog
            open={true}
            onOpenChange={NOOP}
            reason={reason}
          />,
        ),
      );
      expect(text).not.toMatch(/\bGot it\b/i);
      expect(text).not.toMatch(/\bDismiss\b/i);
      expect(text).not.toMatch(/\bAnomaly\b/i);
      expect(text).not.toMatch(/\bRate limit\b/i);
    }
  });
});
