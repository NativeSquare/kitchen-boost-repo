/**
 * F-CONTRATS slice 1/4 (#158) — `ContractsBlock` test matrix.
 *
 * Pure presentational block (read-only V1) mounted on `/pipeline/[prospectId]`
 * (the supervision fiche of a [[Prospect]], cf. ADR 0014 §5 + amendement
 * 2026-05-27 — la clé est `prospectId`, PAS `tenantId`). The block reads the
 * prospect's contracts list (one line per generated version) and surfaces
 *  - prestation (A / B / A&B, contrat_template.md §1.3),
 *  - generation date (kb-admin CONTEXT « Statut contrat » — daté),
 *  - lifecycle status badge (draft / sent / signed / expired, PRD 70 §3.5).
 *
 * V1 is INFORMATIVE: zero buttons. No « Générer » (slice 3), no « Envoyer
 * Odoo », no « Rafraîchir statut », no « Marquer signé ». PRD 70 §3.5
 * « Contrats V1 simplifié » (acté grilling front 2026-05-27): le front
 * V1 = générer + iframe seulement; envoi Odoo + tracking statut + refresh
 * sont MANUELS hors-app (Alex sur Odoo direct). Cette slice 1/4 ne livre
 * même PAS « générer » — uniquement la lecture seule.
 *
 * Same lean-node test pattern as `prospect-fiche-view.test.tsx` /
 * `monitoring-view.test.tsx` / `support/page.test.tsx`: the React tree is
 * serialised by hand (no jsdom, no RTL, no Convex test harness) so every
 * branch — empty / 1 row / N rows / each of the 4 statuses — pins cleanly.
 *
 * Acceptance criteria covered (issue #158):
 *   - AC «liste 1 ligne / prestation, date, badge»     → pinned in « renders
 *                                                          one row per contract,
 *                                                          surfaces prestation,
 *                                                          date, status badge ».
 *   - AC «4 statuts ont chacun un rendu visuel distinct» → pinned in « renders
 *                                                          a distinct badge
 *                                                          variant for each
 *                                                          status ».
 *   - AC «état vide explicite si aucun contrat»         → pinned in « renders
 *                                                          an empty state when
 *                                                          the list is empty ».
 *   - AC «test négatif : aucun bouton « Envoyer », « Rafraîchir »,
 *         « Marquer signé », « Générer » à ce stade»    → pinned in « never
 *                                                          renders any action
 *                                                          button (V1 = read
 *                                                          only) ».
 *
 * RBAC (AC «KB Manager → redirect par F-SHELL — smoke-test») is owned by the
 * parent fiche (`prospect-fiche-view.tsx`'s `decideProspectFiche` →
 * `UnauthorizedCard`, pinned by `prospect-fiche-view.test.tsx`'s AC3). This
 * block is only ever mounted under the `show` branch — it does NOT re-pin
 * the refusal surface.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import type { Doc, Id } from "@packages/backend/convex/_generated/dataModel";

import { ContractsBlock } from "./contracts-block";

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as prospect-fiche-view.test.tsx /
// monitoring-view.test.tsx / support/page.test.tsx.
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

function findBadges(n: SerializedNode): {
  variant: unknown;
  text: string;
}[] {
  // The shadcn `Badge` adds `data-slot="badge"` + `data-variant="..."` on a
  // `<span>` (cf. components/ui/badge.tsx). The serializer surfaces the
  // unwrapped span — pin the slot via that data-attribute to match badges
  // robustly even if the underlying tag ever changes.
  return flatten(n)
    .filter(
      (
        x,
      ): x is {
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      } =>
        x !== null &&
        "type" in x &&
        (x.props as Record<string, unknown>)["data-slot"] === "badge",
    )
    .map((b) => ({
      variant: (b.props as Record<string, unknown>)["data-variant"],
      text: allText(b),
    }));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const PROSPECT_ID = "prospects_xxx" as unknown as Id<"prospects">;

function makeContract(
  overrides: Partial<Doc<"contracts">> = {},
): Doc<"contracts"> {
  return {
    _id: "contracts_xxx" as unknown as Id<"contracts">,
    _creationTime: 1_700_000_000_000,
    prospectId: PROSPECT_ID,
    prestation: "A",
    status: "draft",
    statusUpdatedAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ContractsBlock — F-CONTRATS slice 1/4 (#158)", () => {
  it("renders an empty state when the contracts list is empty (« Aucun contrat généré pour ce prospect. »)", () => {
    const tree = serialize(ContractsBlock({ contracts: [] }));
    const text = allText(tree);
    expect(text).toMatch(/Aucun contrat g[ée]n[ée]r[ée]/i);
    // The empty state must NOT surface a row count or any action button.
    expect(findAllByType(tree, "button").length).toBe(0);
  });

  it("renders a loading state when contracts is `undefined` (Convex query in-flight) — distinct from the empty state", () => {
    const tree = serialize(ContractsBlock({ contracts: undefined }));
    const text = allText(tree);
    // Loading shell must NOT look like the empty state — the user must know
    // the query is still resolving, not that there are zero contracts.
    expect(text).not.toMatch(/Aucun contrat g[ée]n[ée]r[ée]/i);
  });

  it("AC — renders one row per contract, surfaces the prestation (A / B / A&B), the date, and the status badge", () => {
    const contracts = [
      makeContract({
        _id: "contracts_001" as unknown as Id<"contracts">,
        prestation: "A",
        status: "draft",
        createdAt: new Date("2025-02-14T10:30:00Z").getTime(),
      }),
      makeContract({
        _id: "contracts_002" as unknown as Id<"contracts">,
        prestation: "B",
        status: "sent",
        createdAt: new Date("2025-03-20T08:00:00Z").getTime(),
      }),
      makeContract({
        _id: "contracts_003" as unknown as Id<"contracts">,
        prestation: "A_AND_B",
        status: "signed",
        createdAt: new Date("2025-04-01T12:00:00Z").getTime(),
      }),
    ];
    const tree = serialize(ContractsBlock({ contracts }));
    const text = allText(tree);

    // Prestation labels (canonical from contrat_template.md §1.3 — the
    // human-readable label is « A » / « B » / « A&B »).
    expect(text).toMatch(/\bA\b/);
    expect(text).toMatch(/\bB\b/);
    expect(text).toMatch(/A\s*&\s*B/);

    // Date evidence: at least the year must appear for each contract
    // (the locale-formatted date — `fr-FR` — surfaces « 2025 » both for
    // 14/02/2025 and 01/04/2025). The exact format is up to the component;
    // here we pin only the verifiable date evidence so a switch from
    // `toLocaleDateString` to `Intl.DateTimeFormat` doesn't break the test.
    expect(text).toMatch(/2025/);

    // 3 status badges must be rendered (one per contract row).
    const badges = findBadges(tree);
    expect(badges.length).toBeGreaterThanOrEqual(3);
  });

  it("AC — renders a distinct badge variant for each of the 4 statuses (draft / sent / signed / expired)", () => {
    const contracts: Doc<"contracts">[] = (
      ["draft", "sent", "signed", "expired"] as const
    ).map((status, i) =>
      makeContract({
        _id: `contracts_${i}` as unknown as Id<"contracts">,
        status,
      }),
    );
    const tree = serialize(ContractsBlock({ contracts }));
    const badges = findBadges(tree);
    // One badge per row.
    expect(badges.length).toBe(4);
    // Each variant must be distinct so the user can tell statuses apart at
    // a glance (AC «4 statuts ont chacun un rendu visuel distinct»).
    const variants = badges.map((b) => b.variant);
    const uniqueVariants = new Set(variants);
    expect(uniqueVariants.size).toBe(4);
    // Each badge must surface the canonical status label, in French, in the
    // user copy. Pinned so a translation change is explicit.
    const text = allText(tree);
    expect(text).toMatch(/brouillon/i);
    expect(text).toMatch(/envoy[ée]/i);
    expect(text).toMatch(/sign[ée]/i);
    expect(text).toMatch(/expir[ée]/i);
  });

  it("AC negative test — never renders any action button (« Générer », « Envoyer », « Rafraîchir », « Marquer signé ») in V1 read-only mode", () => {
    const contracts = [
      makeContract({ status: "draft" }),
      makeContract({ status: "sent" }),
      makeContract({ status: "signed" }),
      makeContract({ status: "expired" }),
    ];
    const tree = serialize(ContractsBlock({ contracts }));
    // Zero `<button>` elements anywhere in the block.
    expect(findAllByType(tree, "button").length).toBe(0);
    // Defensive: the action vocabulary must not surface anywhere either —
    // even as a label, tooltip text, or aria-label string visible to the
    // user (issue #158 « test négatif »).
    const text = allText(tree);
    expect(text).not.toMatch(/G[ée]n[ée]rer/i);
    expect(text).not.toMatch(/Envoyer/i);
    expect(text).not.toMatch(/Rafra[iî]chir/i);
    expect(text).not.toMatch(/Marquer sign[ée]/i);
    // No anchor pointing to Odoo or to a contract action either.
    const anchors = findAllByType(tree, "a");
    expect(anchors.length).toBe(0);
  });

  it("AC — surfaces a recognisable block heading « Contrats » so the section is locatable on the fiche", () => {
    const tree = serialize(ContractsBlock({ contracts: [] }));
    const text = allText(tree);
    expect(text).toMatch(/Contrats/);
  });

  /**
   * F-CONTRATS slice 3/4 (#174) extension — the block exposes an OPTIONAL
   * `headerAction` slot. When the parent (`prospect-fiche-view.tsx`) passes
   * the `GenerateContractLauncher` trigger, the block mounts it next to the
   * « Contrats » heading. When the prop is omitted, the slice-1 « V1 read-
   * only » contract still holds (no button surface — tests above pin it).
   */
  describe("headerAction slot — F-CONTRATS slice 3/4 (#174)", () => {
    it("renders the headerAction node when provided (locates by data-slot)", () => {
      const tree = serialize(
        ContractsBlock({
          contracts: [],
          headerAction: {
            type: "button",
            props: { "data-slot": "fake-generate-trigger", children: "X" },
          } as unknown as React.ReactElement,
        }),
      );
      const slot = flatten(tree).filter(
        (
          x,
        ): x is {
          type: string;
          props: Record<string, unknown>;
          children: SerializedNode[];
        } =>
          x !== null &&
          "type" in x &&
          (x.props as Record<string, unknown>)["data-slot"] ===
            "contracts-block-header-action",
      );
      expect(slot.length).toBe(1);
      // The wrapping slot must contain the passed node — pinned by the
      // inner fake trigger's data-slot.
      const inner = flatten(tree).filter(
        (
          x,
        ): x is {
          type: string;
          props: Record<string, unknown>;
          children: SerializedNode[];
        } =>
          x !== null &&
          "type" in x &&
          (x.props as Record<string, unknown>)["data-slot"] ===
            "fake-generate-trigger",
      );
      expect(inner.length).toBe(1);
    });

    it("does NOT render the headerAction wrapper when the prop is omitted (slice-1 read-only contract preserved)", () => {
      const tree = serialize(ContractsBlock({ contracts: [] }));
      const slot = flatten(tree).filter(
        (
          x,
        ): x is {
          type: string;
          props: Record<string, unknown>;
          children: SerializedNode[];
        } =>
          x !== null &&
          "type" in x &&
          (x.props as Record<string, unknown>)["data-slot"] ===
            "contracts-block-header-action",
      );
      expect(slot.length).toBe(0);
    });
  });

  /**
   * F-CONTRATS slice 4/4 (#185) — clickable rows + active state.
   *
   * Each row of the contracts list becomes clickable when the parent wires
   * `onSelectContract`. Clicking a row signals the chosen `contractId` to
   * the parent (so the parent can re-hydrate the `ContractIframe` below
   * the block with that contract's HTML). The currently-selected row gets
   * a distinct visual state (`data-active="true"`) so the operator knows
   * which version is being previewed.
   *
   * Backward compatibility: when `onSelectContract` is omitted, rows stay
   * non-interactive — the slice-1 « V1 read-only » contract still holds
   * (the negative test above still passes — no `<button>` surfaces in the
   * rendered tree).
   */
  describe("clickable rows + active state — F-CONTRATS slice 4/4 (#185)", () => {
    function findRowButtons(tree: SerializedNode) {
      return flatten(tree).filter(
        (
          x,
        ): x is {
          type: string;
          props: Record<string, unknown>;
          children: SerializedNode[];
        } =>
          x !== null &&
          "type" in x &&
          (x.props as Record<string, unknown>)["data-slot"] ===
            "contracts-block-row",
      );
    }

    it("AC — when `onSelectContract` is wired, each row is interactive (rendered as a button-role element, one per contract) — slice-1 « V1 read-only » bypass is OPT-IN", () => {
      const contracts = [
        makeContract({
          _id: "contracts_001" as unknown as Id<"contracts">,
          prestation: "A",
        }),
        makeContract({
          _id: "contracts_002" as unknown as Id<"contracts">,
          prestation: "B",
        }),
      ];
      const tree = serialize(
        ContractsBlock({
          contracts,
          onSelectContract: () => {},
        }),
      );
      const rows = findRowButtons(tree);
      expect(rows.length).toBe(2);
      // Each interactive row exposes a callable onClick handler (Convex
      // mutation will fire from the parent via onSelectContract).
      for (const row of rows) {
        expect(typeof (row.props as { onClick?: unknown }).onClick).toBe(
          "function",
        );
      }
    });

    it("AC — clicking a row calls `onSelectContract` with that row's contractId (loop closed: parent re-hydrates the iframe with the chosen contract)", () => {
      const c1 = makeContract({
        _id: "contracts_aaa" as unknown as Id<"contracts">,
        prestation: "A",
      });
      const c2 = makeContract({
        _id: "contracts_bbb" as unknown as Id<"contracts">,
        prestation: "B",
      });
      const calls: Id<"contracts">[] = [];
      const tree = serialize(
        ContractsBlock({
          contracts: [c1, c2],
          onSelectContract: (id) => calls.push(id),
        }),
      );
      const rows = findRowButtons(tree);
      expect(rows.length).toBe(2);
      // Locate rows by data-contract-id so the test does not depend on
      // render order.
      const rowA = rows.find(
        (r) =>
          (r.props as Record<string, unknown>)["data-contract-id"] ===
          (c1._id as unknown as string),
      );
      const rowB = rows.find(
        (r) =>
          (r.props as Record<string, unknown>)["data-contract-id"] ===
          (c2._id as unknown as string),
      );
      expect(rowA).toBeDefined();
      expect(rowB).toBeDefined();
      const onClickA = (rowA!.props as { onClick: () => void }).onClick;
      const onClickB = (rowB!.props as { onClick: () => void }).onClick;
      onClickA();
      onClickB();
      onClickA();
      expect(calls).toEqual([c1._id, c2._id, c1._id]);
    });

    it('AC — the row whose id matches `selectedContractId` is marked active (data-active="true"), every other row is data-active="false"', () => {
      const c1 = makeContract({
        _id: "contracts_aaa" as unknown as Id<"contracts">,
      });
      const c2 = makeContract({
        _id: "contracts_bbb" as unknown as Id<"contracts">,
      });
      const c3 = makeContract({
        _id: "contracts_ccc" as unknown as Id<"contracts">,
      });
      const tree = serialize(
        ContractsBlock({
          contracts: [c1, c2, c3],
          onSelectContract: () => {},
          selectedContractId: c2._id,
        }),
      );
      const rows = findRowButtons(tree);
      expect(rows.length).toBe(3);
      const activeFlags = rows.map((r) => ({
        id: (r.props as Record<string, unknown>)["data-contract-id"],
        active: (r.props as Record<string, unknown>)["data-active"],
      }));
      expect(activeFlags).toEqual(
        expect.arrayContaining([
          { id: c1._id as unknown as string, active: "false" },
          { id: c2._id as unknown as string, active: "true" },
          { id: c3._id as unknown as string, active: "false" },
        ]),
      );
      // Exactly one row is active at a time — no duplication.
      const activeCount = activeFlags.filter((f) => f.active === "true").length;
      expect(activeCount).toBe(1);
    });

    it('AC — when `selectedContractId` is undefined (nothing selected yet), every row is data-active="false" — the iframe is not driven by the list, no row is highlighted spuriously', () => {
      const c1 = makeContract({
        _id: "contracts_aaa" as unknown as Id<"contracts">,
      });
      const c2 = makeContract({
        _id: "contracts_bbb" as unknown as Id<"contracts">,
      });
      const tree = serialize(
        ContractsBlock({
          contracts: [c1, c2],
          onSelectContract: () => {},
          // selectedContractId omitted
        }),
      );
      const rows = findRowButtons(tree);
      for (const r of rows) {
        expect((r.props as Record<string, unknown>)["data-active"]).toBe(
          "false",
        );
      }
    });

    it("slice-1 contract preserved — when `onSelectContract` is OMITTED, NO `<button>` element is rendered (negative test from slice 1/4 still holds)", () => {
      const contracts = [
        makeContract({ status: "draft" }),
        makeContract({ status: "sent" }),
      ];
      const tree = serialize(ContractsBlock({ contracts }));
      expect(findAllByType(tree, "button").length).toBe(0);
      // The row containers exist but are NOT marked as interactive rows
      // (data-slot="contracts-block-row" is the interactive opt-in
      // marker; in the non-interactive branch, rows render as plain `li`).
      const rows = findRowButtons(tree);
      expect(rows.length).toBe(0);
    });

    it('a11y — the interactive row carries `type="button"` (HTML default for <button> would otherwise be `submit` inside a form, breaking accidental form submits in the future)', () => {
      const c1 = makeContract({
        _id: "contracts_aaa" as unknown as Id<"contracts">,
      });
      const tree = serialize(
        ContractsBlock({
          contracts: [c1],
          onSelectContract: () => {},
        }),
      );
      const rows = findRowButtons(tree);
      expect(rows.length).toBe(1);
      expect((rows[0].props as { type?: unknown }).type).toBe("button");
    });
  });
});
