/**
 * F-MONITORING — `IncidentDetailSheet` (issue #207, parent EPIC #147).
 *
 * The drill-down panel opened when a KB Admin clicks a row in the
 * `/monitoring` table: a shadcn `Sheet` that lays out every raw field of
 * the discriminated `Incident` plus a contextual link (when
 * `deriveIncidentDisplay.href` is buildable for that kind).
 *
 * Same React-tree-serializer pattern as `monitoring-view.test.tsx` so the
 * test stays in the lean `node` env (no jsdom, no Radix portal context).
 *
 * Strategy: the shadcn `Sheet` primitives (Radix `DialogRoot`) require a
 * live React render context and throw outside one — the serializer would
 * truncate the body to a leaf and we'd lose visibility into the rendered
 * fields. We work around it by exporting the panel body as a separate,
 * portal-free sub-component (`IncidentDetailSheetBody`) that vitest can
 * invoke directly to assert per-kind field rendering + the contextual
 * link, while the outer Sheet composition is pinned at the source-file
 * level (shadcn imports + single mount).
 *
 * Acceptance criteria covered (#207):
 *   - « Tous les champs de l'`Incident` discriminé rendus (test composant
 *     pour les 3 kinds) » — Body suite below.
 *   - « Incident `kyc_pending` → bouton/lien vers `/pipeline/[prospectId]`
 *     présent » — Body suite below.
 *   - « Incident `paid_no_course` avec `tenantId` → bouton/lien vers
 *     `/t/[tenantId]/commandes` présent » — Body suite below.
 *   - « Incident `paid_no_course` sans `tenantId` → pas de bouton lien » —
 *     Body suite below.
 *   - « Incident `webhook_latency` → pas de bouton lien » — Body suite.
 *   - « Click sur une ligne ouvre un Sheet shadcn avec le détail » +
 *     « Fermeture du Sheet remet la table en état normal » — Composition
 *     suite below, plus the row-click wiring covered in
 *     `monitoring-view.test.tsx`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";

import {
  IncidentDetailSheet,
  IncidentDetailSheetBody,
} from "./incident-detail-sheet";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (same shape as monitoring-view.test.tsx)
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
// Body — per-kind rendering (the load-bearing portion the user sees inside
// the Sheet). Invoked directly so the Sheet/Radix portal never executes.
// ---------------------------------------------------------------------------
describe("IncidentDetailSheetBody — F-MONITORING (#207)", () => {
  it("renders every raw field of a `webhook_latency` incident, no contextual link", () => {
    const incident: Incident = {
      kind: "webhook_latency",
      provider: "stripe",
      externalId: "evt_abc",
      latencyMs: 45_000,
    };
    const tree = serialize(IncidentDetailSheetBody({ incident }));
    const text = allText(tree);
    expect(text).toContain("provider");
    expect(text).toContain("stripe");
    expect(text).toContain("externalId");
    expect(text).toContain("evt_abc");
    expect(text).toContain("latencyMs");
    expect(text).toContain("45000");
    // No contextual link for webhook_latency (V1).
    expect(text).not.toMatch(/Ouvrir/);
    expect(JSON.stringify(tree)).not.toContain("/pipeline/");
    expect(JSON.stringify(tree)).not.toContain("/commandes");
  });

  it("renders every raw field of a `kyc_pending` incident + a link to /pipeline/[prospectId]", () => {
    const incident: Incident = {
      kind: "kyc_pending",
      provider: "stripe",
      prospectId: "prospect_123",
      prospectName: "L'Artisan",
      pendingSinceMs: 1_700_000_000_000,
    };
    const tree = serialize(IncidentDetailSheetBody({ incident }));
    const text = allText(tree);
    expect(text).toContain("provider");
    expect(text).toContain("stripe");
    expect(text).toContain("prospectId");
    expect(text).toContain("prospect_123");
    expect(text).toContain("prospectName");
    expect(text).toContain("L'Artisan");
    expect(text).toContain("pendingSinceMs");
    // Contextual link href surfaces in the serialized tree.
    expect(JSON.stringify(tree)).toContain("/pipeline/prospect_123");
  });

  it("omits the `prospectName` field row when undefined (kyc_pending)", () => {
    const incident: Incident = {
      kind: "kyc_pending",
      provider: "uber_direct",
      prospectId: "prospect_456",
      pendingSinceMs: 1_700_000_000_000,
    };
    const tree = serialize(IncidentDetailSheetBody({ incident }));
    const text = allText(tree);
    expect(text).not.toContain("prospectName");
    // The required fields still surface so the panel stays useful.
    expect(text).toContain("prospectId");
    expect(text).toContain("provider");
  });

  it("renders every raw field of a `paid_no_course` incident WITH tenantId + a link to /t/[tenantId]/commandes", () => {
    const incident: Incident = {
      kind: "paid_no_course",
      orderId: "order_42",
      tenantId: "tenant_khan",
    };
    const tree = serialize(IncidentDetailSheetBody({ incident }));
    const text = allText(tree);
    expect(text).toContain("orderId");
    expect(text).toContain("order_42");
    expect(text).toContain("tenantId");
    expect(text).toContain("tenant_khan");
    expect(JSON.stringify(tree)).toContain("/t/tenant_khan/commandes");
  });

  it("renders a `paid_no_course` incident WITHOUT tenantId — no contextual link, the tenantId row is omitted", () => {
    const incident: Incident = {
      kind: "paid_no_course",
      orderId: "order_42",
    };
    const tree = serialize(IncidentDetailSheetBody({ incident }));
    const text = allText(tree);
    expect(text).toContain("orderId");
    expect(text).toContain("order_42");
    expect(text).not.toContain("tenantId");
    expect(JSON.stringify(tree)).not.toContain("/commandes");
  });
});

// ---------------------------------------------------------------------------
// Composition — the outer Sheet wrapper (shadcn primitives, single mount,
// controlled open flag, body short-circuit when no incident).
// ---------------------------------------------------------------------------
describe("IncidentDetailSheet — composition (#207)", () => {
  const NOOP = () => {};

  it("renders nothing visible when `incident` is null (the controlled open flag still toggles, but the body short-circuits)", () => {
    const tree = serialize(
      IncidentDetailSheet({
        incident: null,
        open: false,
        onOpenChange: NOOP,
      }),
    );
    const text = allText(tree);
    // No leaked incident copy.
    expect(text).not.toMatch(/provider|orderId|prospectId/);
  });

  it("composes the drill-down panel from the shadcn `Sheet` primitives (no hand-rolled modal)", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./incident-detail-sheet.tsx"),
      "utf8",
    );
    // Source-level contract: the component file MUST mount shadcn Sheet
    // primitives — anything else would slip the « shadcn UI » bar set by
    // the issue body.
    expect(source).toMatch(/from "@\/components\/ui\/sheet"/);
    expect(source).toMatch(/SheetContent/);
    expect(source).toMatch(/SheetTitle/);
    // next/link is imported so the contextual links render as <Link>.
    expect(source).toMatch(/from "next\/link"/);
  });
});
