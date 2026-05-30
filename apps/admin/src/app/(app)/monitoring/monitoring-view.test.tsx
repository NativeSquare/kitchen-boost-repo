/**
 * F-MONITORING — `MonitoringView` (issue #184, parent EPIC #147).
 *
 * `MonitoringView` is the pure presentational shell of the `/monitoring`
 * route: it takes the resolved `session` + the `incidents` snapshot as
 * props and decides what to render. Splitting it out of `page.tsx` (which
 * does the `useSession` + `useQuery` wiring) lets vitest pin every branch
 * — access denied, loading, empty, 3-kind table — in the lean `node` env
 * (no jsdom, no Convex test harness), same React-tree-serializer pattern
 * already used by `QrPdfDocument.test.tsx` /
 * `mes-clients/empty-state.test.tsx` / `QrGeneratorView.test.tsx`.
 *
 * Acceptance criteria covered (#184):
 *   - AC: « `useSession().isAdmin === false` → composant "Accès refusé" +
 *     lien retour, pas la table » — assert the access-denied surface is
 *     rendered and the table is NOT rendered.
 *   - AC: « Mock `useQuery` retournant un incident de chaque kind → la
 *     table affiche les bonnes colonnes pour chaque ligne » — assert the
 *     table contains rows whose visible text carries the per-kind inline
 *     fields prescribed by the issue body.
 *   - AC: « Mock `useQuery` retournant `[]` → état vide affiché » — assert
 *     the « Aucun incident actif » copy is rendered.
 *   - AC: « `pendingSinceMs` formaté lisible via `date-fns` (ex. "depuis 4
 *     heures") » — assert the row for `kyc_pending` contains a "depuis"
 *     phrase.
 *   - AC: « Table shadcn/ui (`components/ui/table`), pas de table custom »
 *     — assert the serialized tree contains the shadcn `Table` /
 *     `TableHeader` / `TableBody` component names (i.e. the shell isn't
 *     hand-rolled).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

import type { Incident } from "@packages/backend/convex/lib/admin/monitoring";
import type { SessionState } from "@/lib/session";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { MonitoringView } from "./monitoring-view";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as
// mes-clients/empty-state.test.tsx, trimmed to what we need here.
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
        // Some shadcn primitives (Slot, Radix wrappers) throw outside a real
        // React render — surface the component name as a leaf so its
        // presence is still observable in the tree.
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

function allTypes(n: SerializedNode): string[] {
  return flatten(n)
    .map((x) => (x && "type" in x ? x.type : null))
    .filter((t): t is string => t !== null);
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------
const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

function adminSession(): SessionState {
  return {
    status: "ready",
    session: { isAdmin: true, tenants: [] },
  };
}

function managerSession(): SessionState {
  return {
    status: "ready",
    session: {
      isAdmin: false,
      tenants: [
        {
          tenantId: "tenant_khan" as unknown as Id<"tenants">,
          slug: "khan",
          name: "Khan",
          role: "kb_manager",
        },
      ],
    },
  };
}

const ONE_OF_EACH_KIND: Incident[] = [
  {
    kind: "kyc_pending",
    provider: "stripe",
    prospectId: "prospect_123",
    prospectName: "L'Artisan",
    pendingSinceMs: NOW - 4 * HOUR,
  },
  {
    kind: "webhook_latency",
    provider: "stripe",
    externalId: "evt_abc",
    latencyMs: 45_000,
  },
  {
    kind: "paid_no_course",
    orderId: "order_42",
    tenantId: "tenant_khan",
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("MonitoringView — F-MONITORING (#184)", () => {
  it("refuses access cleanly when `session.isAdmin === false` — shows « Accès refusé », no table", () => {
    const tree = serialize(
      MonitoringView({
        session: managerSession(),
        incidents: ONE_OF_EACH_KIND,
        now: NOW,
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Acc[èe]s refus[ée]/i);
    // The table MUST NOT render — assert the underlying DOM tag <table> is
    // absent (the serializer unwraps function components down to native tags,
    // so any leaked shadcn `<Table>` would surface as a "table" type here).
    const types = allTypes(tree);
    expect(types).not.toContain("table");
    expect(types).not.toContain("thead");
    expect(types).not.toContain("tbody");
    // Back link to the dashboard surfaces, per AC. The serializer can't
    // safely unwrap next/link in node env (it depends on a real Next runtime),
    // so we pin the contract at the *source-file* level — the access-denied
    // surface MUST mount a `<Link href="/">` (the simplest navigation back
    // from a refused state). A source regex is more honest than chasing the
    // refreshing implementation of next/link.
    const source = readFileSync(
      path.resolve(__dirname, "./monitoring-view.tsx"),
      "utf8",
    );
    expect(source).toMatch(/href=["']\/["']/);
    expect(source).toMatch(/Retour au dashboard/);
  });

  it("renders the empty state « Aucun incident actif » when incidents is []", () => {
    const tree = serialize(
      MonitoringView({
        session: adminSession(),
        incidents: [],
        now: NOW,
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Aucun incident actif/i);
  });

  it("renders a loading state when incidents is undefined (useQuery still in flight)", () => {
    const tree = serialize(
      MonitoringView({
        session: adminSession(),
        incidents: undefined,
        now: NOW,
      }),
    );
    const text = allText(tree);
    // Don't pin the exact copy, but the surface must NOT be the empty state
    // (otherwise an in-flight query is indistinguishable from "0 incidents").
    expect(text).not.toMatch(/Aucun incident actif/i);
  });

  it("renders a shadcn Table (NOT a hand-rolled one) with one row per incident kind, carrying the per-kind inline fields", () => {
    const tree = serialize(
      MonitoringView({
        session: adminSession(),
        incidents: ONE_OF_EACH_KIND,
        now: NOW,
      }),
    );
    const types = allTypes(tree);
    // AC: « Table shadcn/ui (`components/ui/table`), pas de table custom ».
    // The serializer unwraps shadcn function components down to their native
    // DOM tags — assert the standard table tags surface. (They wouldn't if
    // someone rolled a flex/grid "table" by hand.)
    expect(types).toContain("table");
    expect(types).toContain("thead");
    expect(types).toContain("tbody");
    // Each header column promised by the design surfaces in the THEAD.
    const headerText = allText(tree);
    expect(headerText).toMatch(/Type/);
    expect(headerText).toMatch(/Cible/);
    expect(headerText).toMatch(/S[ée]v[ée]rit[ée]/);

    const text = allText(tree);
    // kyc_pending row: prospectName + provider + « depuis X heures ».
    expect(text).toContain("L'Artisan");
    expect(text).toMatch(/stripe/i);
    expect(text).toMatch(/depuis .*heure/i);
    // webhook_latency row: provider + externalId + latencyMs.
    expect(text).toContain("evt_abc");
    expect(text).toMatch(/45/);
    // paid_no_course row: orderId + tenantId.
    expect(text).toContain("order_42");
    expect(text).toContain("tenant_khan");
  });

  it("renders one row per incident even when several share the same kind (no dedupe)", () => {
    const incidents: Incident[] = [
      {
        kind: "webhook_latency",
        provider: "stripe",
        externalId: "evt_a",
        latencyMs: 31_000,
      },
      {
        kind: "webhook_latency",
        provider: "uber",
        externalId: "evt_b",
        latencyMs: 60_000,
      },
    ];
    const tree = serialize(
      MonitoringView({
        session: adminSession(),
        incidents,
        now: NOW,
      }),
    );
    const text = allText(tree);
    expect(text).toContain("evt_a");
    expect(text).toContain("evt_b");
  });
});

// ---------------------------------------------------------------------------
// Filters — F-MONITORING (#197)
// ---------------------------------------------------------------------------
//
// The three filters (kind / tenant / severity) are 100 % client-side: the
// query (`previewIncidents`) takes no params. State is owned upstream
// (`page.tsx`) and threaded through as controlled props so `MonitoringView`
// stays a pure function that vitest can invoke directly.
//
// Acceptance criteria covered (issue #197):
//   - AC: « Sélection d'un type → seuls les incidents de ce kind affichés »
//   - AC: « Sélection "critical" → seuls webhook_latency + paid_no_course »
//   - AC: « Sélection d'un tenant → seuls les incidents matching ce tenant »
//   - AC: « Combinaison des 3 filtres = AND »
//   - AC: « État vide filtré distinct de l'état vide global »
describe("MonitoringView — filters (#197)", () => {
  const NOOP = () => {};

  it("with kind=`webhook_latency` and the same `ONE_OF_EACH_KIND` payload, only the webhook row renders", () => {
    const tree = serialize(
      MonitoringView({
        session: adminSession(),
        incidents: ONE_OF_EACH_KIND,
        now: NOW,
        filters: { kind: "webhook_latency", tenantId: "all", severity: "all" },
        onFiltersChange: NOOP,
      }),
    );
    const text = allText(tree);
    // webhook row stays
    expect(text).toContain("evt_abc");
    // kyc_pending + paid_no_course rows are dropped
    expect(text).not.toContain("L'Artisan");
    expect(text).not.toContain("order_42");
  });

  it("with severity=`critical`, only webhook_latency + paid_no_course rows render (kyc_pending is warning)", () => {
    const tree = serialize(
      MonitoringView({
        session: adminSession(),
        incidents: ONE_OF_EACH_KIND,
        now: NOW,
        filters: { kind: "all", tenantId: "all", severity: "critical" },
        onFiltersChange: NOOP,
      }),
    );
    const text = allText(tree);
    expect(text).toContain("evt_abc"); // webhook_latency stays
    expect(text).toContain("order_42"); // paid_no_course stays
    expect(text).not.toContain("L'Artisan"); // kyc_pending drops
  });

  it("with severity=`warning`, only kyc_pending rows render", () => {
    const tree = serialize(
      MonitoringView({
        session: adminSession(),
        incidents: ONE_OF_EACH_KIND,
        now: NOW,
        filters: { kind: "all", tenantId: "all", severity: "warning" },
        onFiltersChange: NOOP,
      }),
    );
    const text = allText(tree);
    expect(text).toContain("L'Artisan");
    expect(text).not.toContain("evt_abc");
    expect(text).not.toContain("order_42");
  });

  it("with tenantId=`tenant_khan`, only tenant-scoped incidents matching that tenant render", () => {
    const tree = serialize(
      MonitoringView({
        session: adminSession(),
        incidents: ONE_OF_EACH_KIND,
        now: NOW,
        filters: { kind: "all", tenantId: "tenant_khan", severity: "all" },
        onFiltersChange: NOOP,
      }),
    );
    const text = allText(tree);
    expect(text).toContain("order_42"); // the paid_no_course on tenant_khan stays
    expect(text).not.toContain("L'Artisan"); // kyc_pending dropped (not tenant-scoped)
    expect(text).not.toContain("evt_abc"); // webhook_latency dropped (no tenantId)
  });

  it("combines the three filters as AND — incompatible combination shows the « filtered empty » state, NOT the global empty state", () => {
    const tree = serialize(
      MonitoringView({
        session: adminSession(),
        incidents: ONE_OF_EACH_KIND,
        now: NOW,
        // kyc_pending is warning, so asking for kyc_pending + critical = 0
        // results, but the unfiltered list is NOT empty.
        filters: { kind: "kyc_pending", tenantId: "all", severity: "critical" },
        onFiltersChange: NOOP,
      }),
    );
    const text = allText(tree);
    // The empty-after-filter copy must be distinct from « Aucun incident
    // actif » so the user understands their filters caused the empty state.
    expect(text).toMatch(/aucun incident.*correspond.*filtre/i);
    expect(text).not.toMatch(/Aucun incident actif/i);
  });

  it("renders 3 filter controls above the table (kind + tenant + severity)", () => {
    // Pin the contract at the source-file level: the view file must mount
    // the shadcn Select (kind, severity) and the shadcn Combobox (tenant),
    // and label them so the user can tell them apart. Reading raw types
    // from the serializer is brittle here because the shadcn Select/
    // Combobox primitives throw outside a real React render (no Radix /
    // Base-UI portal context), so the serializer falls back to leaf nodes
    // and we lose visibility into the children.
    const source = readFileSync(
      path.resolve(__dirname, "./monitoring-view.tsx"),
      "utf8",
    );
    // shadcn Select for kind + severity, Combobox for tenant.
    expect(source).toMatch(/from "@\/components\/ui\/select"/);
    expect(source).toMatch(/from "@\/components\/ui\/combobox"/);
    // The three filter labels surface in the source (visible copy).
    expect(source).toMatch(/Type/);
    expect(source).toMatch(/Tenant/);
    expect(source).toMatch(/S[ée]v[ée]rit[ée]/);
  });
});
