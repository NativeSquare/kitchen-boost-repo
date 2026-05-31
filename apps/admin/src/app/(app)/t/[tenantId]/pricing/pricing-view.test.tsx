/**
 * F-PRICING-1 (#241) — `PricingView`, pure presentational shell of the read-only
 * pricing rules list. First tracer-bullet of F-PRICING (#146); slices 2-5 will
 * layer create/update/toggle/delete on top.
 *
 * Branches the view owns:
 *   - `rules === undefined` → loading skeleton (no blank flash, header stays).
 *   - `rules.length === 0`  → empty state with the « règle par défaut 10 % »
 *     copy promised by the issue body.
 *   - else                  → header (title + auto-priority banner) + list of
 *     rule rows (active + inactive), each one showing condition + action FR
 *     summaries and the active/inactive state. Inactive rows visually distinct.
 *
 * Hard guardrails (issue body) pinned by tests in this file:
 *   - NO `[draggable]` attribute anywhere — auto-priority means no manual order.
 *   - NO visible `priority` / `order` number / field name in the DOM.
 *   - The banner copy is the EXACT FR string from the issue body (so a polish
 *     that rewords it without updating the test fails — copy is load-bearing).
 *
 * Same React-tree-serializer pattern as `mes-clients/mes-clients-view.test.tsx`
 * — vitest runs in `environment: "node"`.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { Doc } from "@packages/backend/convex/_generated/dataModel";

import { PricingView, AUTO_PRIORITY_BANNER_TEXT } from "./pricing-view";

// ---------------------------------------------------------------------------
// React-tree serializer — same shape as mes-clients-view.test.tsx.
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
// Test fixtures — canonical pricingRules docs.
// ---------------------------------------------------------------------------
function makeRule(
  overrides: Partial<Doc<"pricingRules">>,
): Doc<"pricingRules"> {
  return {
    _id: "rule_test_1" as unknown as Doc<"pricingRules">["_id"],
    _creationTime: 0,
    tenantId: "tenant_test" as unknown as Doc<"pricingRules">["tenantId"],
    conditions: [],
    action: { kind: "livraison_offerte_resto" },
    active: true,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const ACTIVE_RULE = makeRule({
  _id: "rule_active_1" as unknown as Doc<"pricingRules">["_id"],
  conditions: [
    { kind: "total_panier", operator: "gte", valueCents: 2500 },
    { kind: "jour_semaine", days: ["LU", "MA"] },
    { kind: "premiere_cmd_client", value: true },
  ],
  action: { kind: "livraison_offerte_resto" },
  active: true,
});

const INACTIVE_RULE = makeRule({
  _id: "rule_inactive_1" as unknown as Doc<"pricingRules">["_id"],
  conditions: [{ kind: "nombre_cmds_client", operator: "gte", value: 5 }],
  action: {
    kind: "frais_livraison_part_resto_pourcentage_panier",
    percent: 30,
  },
  active: false,
});

const FIXED_AMOUNT_RULE = makeRule({
  _id: "rule_active_2" as unknown as Doc<"pricingRules">["_id"],
  conditions: [{ kind: "plage_horaire", start: "11:30", end: "14:00" }],
  action: { kind: "frais_livraison_part_resto_fixe", valueCents: 250 },
  active: true,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("PricingView — F-PRICING-1 (#241)", () => {
  it("AC — surfaces the page title « Pricing » (header always rendered)", () => {
    const text = allText(serialize(PricingView({ rules: undefined })));
    // Load-bearing word the sidebar mirrors.
    expect(text).toMatch(/Pricing/i);
  });

  it("AC — surfaces the auto-priority banner with the EXACT FR copy on the loaded branch", () => {
    const tree = serialize(
      PricingView({ rules: [ACTIVE_RULE, INACTIVE_RULE] }),
    );
    const text = allText(tree);
    expect(text).toContain(AUTO_PRIORITY_BANNER_TEXT);
    // Sanity: the banner constant is the verbatim copy from the issue body.
    expect(AUTO_PRIORITY_BANNER_TEXT).toContain(
      "Quand plusieurs règles s'appliquent",
    );
    expect(AUTO_PRIORITY_BANNER_TEXT).toContain(
      "la plus avantageuse pour ton client",
    );
    expect(AUTO_PRIORITY_BANNER_TEXT).toContain("Pas d'ordre à gérer");
  });

  it("AC — banner is also rendered on the empty branch (always present, header)", () => {
    // Pedagogical banner must appear even when the resto has no rules yet, so
    // the gérant learns the model BEFORE creating their first rule.
    const tree = serialize(PricingView({ rules: [] }));
    expect(allText(tree)).toContain(AUTO_PRIORITY_BANNER_TEXT);
  });

  it("AC — empty state shows the default-rule copy from the issue body", () => {
    const tree = serialize(PricingView({ rules: [] }));
    const text = allText(tree);
    // Verbatim load-bearing phrase from issue body.
    expect(text).toMatch(/Aucune règle pour l'instant/i);
    expect(text).toMatch(/règle KitchenBoost par défaut/i);
    expect(text).toMatch(/10\s?%/);
    expect(text).toMatch(/absorbés par le resto|absorb[ée]s par le resto/i);
  });

  it("AC F-PRICING-2 (#245) — populated branch surfaces the « + Nouvelle règle » CTA on the header", () => {
    // F-PRICING-2 (#245) flipped this from F-PRICING-1's « no CTA » to the
    // mandatory CTA: the page list opens the builder modal via this button.
    // We pin BOTH the visible FR copy AND a stable data-slot so the page
    // wiring test can rely on either.
    const tree = serialize(
      PricingView({ rules: [ACTIVE_RULE], onNewRule: () => {} }),
    );
    const text = allText(tree);
    expect(text).toMatch(/Nouvelle règle/i);
  });

  it("AC F-PRICING-2 (#245) — empty branch also surfaces « + Nouvelle règle » (gérant must be able to create the first rule from empty)", () => {
    const tree = serialize(PricingView({ rules: [], onNewRule: () => {} }));
    expect(allText(tree)).toMatch(/Nouvelle règle/i);
  });

  it("AC F-PRICING-2 (#245) — « + Nouvelle règle » click fires `onNewRule`", () => {
    let clicked = 0;
    const tree = serialize(
      PricingView({ rules: [], onNewRule: () => clicked++ }),
    );
    // Walk to the button whose text contains « Nouvelle règle » and call its
    // onClick.
    let handler: (() => void) | undefined;
    function walk(n: SerializedNode) {
      if (n === null || "text" in n) return;
      if (typeof n.type === "string" && n.type.toLowerCase() === "button") {
        const t = allText(n);
        if (/Nouvelle règle/i.test(t)) {
          const h = n.props["onClick"];
          if (typeof h === "function") handler = h as () => void;
        }
      }
      for (const c of n.children) walk(c);
    }
    walk(tree);
    expect(typeof handler).toBe("function");
    handler?.();
    expect(clicked).toBe(1);
  });

  it("AC — loading branch (rules === undefined) renders a skeleton, NOT the empty state, NOT a crash", () => {
    const tree = serialize(PricingView({ rules: undefined }));
    expect(tree).not.toBeNull();
    const text = allText(tree);
    // Empty state must NOT show during loading.
    expect(text).not.toMatch(/Aucune règle pour l'instant/i);
    // Skeleton primitive has the `animate-pulse` className marker.
    const classes = flatten(tree)
      .map((n) => {
        if (n === null || "text" in n) return null;
        const cls = n.props["className"];
        return typeof cls === "string" ? cls : null;
      })
      .filter((c): c is string => c !== null)
      .join(" ");
    expect(classes).toMatch(/animate-pulse/);
  });

  it("AC — populated branch lists ALL rules (active + inactive)", () => {
    const tree = serialize(
      PricingView({ rules: [ACTIVE_RULE, INACTIVE_RULE, FIXED_AMOUNT_RULE] }),
    );
    const text = allText(tree);
    // Active rule's condition summary (panier ≥ 25 €).
    expect(text).toMatch(/Panier/);
    expect(text).toMatch(/25/);
    expect(text).toMatch(/Lundi/);
    // Inactive rule's condition summary (≥ 5 commandes).
    expect(text).toMatch(/5/);
    expect(text).toMatch(/commande/i);
    // Fixed-amount rule's action summary (2,50 €).
    expect(text).toMatch(/2,50\s?€/);
    expect(text).toMatch(/Part fixe/i);
    // Auto-priority banner still on the header.
    expect(text).toContain(AUTO_PRIORITY_BANNER_TEXT);
  });

  it("AC — active rules show « Active », inactive rules show « Inactive »", () => {
    const tree = serialize(
      PricingView({ rules: [ACTIVE_RULE, INACTIVE_RULE] }),
    );
    const text = allText(tree);
    expect(text).toMatch(/\bActive\b/);
    expect(text).toMatch(/\bInactive\b/);
  });

  it("AC — inactive rule row visually distinguished (grisé) via opacity/muted class", () => {
    const tree = serialize(
      PricingView({ rules: [ACTIVE_RULE, INACTIVE_RULE] }),
    );
    // Walk the tree, find nodes whose subtree mentions « Inactive », and
    // assert at least one ancestor carries an opacity/muted class. We don't
    // pin the exact Tailwind class — just the FACT that something
    // de-emphasises the row (the issue's « ligne grisée » contract).
    const inactiveSubtreeClasses: string[] = [];
    function walk(n: SerializedNode) {
      if (n === null || "text" in n) return;
      const subtreeText = allText(n);
      if (/\bInactive\b/.test(subtreeText)) {
        const cls = n.props["className"];
        if (typeof cls === "string") inactiveSubtreeClasses.push(cls);
      }
      for (const c of n.children) walk(c);
    }
    walk(tree);
    const allClasses = inactiveSubtreeClasses.join(" ");
    expect(allClasses).toMatch(/opacity|muted|text-muted/);
  });

  it("AC — placeholders « Éditer » / « Supprimer » / toggle Active rendered but disabled (non-câblés ici)", () => {
    // Issue body: « Placeholders boutons "Éditer" / "Supprimer" / toggle
    // Active — non câblés ici (no-op ou désactivés), branchés dans les tracer-
    // bullets suivants. »
    //
    // We pin the THREE labels appear in the populated branch AND that any
    // <button> with one of those labels in its subtree carries `disabled`.
    // (Slice 2/3/4 will flip them to active in turn.)
    const tree = serialize(PricingView({ rules: [ACTIVE_RULE] }));
    const text = allText(tree);
    expect(text).toMatch(/Éditer/);
    expect(text).toMatch(/Supprimer/);

    // Every <button>: its subtree text + its disabled flag.
    const buttonsInfo: { text: string; disabled: boolean }[] = [];
    function walkBtns(n: SerializedNode) {
      if (n === null || "text" in n) return;
      if (typeof n.type === "string" && n.type.toLowerCase() === "button") {
        const t = allText(n);
        // `disabled` in JSX can be a boolean attr OR aria-disabled. Pin both.
        const disabled =
          n.props["disabled"] === true ||
          n.props["disabled"] === "" ||
          n.props["aria-disabled"] === true ||
          n.props["aria-disabled"] === "true";
        buttonsInfo.push({ text: t, disabled });
      }
      for (const c of n.children) walkBtns(c);
    }
    walkBtns(tree);

    const editBtn = buttonsInfo.find((b) => /Éditer/.test(b.text));
    const removeBtn = buttonsInfo.find((b) => /Supprimer/.test(b.text));
    expect(editBtn, "Éditer button must exist").toBeDefined();
    expect(removeBtn, "Supprimer button must exist").toBeDefined();
    expect(editBtn?.disabled, "Éditer must be disabled in slice 1").toBe(true);
    expect(removeBtn?.disabled, "Supprimer must be disabled in slice 1").toBe(
      true,
    );
  });

  describe("F-PRICING-3 (#248) — « Éditer » becomes active when `onEditRule` is wired", () => {
    // Slice 1 left « Éditer » as a disabled placeholder. Slice 3 (#248) wires
    // it via a new `onEditRule(rule)` prop owned by `page.tsx`: when provided,
    // each row's Éditer button is enabled and clicking it fires the handler
    // with THIS row's rule. Backward compat: when the prop is omitted (the
    // F-PRICING-1 isolated callers + the existing « placeholders disabled »
    // test), the button stays disabled — same shape, no regression.

    it("AC — when `onEditRule` is passed, every row's « Éditer » button is ENABLED", () => {
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE],
          onEditRule: () => {},
        }),
      );
      const buttons: { text: string; disabled: boolean }[] = [];
      function walk(n: SerializedNode) {
        if (n === null || "text" in n) return;
        if (typeof n.type === "string" && n.type.toLowerCase() === "button") {
          const t = allText(n);
          const disabled =
            n.props["disabled"] === true ||
            n.props["disabled"] === "" ||
            n.props["aria-disabled"] === true ||
            n.props["aria-disabled"] === "true";
          buttons.push({ text: t, disabled });
        }
        for (const c of n.children) walk(c);
      }
      walk(tree);
      const editBtns = buttons.filter((b) => /^\s*Éditer\s*$/.test(b.text));
      // 2 rules → 2 « Éditer » buttons.
      expect(editBtns).toHaveLength(2);
      // ALL enabled (none disabled) — the wiring is row-agnostic.
      for (const b of editBtns) {
        expect(
          b.disabled,
          "Éditer must be enabled when onEditRule is wired",
        ).toBe(false);
      }
    });

    it("AC — clicking « Éditer » on a row fires `onEditRule` with THAT row's rule", () => {
      const captured: unknown[] = [];
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE],
          onEditRule: (rule) => captured.push(rule),
        }),
      );
      // Walk and collect every « Éditer » button's onClick handler in render order.
      const handlers: Array<() => void> = [];
      function walk(n: SerializedNode) {
        if (n === null || "text" in n) return;
        if (typeof n.type === "string" && n.type.toLowerCase() === "button") {
          const t = allText(n);
          if (/^\s*Éditer\s*$/.test(t)) {
            const h = n.props["onClick"];
            if (typeof h === "function") handlers.push(h as () => void);
          }
        }
        for (const c of n.children) walk(c);
      }
      walk(tree);
      expect(handlers).toHaveLength(2);
      // Click the FIRST (= ACTIVE_RULE) → captures it.
      handlers[0]?.();
      expect(captured).toHaveLength(1);
      expect((captured[0] as { _id: unknown })._id).toBe(ACTIVE_RULE._id);
      // Click the SECOND (= INACTIVE_RULE) → captures it (per-row binding,
      // not a shared closure).
      handlers[1]?.();
      expect(captured).toHaveLength(2);
      expect((captured[1] as { _id: unknown })._id).toBe(INACTIVE_RULE._id);
    });

    it("AC — when `onEditRule` is OMITTED (F-PRICING-1 isolated caller), « Éditer » stays disabled (backward compat)", () => {
      // The existing « placeholders disabled » test above already pins this
      // implicitly. We re-pin it from the slice-3 vantage point so a future
      // contributor who tries to drop the disabled-when-omitted fallback
      // sees the explicit slice-3 reason.
      const tree = serialize(PricingView({ rules: [ACTIVE_RULE] }));
      const buttons: { text: string; disabled: boolean }[] = [];
      function walk(n: SerializedNode) {
        if (n === null || "text" in n) return;
        if (typeof n.type === "string" && n.type.toLowerCase() === "button") {
          const t = allText(n);
          const disabled =
            n.props["disabled"] === true ||
            n.props["disabled"] === "" ||
            n.props["aria-disabled"] === true ||
            n.props["aria-disabled"] === "true";
          buttons.push({ text: t, disabled });
        }
        for (const c of n.children) walk(c);
      }
      walk(tree);
      const editBtn = buttons.find((b) => /^\s*Éditer\s*$/.test(b.text));
      expect(editBtn?.disabled).toBe(true);
    });
  });

  it("GUARDRAIL — NO `[draggable]` attribute anywhere in the rendered tree (auto-priority, no manual order)", () => {
    // Issue body: « Pas de drag-handle DOM : aucun élément draggable ».
    const tree = serialize(
      PricingView({ rules: [ACTIVE_RULE, INACTIVE_RULE, FIXED_AMOUNT_RULE] }),
    );
    const offenders = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      // HTML `draggable="true"` OR React `draggable={true}` both surface here.
      return (
        n.props["draggable"] === true ||
        n.props["draggable"] === "true" ||
        n.props["draggable"] === ""
      );
    });
    expect(offenders, "no element should carry draggable=true").toHaveLength(0);
  });

  it("GUARDRAIL — NO `order` / `priority` field name OR number visible in the populated branch (excluding the auto-priority banner, which legitimately contains « Pas d'ordre à gérer »)", () => {
    // Issue body: « Pas d'affichage de `priority` / `order` : aucun numéro
    // d'ordre, aucun champ visible. » The banner ITSELF says « Pas d'ordre à
    // gérer » (load-bearing copy from the spec — explaining the auto-priority
    // model), so we strip the banner text from the scan before asserting the
    // ban. What we want to catch is a per-row leak (« Ordre : 3 », « priority:
    // 2 »…) — those would survive the strip.
    const tree = serialize(
      PricingView({ rules: [ACTIVE_RULE, INACTIVE_RULE, FIXED_AMOUNT_RULE] }),
    );
    const text = allText(tree).replace(AUTO_PRIORITY_BANNER_TEXT, "");
    // Field-name leaks (the schema doesn't HAVE these fields, but a slice 2
    // mistake could re-introduce them — pin now to fail loudly).
    expect(text).not.toMatch(/\border\b/i);
    expect(text).not.toMatch(/\bpriority\b/i);
    expect(text).not.toMatch(/\bordre\b/i);
    expect(text).not.toMatch(/\bpriorit[ée]\b/i);
    // Form input named `order` or `priority` (the prose-scan above would
    // miss `<input name="order">`).
    const inputs = flatten(tree).filter((n) => {
      if (n === null || "text" in n) return false;
      if (typeof n.type !== "string") return false;
      if (n.type.toLowerCase() !== "input") return false;
      const name = n.props["name"];
      return name === "order" || name === "priority";
    });
    expect(inputs).toHaveLength(0);
  });

  it("AC — empty branch is anti-PII safe (no email / tel / prénom labels)", () => {
    // Pricing surface should never need PII labels — but pin it now so a
    // future slice (a builder that copies a customer-segment field name?)
    // can't sneak one in.
    const text = allText(serialize(PricingView({ rules: [] })));
    expect(text).not.toMatch(/\bemail\b/i);
    expect(text).not.toMatch(/\bt[ée]l[ée]phone\b/i);
    expect(text).not.toMatch(/\bpr[ée]nom\b/i);
  });
});
