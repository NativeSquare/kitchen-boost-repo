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
      createdAt: 1_700_000_000_000,
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

  it("F-CONTRATS slice 1/4 (#158) — mounts the `ContractsBlock` in the `show` branch (block heading « Contrats » + empty state when the list is empty)", () => {
    const prospect = makeProspect();
    const tree = serialize(
      ProspectFicheView({
        session: adminSession(),
        prospect,
        contracts: [],
      }),
    );
    const text = allText(tree);
    // The block's heading « Contrats » must surface so the section is
    // locatable on the fiche. (The block's branches themselves are pinned
    // by `contracts-block.test.tsx` — here we only assert it is mounted.)
    expect(text).toMatch(/Contrats/);
    // Empty-state copy must surface for `contracts === []`.
    expect(text).toMatch(/Aucun contrat g[ée]n[ée]r[ée]/i);
  });

  it("F-CONTRATS slice 1/4 (#158) — does NOT leak the contracts block to a non-admin caller (the refusal UnauthorizedCard is the only surface)", () => {
    const tree = serialize(
      ProspectFicheView({
        session: managerSession(),
        prospect: makeProspect(),
        // Even if a hostile caller passed real contract data, the refusal
        // branch must render the UnauthorizedCard ONLY — no block heading,
        // no row, no status leak.
        contracts: [],
      }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Acc[èe]s non autoris[ée]/i);
    // The block heading must NOT surface in the refusal branch.
    expect(text).not.toMatch(/Aucun contrat g[ée]n[ée]r[ée]/i);
  });

  /**
   * F-CONTRATS slice 3/4 (#174) — the fiche mounts the
   * `GenerateContractLauncher` inside the `ContractsBlock` header slot
   * when (and only when) the page passes the `onGenerated` callback. It
   * also renders the slice-2 `ContractIframe` BELOW the block once the
   * page surfaces `generatedContractHtml`.
   */
  describe("F-CONTRATS slice 3/4 (#174) — launcher + iframe plumbing", () => {
    it("mounts the `GenerateContractLauncher` inside the ContractsBlock header when `onGenerated` is wired", () => {
      const tree = serialize(
        ProspectFicheView({
          session: adminSession(),
          prospect: makeProspect(),
          contracts: [],
          onGenerated: () => {},
        }),
      );
      // The launcher uses Convex `useMutation`, so the serializer's
      // try/catch yields a typed stub (component name) rather than
      // expanding its tree. We assert the component IS mounted by name
      // — its runtime branches (trigger copy, modal contents) are pinned
      // by `generate-contract-launcher.test.ts` + `generate-contract-
      // modal.test.tsx`.
      const launcherNodes = findAllByType(tree, "GenerateContractLauncher");
      expect(launcherNodes.length).toBe(1);
    });

    it("does NOT mount the launcher when `onGenerated` is omitted (preserves slice-1 read-only contract for non-supervision callers)", () => {
      const tree = serialize(
        ProspectFicheView({
          session: adminSession(),
          prospect: makeProspect(),
          contracts: [],
        }),
      );
      const launcherNodes = findAllByType(tree, "GenerateContractLauncher");
      expect(launcherNodes.length).toBe(0);
    });

    it("renders the `ContractIframe` below the block once `generatedContractHtml` is a string (sandbox attribute pinned by slice 2 tests)", () => {
      const html = "<html><body><h1>Contrat A — L'Artisan</h1></body></html>";
      const tree = serialize(
        ProspectFicheView({
          session: adminSession(),
          prospect: makeProspect(),
          contracts: [],
          onGenerated: () => {},
          generatedContractHtml: html,
        }),
      );
      const iframes = findAllByType(tree, "iframe");
      expect(iframes.length).toBe(1);
      const iframe = iframes[0] as { props: { srcDoc?: unknown } };
      expect(iframe.props.srcDoc).toBe(html);
      // Download button must surface alongside the iframe (slice-2 contract).
      const text = allText(tree);
      expect(text).toMatch(/T[ée]l[ée]charger HTML/i);
    });

    it("does NOT render the iframe when `generatedContractHtml` is undefined (no contract generated yet this session)", () => {
      const tree = serialize(
        ProspectFicheView({
          session: adminSession(),
          prospect: makeProspect(),
          contracts: [],
          onGenerated: () => {},
        }),
      );
      const iframes = findAllByType(tree, "iframe");
      expect(iframes.length).toBe(0);
    });

    it("renders the iframe's error branch when `generatedContractHtml === null` (row resolved, no html — slice-2 fallback)", () => {
      const tree = serialize(
        ProspectFicheView({
          session: adminSession(),
          prospect: makeProspect(),
          contracts: [],
          onGenerated: () => {},
          generatedContractHtml: null,
        }),
      );
      // The iframe element itself MUST NOT render in the error branch
      // (slice-2 contract — « pas d'iframe blanche silencieuse »).
      const iframes = findAllByType(tree, "iframe");
      expect(iframes.length).toBe(0);
      const text = allText(tree);
      // The slice-2 error-copy semantic surfaces (« aucun / erreur /
      // impossible / indisponible »).
      expect(text).toMatch(/aucun|erreur|impossible|indisponible/i);
    });
  });
});
