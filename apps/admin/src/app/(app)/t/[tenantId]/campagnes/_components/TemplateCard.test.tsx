/**
 * F-CAMPAGNES [2/7] (#188) — `TemplateCard`, the per-template shadcn card of
 * the campaigns picker (parent EPIC #145).
 *
 * Issue body verbatim: « carte shadcn affichant **nom du template**, **canal
 * porté** (push / email), **aperçu court** du message (premier extrait du
 * template, tronqué). Indicateur visuel pour l'état `active=false` (carte
 * grisée, disabled). Clic = navigation vers
 * `/t/[tenantId]/campagnes/[templateId]` ».
 *
 * Pinned via the same pure React-tree-serializer pattern as the slice-1
 * `campagnes-view.test.tsx`: vitest runs in `environment: "node"` (no jsdom,
 * no RTL — see `apps/admin/vitest.config.ts`). We walk the React tree the
 * component returns and assert text content + structural shape.
 *
 * Acceptance criteria covered (#188):
 *   - AC1 « `TemplateCard` rend nom + canal + aperçu » — assert label,
 *     channel badges (push + email — the V1 tenant cascade is Web Push >
 *     Wallet > Email per `marketingCascade.ts`), and a truncated body
 *     preview all surface.
 *   - AC1 « état actif/inactif visible » — when `active=false`, the card
 *     MUST be rendered as disabled (no anchor / no click handler) and carry
 *     a visible « Inactif » marker so the gérant doesn't waste a click.
 *   - AC5 « Clic sur une carte navigue vers
 *     `/t/[tenantId]/campagnes/[templateId]` » — assert the active card
 *     contains an anchor whose `href` is the per-template route built from
 *     the tenantId + template id props.
 *   - AC7 « FR uniquement (strings inline) » — every visible string is
 *     French (no English fallback like "Active" / "Inactive" / "Preview").
 *
 * Cross-tenant fuzz / MOAT: this is a presentational card; it carries NO
 * recipient identity, NO query, NO mutation — isolation is owned by the
 * `listTenantTemplates` wrapper that produced the `TenantTemplateSummary`
 * (already pinned by `campaigns.test.ts` cross-tenant fuzz at slice 0). No
 * fuzz needed at this layer.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { TemplateCard } from "./TemplateCard";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as `campagnes-view.test.tsx`.
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

/** Whether `t` is a React `forwardRef` value with an `href` consumer
 *  (true for `next/link`'s `Link`). We can't invoke `Link.render(...)`
 *  here because Link uses hooks internally (`useContext`) which require
 *  a real React render — instead we treat it as if it had rendered the
 *  anchor it ultimately produces, forwarding `href` + `children`. */
function isLinkLikeForwardRef(t: unknown): boolean {
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
    // `next/link`'s `Link` is a `forwardRef` whose `.render()` uses React
    // hooks internally (`useContext`) — invoking it outside a real React
    // render throws « Invalid hook call ». But the only thing the test
    // cares about is the resulting `<a href>` shape, which IS the public
    // contract of Link. So we shim it: treat any forwardRef element with
    // an `href` prop as if it had rendered `<a href={...}>{children}</a>`,
    // preserving the props (href + className + aria-label) the test
    // asserts on and recursing into children.
    if (
      isLinkLikeForwardRef(node.type) &&
      "href" in (node.props as Record<string, unknown>)
    ) {
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
      return { type: "a", props, children };
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

function findFirst(
  n: SerializedNode,
  predicate: (s: SerializedNode) => boolean,
): SerializedNode | null {
  for (const node of flatten(n)) {
    if (predicate(node)) return node;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const TENANT_ID = "tenant_abc" as Id<"tenants">;

function makeTemplate(
  key: string,
  label: string,
  overrides: Partial<TenantTemplateSummary> = {},
): TenantTemplateSummary {
  return {
    id: `tpl_${key}` as Id<"notificationTemplates">,
    key,
    label,
    body: `Salut {prenom_client}, ${label} chez {nom_resto} aujourd'hui !`,
    variables: [],
    deepLinkTarget: "catalogue",
    language: "fr",
    maxDiscountPercent: 0,
    containsAlcohol: false,
    ...overrides,
  };
}

const ACTIVE_TEMPLATE = makeTemplate("welcome_back", "Bienvenue de retour");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("TemplateCard — F-CAMPAGNES [2/7] (#188)", () => {
  it("AC1 — surfaces the template label", () => {
    const text = allText(
      serialize(<TemplateCard tenantId={TENANT_ID} template={ACTIVE_TEMPLATE} />),
    );
    expect(text).toContain(ACTIVE_TEMPLATE.label);
  });

  it("AC1 — surfaces the channel badges of the V1 tenant cascade (Push + Email)", () => {
    // The V1 tenant cascade is Web Push > Wallet > Email
    // (`marketingCascade.ts`: TENANT_CASCADE). All tenant templates flow
    // through the SAME cascade, so the card surfaces both labels — "Push"
    // (cover both web + wallet push) and "Email" (the deterministic
    // fallback). FR labels.
    const text = allText(
      serialize(<TemplateCard tenantId={TENANT_ID} template={ACTIVE_TEMPLATE} />),
    );
    expect(text).toMatch(/Push/);
    expect(text).toMatch(/E-?mail/i);
  });

  it("AC1 — surfaces a SHORT preview of the body (first chars of the template body)", () => {
    // « aperçu court du message (premier extrait du template, tronqué) ».
    // The first 6 chars of the body must surface so the gérant recognises
    // the template at a glance.
    const text = allText(
      serialize(<TemplateCard tenantId={TENANT_ID} template={ACTIVE_TEMPLATE} />),
    );
    expect(text).toContain(ACTIVE_TEMPLATE.body.slice(0, 6));
  });

  it("AC1 — truncates a LONG body preview (does not surface the full body verbatim if longer than the threshold)", () => {
    const long = "x".repeat(300);
    const longTemplate = makeTemplate("long", "Long template", { body: long });
    const text = allText(
      serialize(<TemplateCard tenantId={TENANT_ID} template={longTemplate} />),
    );
    // Truncated — the full 300-char body must NOT be rendered as-is. The
    // implementation may use an ellipsis ("…") or any visible cue, we only
    // pin that the full string is not dumped (card layout would explode).
    expect(text).not.toContain(long);
  });

  it("AC5 — active card renders an anchor whose href targets `/t/[tenantId]/campagnes/[templateId]`", () => {
    const tree = serialize(
      <TemplateCard tenantId={TENANT_ID} template={ACTIVE_TEMPLATE} />,
    );
    const anchor = findFirst(
      tree,
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    );
    expect(anchor).not.toBeNull();
    // The href is built from props — assert the resolved path exactly.
    const href = (anchor as { props: Record<string, unknown> }).props["href"];
    expect(href).toBe(
      `/t/${TENANT_ID}/campagnes/${ACTIVE_TEMPLATE.id}`,
    );
  });

  it("AC1 — inactive card (active=false) does NOT render an anchor (no navigation when disabled)", () => {
    const tree = serialize(
      <TemplateCard
        tenantId={TENANT_ID}
        template={ACTIVE_TEMPLATE}
        active={false}
      />,
    );
    const anchor = findFirst(
      tree,
      (n) => n !== null && !("text" in n) && n.type.toLowerCase() === "a",
    );
    // An inactive card MUST NOT be clickable — issue body: « carte grisée,
    // disabled ». No anchor at all is the simplest pin (a click on the
    // surrounding card body cannot accidentally navigate).
    expect(anchor).toBeNull();
  });

  it("AC1 — inactive card surfaces a visible « Inactif » marker (so the gérant sees WHY they can't click)", () => {
    const text = allText(
      serialize(
        <TemplateCard
          tenantId={TENANT_ID}
          template={ACTIVE_TEMPLATE}
          active={false}
        />,
      ),
    );
    expect(text).toMatch(/Inactif/i);
  });

  it("AC1 — active card does NOT surface the « Inactif » marker (no false positive)", () => {
    const text = allText(
      serialize(<TemplateCard tenantId={TENANT_ID} template={ACTIVE_TEMPLATE} />),
    );
    expect(text).not.toMatch(/Inactif/i);
  });

  it("AC7 — FR-only: no English fallback in either state", () => {
    const branches = [
      allText(
        serialize(
          <TemplateCard tenantId={TENANT_ID} template={ACTIVE_TEMPLATE} />,
        ),
      ),
      allText(
        serialize(
          <TemplateCard
            tenantId={TENANT_ID}
            template={ACTIVE_TEMPLATE}
            active={false}
          />,
        ),
      ),
    ];
    for (const text of branches) {
      expect(text).not.toMatch(/\bActive\b/);
      expect(text).not.toMatch(/\bInactive\b/);
      expect(text).not.toMatch(/\bDisabled\b/);
      expect(text).not.toMatch(/\bPreview\b/);
      expect(text).not.toMatch(/\bTemplate\b/);
    }
  });
});
