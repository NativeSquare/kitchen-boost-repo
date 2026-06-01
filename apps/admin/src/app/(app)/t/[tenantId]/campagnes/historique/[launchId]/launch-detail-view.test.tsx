/**
 * F-CAMPAGNES [6/7] (#240) — `LaunchDetailView`, the pure presentational shell
 * of the per-launch historique detail page (parent EPIC #145).
 *
 * Tri-state branches:
 *   - `launch === undefined` → loading skeleton.
 *   - `launch === null`      → resolved-not-found (the launchId in the URL no
 *     longer matches this tenant's history).
 *   - else                   → loaded — page title + back link +
 *     `<CampaignResultStats/>` REUSED from slice 5 (no duplication, issue body
 *     verbatim « réutilisation de `CampaignResultStats` »).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

import type { Id } from "@packages/backend/convex/_generated/dataModel";

import {
  LaunchDetailView,
  type CampaignLaunchDetail,
} from "./launch-detail-view";

// ---------------------------------------------------------------------------
// React-tree serializer (shared shape).
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
const LAUNCH_ID = "launch_xyz" as Id<"campaignLaunches">;

const LAUNCH: CampaignLaunchDetail = {
  id: LAUNCH_ID,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("LaunchDetailView — F-CAMPAGNES [6/7] (#240)", () => {
  it("loading branch (launch === undefined): renders a skeleton, no crash, no not-found copy", () => {
    const tree = serialize(
      LaunchDetailView({
        tenantId: TENANT_ID,
        launchId: LAUNCH_ID,
        launch: undefined,
      }),
    );
    expect(tree).not.toBeNull();
    const text = allText(tree);
    expect(text).not.toMatch(/introuvable/i);
    const hasSkeleton = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "skeleton";
    });
    expect(hasSkeleton).toBe(true);
  });

  it("not-found branch (launch === null): FR copy + back link to /campagnes/historique", () => {
    const tree = serialize(
      LaunchDetailView({
        tenantId: TENANT_ID,
        launchId: LAUNCH_ID,
        launch: null,
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/introuvable/i);
    const anchors = flatten(tree).filter(
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    ) as Array<{ type: string; props: Record<string, unknown> }>;
    const hrefs = anchors
      .map((a) => a.props["href"])
      .filter((h): h is string => typeof h === "string");
    expect(hrefs).toContain(`/t/${TENANT_ID}/campagnes/historique`);
  });

  it("loaded branch: surfaces the template label as the page title", () => {
    const text = allText(
      serialize(
        LaunchDetailView({
          tenantId: TENANT_ID,
          launchId: LAUNCH_ID,
          launch: LAUNCH,
        }),
      ),
    );
    expect(text).toContain(LAUNCH.templateLabel!);
  });

  it("loaded branch: delegates to `CampaignResultStats` (REUSED from slice 5, no duplication)", () => {
    // Pinned via source text — the React-tree serializer walks the JSX and we
    // also assert the import points at the slice-5 component, so a future
    // regression copying the 6 cards inline (instead of reusing) fails loud.
    const source = readFileSync(
      path.resolve(__dirname, "./launch-detail-view.tsx"),
      "utf8",
    );
    expect(source).toMatch(/CampaignResultStats/);
    // The path must resolve up into the slice-5 _components folder — i.e. NOT
    // a sibling under `historique/[launchId]/_components`. We forbid the
    // duplicated copy explicitly.
    expect(source).toMatch(
      /from\s+["']\.\.\/\.\.\/\[templateId\]\/_components\/CampaignResultStats["']/,
    );
  });

  it("loaded branch: renders the 6 counters by composing `CampaignResultStats`", () => {
    const text = allText(
      serialize(
        LaunchDetailView({
          tenantId: TENANT_ID,
          launchId: LAUNCH_ID,
          launch: LAUNCH,
        }),
      ),
    );
    // The reused component itself pins the FR labels; here we assert the
    // composition surfaces every numeric value the payload carries (so a
    // future regression that drops the result-stats wiring fails fast).
    for (const n of [42, 30, 5, 3, 2]) {
      expect(text).toContain(String(n));
    }
  });

  it("loaded branch: back link to /campagnes/historique surfaces", () => {
    const tree = serialize(
      LaunchDetailView({
        tenantId: TENANT_ID,
        launchId: LAUNCH_ID,
        launch: LAUNCH,
      }),
    );
    const anchors = flatten(tree).filter(
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    ) as Array<{ type: string; props: Record<string, unknown> }>;
    const hrefs = anchors
      .map((a) => a.props["href"])
      .filter((h): h is string => typeof h === "string");
    expect(hrefs).toContain(`/t/${TENANT_ID}/campagnes/historique`);
  });

  it("MOAT — no @ sign / email / téléphone across any branch", () => {
    const branches = [
      allText(
        serialize(
          LaunchDetailView({
            tenantId: TENANT_ID,
            launchId: LAUNCH_ID,
            launch: undefined,
          }),
        ),
      ),
      allText(
        serialize(
          LaunchDetailView({
            tenantId: TENANT_ID,
            launchId: LAUNCH_ID,
            launch: null,
          }),
        ),
      ),
      allText(
        serialize(
          LaunchDetailView({
            tenantId: TENANT_ID,
            launchId: LAUNCH_ID,
            launch: LAUNCH,
          }),
        ),
      ),
    ];
    for (const text of branches) {
      expect(text).not.toMatch(/@/);
      expect(text).not.toMatch(/\bemail\b/i);
      expect(text).not.toMatch(/\btéléphone\b/i);
      expect(text).not.toMatch(/\btelephone\b/i);
    }
  });
});
