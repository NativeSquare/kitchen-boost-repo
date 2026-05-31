/**
 * F-WIZARD [2/10] (#266) — `ProvisionLauncherButton` view test matrix.
 *
 * Pure presentational shell on top of `decideProvisionLauncher`. Uses the
 * same React-tree serializer pattern as `prospect-fiche-view.test.tsx` /
 * `monitoring-view.test.tsx` so vitest pins every branch under the lean
 * `node` env (no jsdom, no Convex test harness).
 *
 * Acceptance criteria pinned (issue #266):
 *
 *   - AC1 « Composant `ProvisionLauncherButton` exporté » — implicit (the
 *     test imports the named export).
 *   - AC2 « Bouton visible seulement quand le prospect est en phase
 *     Closing » — `hidden` branch renders NOTHING.
 *   - AC3 « Label "Lancer le wizard de provisioning" / "Reprendre le
 *     wizard" » — pinned as visible text in launch / resume branches.
 *   - AC4 « Click → navigation vers la route wizard » — pinned at the
 *     anchor level (`<a href="/pipeline/<id>/provision">`).
 *   - AC5 « Bouton "Ouvrir la vue resto" remplace le bouton wizard quand
 *     le tenant est `active` » — view-tenant branch surfaces the
 *     « Ouvrir la vue resto » label + the operational href.
 *   - AC6 « Warning visuel si email gérant manquant sur le prospect » —
 *     warning copy surfaces alongside the launch / resume button.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { ProvisionLauncherButton } from "./provision-launcher-button";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as prospect-fiche-view.test.tsx.
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

function findAllByType(n: SerializedNode, type: string): SerializedNode[] {
  return flatten(n).filter(
    (
      x,
    ): x is {
      type: string;
      props: Record<string, unknown>;
      children: SerializedNode[];
    } => x !== null && "type" in x && x.type === type,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;
const TENANT_ID = "tenants_aaa" as unknown as Id<"tenants">;

function closingComplete(): NonNullable<Doc<"prospects">["milestones"]> {
  const at = 1_700_000_000_000;
  return {
    contratSigne: at,
    kbisRecu: at,
    pieceIdentiteRecue: at,
    ribRecu: at,
  };
}

function makeProspect(
  overrides: Partial<Doc<"prospects">> = {},
): Doc<"prospects"> {
  return {
    _id: PROSPECT_ID,
    _creationTime: 1_700_000_000_000,
    name: "L'Artisan",
    phone: "0612345678",
    phase: "preparation",
    source: "cold_call",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    milestones: closingComplete(),
    email: "gerant@resto.fr",
    ...overrides,
  };
}

function makeTenant(overrides: Partial<Doc<"tenants">> = {}): Doc<"tenants"> {
  return {
    _id: TENANT_ID,
    _creationTime: 1_700_000_000_000,
    slug: "lartisan",
    name: "L'Artisan",
    siret: "12345678900012",
    status: "pending",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ProvisionLauncherButton — F-WIZARD [2/10] (#266)", () => {
  it("AC2 — renders NOTHING when Closing is not complete (prospect has no milestones)", () => {
    const tree = serialize(
      ProvisionLauncherButton({
        prospect: makeProspect({ milestones: undefined }),
        tenant: undefined,
      }),
    );
    // The hidden branch returns null — the serializer surfaces no text.
    expect(allText(tree).trim()).toBe("");
    // No anchor leaks the wizard URL.
    const anchors = findAllByType(tree, "a");
    expect(anchors).toHaveLength(0);
  });

  it("AC3 — Closing-complete + no tenantId back-link → « Lancer le wizard de provisioning »", () => {
    const tree = serialize(
      ProvisionLauncherButton({
        prospect: makeProspect(),
        tenant: undefined,
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Lancer le wizard de provisioning/i);
    // The « Reprendre » label MUST NOT also show.
    expect(text).not.toMatch(/Reprendre le wizard/i);
  });

  it("AC3 + AC4 — `launch` href points at `/pipeline/<prospectId>/provision`", () => {
    const tree = serialize(
      ProvisionLauncherButton({
        prospect: makeProspect(),
        tenant: undefined,
      }),
    );
    const anchors = findAllByType(tree, "a");
    const hrefs = anchors
      .map((a) => (a as { props: { href?: unknown } }).props.href)
      .filter((h): h is string => typeof h === "string");
    expect(hrefs).toContain(
      `/pipeline/${PROSPECT_ID as unknown as string}/provision`,
    );
  });

  it("AC3 — Closing-complete + tenantId back-link set (tenant still pending) → « Reprendre le wizard »", () => {
    const tree = serialize(
      ProvisionLauncherButton({
        prospect: makeProspect({ tenantId: TENANT_ID }),
        tenant: makeTenant({ status: "pending" }),
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Reprendre le wizard/i);
    // The « Lancer » label MUST NOT also show.
    expect(text).not.toMatch(/Lancer le wizard de provisioning/i);
  });

  it("AC5 — Closing-complete + tenant `active` → « Ouvrir la vue resto » (replaces the wizard button)", () => {
    const tree = serialize(
      ProvisionLauncherButton({
        prospect: makeProspect({ tenantId: TENANT_ID }),
        tenant: makeTenant({ status: "active" }),
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Ouvrir la vue resto/i);
    // The wizard labels MUST NOT show — the active state owns the surface.
    expect(text).not.toMatch(/Lancer le wizard de provisioning/i);
    expect(text).not.toMatch(/Reprendre le wizard/i);
    // The operational href is wired.
    const anchors = findAllByType(tree, "a");
    const hrefs = anchors
      .map((a) => (a as { props: { href?: unknown } }).props.href)
      .filter((h): h is string => typeof h === "string");
    expect(hrefs).toContain(`/t/${TENANT_ID as unknown as string}`);
  });

  it("AC6 — `launch` + email missing → warning « L'email du gérant sera demandé au step 1 » surfaces next to the button", () => {
    const tree = serialize(
      ProvisionLauncherButton({
        prospect: makeProspect({ email: undefined }),
        tenant: undefined,
      }),
    );
    const text = allText(tree);
    // The button is still rendered (the warning is informational, not a block).
    expect(text).toMatch(/Lancer le wizard de provisioning/i);
    // The warning copy is verbatim from the issue spec.
    expect(text).toMatch(/L'email du g[ée]rant sera demand[ée] au step 1/i);
  });

  it("AC6 — `launch` + email present → NO warning rendered", () => {
    const tree = serialize(
      ProvisionLauncherButton({
        prospect: makeProspect({ email: "gerant@resto.fr" }),
        tenant: undefined,
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Lancer le wizard de provisioning/i);
    expect(text).not.toMatch(/L'email du g[ée]rant sera demand[ée]/i);
  });

  it("AC6 — `resume` + email missing → warning surfaces (the wizard step 1 still covers it but operator gets the heads-up)", () => {
    const tree = serialize(
      ProvisionLauncherButton({
        prospect: makeProspect({
          email: undefined,
          tenantId: TENANT_ID,
        }),
        tenant: makeTenant({ status: "pending" }),
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Reprendre le wizard/i);
    expect(text).toMatch(/L'email du g[ée]rant sera demand[ée] au step 1/i);
  });

  it("AC5 + AC6 — `view-tenant` NEVER carries the email warning (we are past provisioning)", () => {
    const tree = serialize(
      ProvisionLauncherButton({
        prospect: makeProspect({
          email: undefined,
          tenantId: TENANT_ID,
        }),
        tenant: makeTenant({ status: "active" }),
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Ouvrir la vue resto/i);
    expect(text).not.toMatch(/L'email du g[ée]rant sera demand[ée]/i);
  });
});
