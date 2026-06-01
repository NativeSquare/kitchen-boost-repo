/**
 * F-CAMPAGNES [5/7] (#228) — `CampaignResultStats`, the aggregate-only result
 * surface that paints the 6 server counters returned by `sendTenantCampaign`
 * (parent EPIC #145, ADR 0010 MOAT / PRD 80 §4 / PRD 90 §3-§5).
 *
 * Issue body verbatim — the 6 counters and their EXACT FR labels:
 *
 *   | Backend counter        | FR label                                    |
 *   | ---------------------- | ------------------------------------------- |
 *   | `targeted`             | « Clients ciblés »                          |
 *   | `sent`                 | « Envoyés maintenant »                      |
 *   | `queued`               | « Programmés pour 8h (DNT) »                |
 *   | `skippedIneligible`    | « Désinscrits / non éligibles »             |
 *   | `skippedRateLimited`   | « Quota 3/sem atteint »                     |
 *   | `skippedUnreachable`   | « Aucun canal joignable »                   |
 *
 * MOAT (ADR 0010, PRD 90 §3-§5) — the resto NEVER sees a recipient identity:
 *   - no list of customer ids,
 *   - no email/phone/name,
 *   - no per-customer row,
 *   - ONLY the 6 aggregate counts.
 *
 * Pinned via the same pure React-tree-serializer pattern as the rest of the
 * campagnes folder — vitest runs in `environment: "node"` (no jsdom, no RTL).
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { CampaignResult } from "@packages/backend/convex/lib/notifications";

import { CampaignResultStats } from "./CampaignResultStats";

// ---------------------------------------------------------------------------
// React-tree serializer (shared shape across the campagnes folder).
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const RESULT: CampaignResult = {
  targeted: 42,
  sent: 30,
  queued: 5,
  skippedIneligible: 3,
  skippedRateLimited: 2,
  skippedUnreachable: 2,
};

// ---------------------------------------------------------------------------
// Tests — 6 FR labels (issue body verbatim)
// ---------------------------------------------------------------------------
describe("CampaignResultStats — 6 counters with EXACT FR labels (#228)", () => {
  it("surfaces « Clients ciblés » bound to `targeted`", () => {
    const text = allText(serialize(<CampaignResultStats result={RESULT} />));
    expect(text).toContain("Clients ciblés");
    expect(text).toContain("42");
  });

  it("surfaces « Envoyés maintenant » bound to `sent`", () => {
    const text = allText(serialize(<CampaignResultStats result={RESULT} />));
    expect(text).toContain("Envoyés maintenant");
    expect(text).toContain("30");
  });

  it("surfaces « Programmés pour 8h (DNT) » bound to `queued`", () => {
    const text = allText(serialize(<CampaignResultStats result={RESULT} />));
    expect(text).toContain("Programmés pour 8h (DNT)");
    expect(text).toContain("5");
  });

  it("surfaces « Désinscrits / non éligibles » bound to `skippedIneligible`", () => {
    const text = allText(serialize(<CampaignResultStats result={RESULT} />));
    expect(text).toContain("Désinscrits / non éligibles");
  });

  it("surfaces « Quota 3/sem atteint » bound to `skippedRateLimited`", () => {
    const text = allText(serialize(<CampaignResultStats result={RESULT} />));
    expect(text).toContain("Quota 3/sem atteint");
  });

  it("surfaces « Aucun canal joignable » bound to `skippedUnreachable`", () => {
    const text = allText(serialize(<CampaignResultStats result={RESULT} />));
    expect(text).toContain("Aucun canal joignable");
  });

  it("renders every numeric value from the result payload", () => {
    const distinct: CampaignResult = {
      targeted: 17,
      sent: 11,
      queued: 6,
      skippedIneligible: 4,
      skippedRateLimited: 2,
      skippedUnreachable: 1,
    };
    const text = allText(serialize(<CampaignResultStats result={distinct} />));
    for (const n of [17, 11, 6, 4, 2, 1]) {
      expect(text).toContain(String(n));
    }
  });

  it("renders all-zero counts without crashing", () => {
    const zeroes: CampaignResult = {
      targeted: 0,
      sent: 0,
      queued: 0,
      skippedIneligible: 0,
      skippedRateLimited: 0,
      skippedUnreachable: 0,
    };
    const tree = serialize(<CampaignResultStats result={zeroes} />);
    expect(tree).not.toBeNull();
    const text = allText(tree);
    expect(text).toContain("Clients ciblés");
  });
});

// ---------------------------------------------------------------------------
// Tests — MOAT (no recipient identity, no per-customer row)
// ---------------------------------------------------------------------------
describe("CampaignResultStats — MOAT (no recipient identity, aggregates only)", () => {
  it("contains NO PII tokens — no @ sign, no « email », no « téléphone », no name field", () => {
    const text = allText(serialize(<CampaignResultStats result={RESULT} />));
    // Aggregate-only — we forbid the obvious leakage shapes a future regression
    // might introduce. The labels above ("E-mail" channel wording) are not
    // present in this surface (only counter labels), so a broad guard is safe.
    expect(text).not.toMatch(/@/);
    expect(text).not.toMatch(/\bemail\b/i);
    expect(text).not.toMatch(/\btéléphone\b/i);
    expect(text).not.toMatch(/\btelephone\b/i);
    expect(text).not.toMatch(/\bdestinataires?\s*:/i);
  });

  it("does NOT expose a per-recipient list shape (no <ul>/<ol>, no <table>)", () => {
    const tree = serialize(<CampaignResultStats result={RESULT} />);
    const nodes = flatten(tree).filter(
      (n) => n !== null && !("text" in n),
    ) as Array<{ type: string; props: Record<string, unknown> }>;
    for (const n of nodes) {
      expect(["ul", "ol", "table", "tbody", "thead"]).not.toContain(
        n.type.toLowerCase(),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — FR-only
// ---------------------------------------------------------------------------
describe("CampaignResultStats — FR-only", () => {
  it("no English fallback labels", () => {
    const text = allText(serialize(<CampaignResultStats result={RESULT} />));
    expect(text).not.toMatch(/\bTargeted\b/);
    expect(text).not.toMatch(/\bSent\b/);
    expect(text).not.toMatch(/\bQueued\b/);
    expect(text).not.toMatch(/\bSkipped\b/);
    expect(text).not.toMatch(/\bIneligible\b/);
    expect(text).not.toMatch(/\bRate limited\b/i);
    expect(text).not.toMatch(/\bUnreachable\b/);
  });
});
