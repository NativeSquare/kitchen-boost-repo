/**
 * F-CAMPAGNES [6/7] (#240) — `CampaignHistoryList`, the pure presentational
 * surface of the « historique des lancements campagne » list page (parent EPIC
 * #145, ADR 0010 MOAT / PRD 90 §3-§5).
 *
 * Pinned via the same React-tree-serializer pattern used across the campagnes
 * folder — vitest runs in `environment: "node"` (no jsdom, no RTL).
 *
 * Three branches (mirror of the picker / template view discipline):
 *   - `launches === undefined` → loading skeleton.
 *   - `launches === []`        → empty state « Aucune campagne lancée pour
 *     l'instant ».
 *   - else                     → list, one row per launch, sorted desc (the
 *     backend already sorts; we re-assert the order the front receives is
 *     preserved). Each row surfaces template label + date + at least
 *     `targeted` + `sent` counters (issue body verbatim).
 *
 * MOAT — the list is aggregate-only: no recipient identity, no email/phone.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Id } from "@packages/backend/convex/_generated/dataModel";

import {
  CampaignHistoryList,
  type CampaignLaunchSummary,
} from "./CampaignHistoryList";

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
      // `next/link`'s Link surfaces as `<a href=...>` for the purposes of
      // the per-row navigation pin.
      if ("href" in (node.props as Record<string, unknown>)) {
        return { type: "a", props, children };
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
const TENANT_ID = "tenant_abc" as Id<"tenants">;

const LAUNCH_A: CampaignLaunchSummary = {
  id: "launch_aaa" as Id<"campaignLaunches">,
  scope: "tenant",
  launchedAt: Date.UTC(2026, 4, 14, 13, 0),
  templateId: "tpl_promo" as Id<"notificationTemplates">,
  templateLabel: "Promo weekend",
  targeted: 42,
  sent: 30,
  queued: 5,
  skippedIneligible: 3,
  skippedRateLimited: 2,
  skippedUnreachable: 2,
};

const LAUNCH_B: CampaignLaunchSummary = {
  id: "launch_bbb" as Id<"campaignLaunches">,
  scope: "tenant",
  launchedAt: Date.UTC(2026, 4, 10, 9, 30),
  templateId: "tpl_other" as Id<"notificationTemplates">,
  templateLabel: "Happy Hour jeudi",
  targeted: 17,
  sent: 17,
  queued: 0,
  skippedIneligible: 0,
  skippedRateLimited: 0,
  skippedUnreachable: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("CampaignHistoryList — loading branch", () => {
  it("renders a loading skeleton (no empty-state copy, no crash)", () => {
    const tree = serialize(
      CampaignHistoryList({ tenantId: TENANT_ID, launches: undefined }),
    );
    expect(tree).not.toBeNull();
    const text = allText(tree);
    expect(text).not.toMatch(/Aucune campagne/i);
    const hasSkeleton = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "skeleton";
    });
    expect(hasSkeleton).toBe(true);
  });
});

describe("CampaignHistoryList — empty branch", () => {
  it("renders the FR empty copy « Aucune campagne lancée pour l'instant »", () => {
    const text = allText(
      serialize(CampaignHistoryList({ tenantId: TENANT_ID, launches: [] })),
    );
    expect(text).toMatch(/Aucune campagne lancée pour l['’]instant/);
  });

  it("does NOT show any skeleton on the empty branch", () => {
    const tree = serialize(
      CampaignHistoryList({ tenantId: TENANT_ID, launches: [] }),
    );
    const hasSkeleton = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "skeleton";
    });
    expect(hasSkeleton).toBe(false);
  });
});

describe("CampaignHistoryList — list branch", () => {
  it("renders one navigation anchor per launch, pointing at /t/[tenantId]/campagnes/historique/[launchId]", () => {
    const tree = serialize(
      CampaignHistoryList({
        tenantId: TENANT_ID,
        launches: [LAUNCH_A, LAUNCH_B],
      }),
    );
    const anchors = flatten(tree).filter(
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    ) as Array<{ type: string; props: Record<string, unknown> }>;
    const hrefs = anchors
      .map((a) => a.props["href"])
      .filter((h): h is string => typeof h === "string");
    expect(hrefs).toContain(
      `/t/${TENANT_ID}/campagnes/historique/${LAUNCH_A.id}`,
    );
    expect(hrefs).toContain(
      `/t/${TENANT_ID}/campagnes/historique/${LAUNCH_B.id}`,
    );
  });

  it("each row surfaces the template label", () => {
    const text = allText(
      serialize(
        CampaignHistoryList({
          tenantId: TENANT_ID,
          launches: [LAUNCH_A, LAUNCH_B],
        }),
      ),
    );
    expect(text).toContain(LAUNCH_A.templateLabel);
    expect(text).toContain(LAUNCH_B.templateLabel);
  });

  it("each row surfaces at least `targeted` + `sent` counters (issue body « au minimum »)", () => {
    const text = allText(
      serialize(
        CampaignHistoryList({
          tenantId: TENANT_ID,
          launches: [LAUNCH_A, LAUNCH_B],
        }),
      ),
    );
    expect(text).toContain(String(LAUNCH_A.targeted));
    expect(text).toContain(String(LAUNCH_A.sent));
    expect(text).toContain(String(LAUNCH_B.targeted));
    expect(text).toContain(String(LAUNCH_B.sent));
  });

  it("preserves the order received from the backend (the backend already sorts desc)", () => {
    const tree = serialize(
      CampaignHistoryList({
        tenantId: TENANT_ID,
        launches: [LAUNCH_A, LAUNCH_B],
      }),
    );
    const anchors = flatten(tree).filter(
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    ) as Array<{ type: string; props: Record<string, unknown> }>;
    const hrefs = anchors
      .map((a) => a.props["href"])
      .filter((h): h is string => typeof h === "string");
    expect(hrefs[0]).toBe(
      `/t/${TENANT_ID}/campagnes/historique/${LAUNCH_A.id}`,
    );
    expect(hrefs[1]).toBe(
      `/t/${TENANT_ID}/campagnes/historique/${LAUNCH_B.id}`,
    );
  });

  it("renders a row even when templateLabel is null (legacy launch, no schema match)", () => {
    const legacy: CampaignLaunchSummary = {
      ...LAUNCH_A,
      templateId: null,
      templateLabel: null,
    };
    const tree = serialize(
      CampaignHistoryList({ tenantId: TENANT_ID, launches: [legacy] }),
    );
    expect(tree).not.toBeNull();
    const anchors = flatten(tree).filter(
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    );
    expect(anchors).toHaveLength(1);
  });
});

describe("CampaignHistoryList — MOAT (no recipient identity)", () => {
  it("no @-sign / email / téléphone / destinataires across any branch", () => {
    const branches = [
      allText(
        serialize(
          CampaignHistoryList({ tenantId: TENANT_ID, launches: undefined }),
        ),
      ),
      allText(
        serialize(CampaignHistoryList({ tenantId: TENANT_ID, launches: [] })),
      ),
      allText(
        serialize(
          CampaignHistoryList({
            tenantId: TENANT_ID,
            launches: [LAUNCH_A, LAUNCH_B],
          }),
        ),
      ),
    ];
    for (const text of branches) {
      expect(text).not.toMatch(/@/);
      expect(text).not.toMatch(/\bemail\b/i);
      expect(text).not.toMatch(/\btéléphone\b/i);
      expect(text).not.toMatch(/\btelephone\b/i);
      expect(text).not.toMatch(/\bdestinataires?\s*:/i);
    }
  });

  it("never renders a <ul>/<ol>/<table> shape carrying per-recipient rows", () => {
    // The list itself uses a wrapper container (<div>), not a <ul>/<ol>/<table>.
    // The MOAT-load-bearing rule is that no per-recipient surface is built —
    // each list item is a per-LAUNCH summary, not per-recipient.
    const tree = serialize(
      CampaignHistoryList({
        tenantId: TENANT_ID,
        launches: [LAUNCH_A, LAUNCH_B],
      }),
    );
    const nodes = flatten(tree).filter(
      (n) => n !== null && !("text" in n),
    ) as Array<{ type: string; props: Record<string, unknown> }>;
    for (const n of nodes) {
      expect(["table", "tbody", "thead"]).not.toContain(n.type.toLowerCase());
    }
  });
});

describe("CampaignHistoryList — FR-only", () => {
  it("no English fallback labels", () => {
    const text = allText(
      serialize(
        CampaignHistoryList({
          tenantId: TENANT_ID,
          launches: [LAUNCH_A, LAUNCH_B],
        }),
      ),
    );
    expect(text).not.toMatch(/\bLoading\b/);
    expect(text).not.toMatch(/\bNo campaigns?\b/i);
    expect(text).not.toMatch(/\bSent\b/);
    expect(text).not.toMatch(/\bTargeted\b/);
  });
});
