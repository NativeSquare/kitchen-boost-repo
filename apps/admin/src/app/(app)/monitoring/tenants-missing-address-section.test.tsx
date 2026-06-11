/**
 * Address-first slice 4 (2026-06-11) — `TenantsMissingAddressSection`
 * (PR #487 follow-up to #484/#485/#486).
 *
 * Pure presentational section rendered below the incidents table on the KB
 * Admin `/monitoring` page. Lists every ALREADY-active tenant whose 4-tuple
 * (`address` + `addressLat` + `addressLng` + `addressComponents`) is
 * incomplete — the legacy rows that were activated BEFORE the slice-3
 * activation gate landed.
 *
 * Branches:
 *   - `rows === undefined` → loading state (query in flight).
 *   - `rows.length === 0`  → « Aucun tenant à migrer » empty state.
 *   - else                 → shadcn `<Table>` with one row per tenant,
 *                            carrying slug + name + a deep-link to the
 *                            tenant's paramètres page so the kb_admin can
 *                            navigate straight to the editor and walk the
 *                            gérant through it.
 *
 * Same React-tree-serializer pattern as the neighbouring
 * `monitoring-view.test.tsx` — no jsdom, no Convex.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

import type { Id } from "@packages/backend/convex/_generated/dataModel";
import type { TenantMissingAddressRow } from "@packages/backend/convex/lib/admin/addressAudit";

import { TenantsMissingAddressSection } from "./tenants-missing-address-section";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — copied from neighbouring monitoring tests.
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

function allTypes(n: SerializedNode): string[] {
  return flatten(n)
    .map((x) => (x && "type" in x ? x.type : null))
    .filter((t): t is string => t !== null);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ROW = (
  overrides: Partial<TenantMissingAddressRow> = {},
): TenantMissingAddressRow => ({
  _id: "tenant_legacy" as unknown as Id<"tenants">,
  slug: "legacy",
  name: "Legacy Resto",
  status: "active",
  missingAddress: false,
  missingLat: true,
  missingLng: true,
  missingComponents: true,
  createdAt: 1_700_000_000_000,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TenantsMissingAddressSection — address slice 4", () => {
  it("renders a loading state when `rows` is undefined (query still in flight)", () => {
    const tree = serialize(TenantsMissingAddressSection({ rows: undefined }));
    const text = allText(tree);
    expect(text).not.toMatch(/Aucun tenant/i);
    // The heading is always rendered so the user can tell the section exists.
    expect(text).toMatch(/Tenants sans adresse/i);
  });

  it("renders an empty state when every tenant has a complete 4-tuple", () => {
    const tree = serialize(TenantsMissingAddressSection({ rows: [] }));
    const text = allText(tree);
    expect(text).toMatch(/Tenants sans adresse/i);
    expect(text).toMatch(/Aucun tenant/i);
  });

  it("renders one shadcn Table row per legacy tenant with slug + name", () => {
    const rows: TenantMissingAddressRow[] = [
      ROW({ slug: "alpha", name: "Alpha Burger" }),
      ROW({
        _id: "tenant_zorro" as unknown as Id<"tenants">,
        slug: "zorro",
        name: "Zorro Pizza",
      }),
    ];
    const tree = serialize(TenantsMissingAddressSection({ rows }));
    const types = allTypes(tree);
    // shadcn Table → native <table>/<thead>/<tbody> after serializer unwrap.
    expect(types).toContain("table");
    expect(types).toContain("thead");
    expect(types).toContain("tbody");

    const text = allText(tree);
    expect(text).toContain("Alpha Burger");
    expect(text).toContain("alpha");
    expect(text).toContain("Zorro Pizza");
    expect(text).toContain("zorro");
  });

  it("each row carries a deep-link to the tenant's paramètres page (source-level)", () => {
    // The link itself is rendered by next/link which the serializer can't
    // safely unwrap (next/link is a runtime dependency). Pin at source level
    // that the section builds the canonical `/t/<id>/parametres` href.
    const source = readFileSync(
      path.resolve(__dirname, "./tenants-missing-address-section.tsx"),
      "utf8",
    );
    expect(source).toMatch(/\/t\/\$\{.*\}\/parametres/);
  });

  it("surfaces a hint message explaining the migration (visible copy)", () => {
    const rows = [ROW()];
    const tree = serialize(TenantsMissingAddressSection({ rows }));
    const text = allText(tree);
    // The visible copy must mention adresse so the user understands the
    // section's purpose without reading the docs. Don't pin the exact
    // wording (it'll evolve), just the topical anchor.
    expect(text).toMatch(/adresse/i);
  });
});
