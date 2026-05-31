/**
 * F-SHELL-10 (#233) — `ProspectFicheView` test matrix.
 *
 * Pure presentational shell of the `/pipeline/[prospectId]` route: takes the
 * resolved `session` + the `prospect` snapshot as props and decides what to
 * render. Splitting it out of `page.tsx` (which owns `useSession`, `useQuery`,
 * `useParams`, `useRouter`) lets vitest pin every branch — forbidden,
 * loading, not-found, hydrated with/without tenantId back-link — in the lean
 * `node` env (no jsdom, no Convex test harness), same React-tree-serializer
 * pattern already used by `monitoring-view.test.tsx`, `support/page.test.tsx`,
 * `unauthorized-card.test.tsx`.
 *
 * Acceptance criteria covered (issue #233):
 *   - AC1 « Header affiche nom + statut du prospect » — assert the prospect
 *     name AND its `phase` (the canonical pipeline status from the schema
 *     — kb-admin CONTEXT « Phase pipeline ») surface in the rendered tree.
 *   - AC2 « Bouton "Ouvrir la vue resto" » — DELEGATED to
 *     `ProvisionLauncherButton` (F-WIZARD [2/10] #266) which now owns
 *     ALL provisioning-side CTAs and their visibility logic. The fiche
 *     just mounts it. The launcher's branches are pinned by
 *     `provision-launcher.decision.test.ts` and
 *     `provision-launcher-button.test.tsx`; here we only assert that the
 *     fiche actually mounts the launcher (and feeds it `tenant`).
 *   - AC3 « KB Manager → erreur 403 (kbAdminQuery throw) » — at the UX
 *     layer, this is the shared `UnauthorizedCard` (« Accès non autorisé »).
 *     The real backend throw is owned by `kbAdminQuery` (ADR 0010) — this
 *     test pins the UX surface, not the network round-trip.
 *   - AC5 « Placeholder "Contenu détaillé livré par F-PIPELINE-CRM" dans
 *     le corps » — assert the placeholder copy surfaces under the header
 *     (anchors the route while the detailed content lands in the follow-up
 *     epic F-PIPELINE-CRM).
 *
 * The route binding itself (file at
 * `apps/admin/src/app/(app)/pipeline/[prospectId]/page.tsx` resolves to URL
 * `/pipeline/<prospectId>`) is owned by Next.js' file-system router — an E2E
 * (Playwright) covers that, not a unit test. We don't pin it here.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";
import type { SessionState } from "@/lib/session";

import { ProspectFicheView } from "./prospect-fiche-view";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as monitoring-view.test.tsx /
// support/page.test.tsx / unauthorized-card.test.tsx.
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
const FIXTURE_USER = {
  userId: "users_xxx" as unknown as Id<"users">,
  email: "fixture@kb.test",
};

function adminSession(): SessionState {
  return {
    status: "ready",
    session: { isAdmin: true, tenants: [], user: FIXTURE_USER },
  };
}

function managerSession(): SessionState {
  return {
    status: "ready",
    session: {
      isAdmin: false,
      tenants: [
        {
          tenantId: TENANT_ID,
          slug: "khan",
          name: "Khan",
          role: "kb_manager",
        },
      ],
      user: FIXTURE_USER,
    },
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
    phase: "acquisition",
    source: "cold_call",
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ProspectFicheView — F-SHELL-10 (#233)", () => {
  it("AC3 — refuses access cleanly when `session.isAdmin === false` (« Accès non autorisé » via shared UnauthorizedCard)", () => {
    const tree = serialize(
      ProspectFicheView({
        session: managerSession(),
        prospect: makeProspect({ tenantId: TENANT_ID }),
      }),
    );
    const text = allText(tree);
    // Canonical vocabulary from UnauthorizedCard (pinned across the 3 refusal
    // sites — manager-on-other-tenant, monitoring, no-tenant — by
    // `unauthorized-card.test.tsx`).
    expect(text).toMatch(/Acc[èe]s non autoris[ée]/i);
    // The prospect data MUST NOT leak even if it was passed: an aggressive
    // future caller could pass real data while the session is still being
    // re-checked. Pin that the refusal surface is rendered, not the body.
    expect(text).not.toContain("L'Artisan");
    // The « Ouvrir la vue resto » CTA MUST NOT render (it would leak the
    // tenantId of a foreign resto to a manager).
    expect(text).not.toMatch(/Ouvrir la vue resto/i);
  });

  it("renders a loading state when session is still resolving (parent SessionGuard would normally intercept, defensive default here)", () => {
    const tree = serialize(
      ProspectFicheView({
        session: { status: "loading" },
        prospect: undefined,
      }),
    );
    const text = allText(tree);
    // Don't pin the exact copy, but the surface must NOT be the unauthorised
    // card (the session isn't denied yet — it's loading).
    expect(text).not.toMatch(/Acc[èe]s non autoris[ée]/i);
  });

  it("renders a loading state when prospect is `undefined` (Convex in-flight)", () => {
    const tree = serialize(
      ProspectFicheView({
        session: adminSession(),
        prospect: undefined,
      }),
    );
    const text = allText(tree);
    // Loading shell must NOT look like the not-found surface.
    expect(text).not.toMatch(/introuvable/i);
    // Loading shell must NOT surface a prospect name (there isn't one yet).
    expect(text).not.toContain("L'Artisan");
  });

  it("renders a not-found state when prospect is `null` (no doc with this id)", () => {
    const tree = serialize(
      ProspectFicheView({
        session: adminSession(),
        prospect: null,
      }),
    );
    const text = allText(tree);
    // Don't pin exact copy, but something distinguishable from « loading ».
    expect(text).toMatch(/introuvable|introuvé/i);
    // No CTA leaking a tenant URL.
    expect(text).not.toMatch(/Ouvrir la vue resto/i);
  });

  it("AC1 — header surfaces the prospect's name AND its `phase` (the canonical pipeline status from the schema)", () => {
    const prospect = makeProspect({
      name: "Mon Resto",
      phase: "preparation",
    });
    const tree = serialize(
      ProspectFicheView({ session: adminSession(), prospect }),
    );
    const text = allText(tree);
    expect(text).toContain("Mon Resto");
    // The phase is the canonical pipeline status (kb-admin CONTEXT « Phase
    // pipeline », acté 2026-05-23): one of `acquisition | preparation |
    // installation | operationnel`. The view surfaces it as a status badge.
    expect(text).toMatch(/pr[ée]paration/i);
  });

  it("AC2 — « Ouvrir la vue resto » CTA is rendered when `prospect.tenantId` is set AND the (plumbed) tenant is `active` (F-WIZARD [2/10] #266 policy)", () => {
    // Policy change vs the original AC2: the launcher (#266) only promotes
    // to « Ouvrir la vue resto » once `tenant.status === "active"`. A
    // tenantId back-link alone keeps it on « Reprendre le wizard ». The
    // fiche just plumbs the tenant doc through; the launcher decides.
    const prospect = makeProspect({
      tenantId: TENANT_ID,
      milestones: {
        contratSigne: 1,
        kbisRecu: 1,
        pieceIdentiteRecue: 1,
        ribRecu: 1,
      },
    });
    const tenant: Doc<"tenants"> = {
      _id: TENANT_ID,
      _creationTime: 1_700_000_000_000,
      slug: "lartisan",
      name: "L'Artisan",
      siret: "12345678900012",
      status: "active",
    };
    const tree = serialize(
      ProspectFicheView({ session: adminSession(), prospect, tenant }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Ouvrir la vue resto/i);
    // Pinned at the anchor level — the button is rendered as `<a>` via
    // shadcn `<Button asChild>`. The serializer surfaces the href directly.
    const anchors = findAllByType(tree, "a");
    const hrefs = anchors
      .map((a) => (a as { props: { href?: unknown } }).props.href)
      .filter((h): h is string => typeof h === "string");
    expect(hrefs).toContain(`/t/${TENANT_ID as unknown as string}`);
  });

  it("AC2 — « Ouvrir la vue resto » CTA is ABSENT when `prospect.tenantId` is undefined (still-prospect, not yet provisioned)", () => {
    const prospect = makeProspect({ tenantId: undefined });
    const tree = serialize(
      ProspectFicheView({ session: adminSession(), prospect }),
    );
    const text = allText(tree);
    expect(text).not.toMatch(/Ouvrir la vue resto/i);
    // No anchor pointing into the operational space.
    const anchors = findAllByType(tree, "a");
    const hrefs = anchors
      .map((a) => (a as { props: { href?: unknown } }).props.href)
      .filter((h): h is string => typeof h === "string");
    for (const h of hrefs) {
      expect(h).not.toMatch(/^\/t\//);
    }
  });

  it("AC5 — surfaces the « Contenu détaillé livré par F-PIPELINE-CRM » placeholder under the header (anchors the route while the detailed content lands in the follow-up epic)", () => {
    const prospect = makeProspect();
    const tree = serialize(
      ProspectFicheView({ session: adminSession(), prospect }),
    );
    const text = allText(tree);
    // The placeholder copy explicitly names the follow-up epic so a future
    // reader of the surface knows where the actual content will live.
    expect(text).toMatch(/F-PIPELINE-CRM/);
  });
});
