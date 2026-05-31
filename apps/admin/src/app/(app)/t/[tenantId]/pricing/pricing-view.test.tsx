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
import { describe, expect, it, vi } from "vitest";
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

  describe("F-PRICING-4 (#249) — Active/Inactive toggle wired via `onToggleActive`", () => {
    // Slice 4 (#249) turns the « toggle Active » placeholder from slice 1 into
    // a working Radix `<Switch>` per row. The page owns the wiring via a new
    // `onToggleActive(ruleId, active)` callback that bridges to
    // `api.lib.pricing.rules.setActive`. Hard guardrails from the issue body:
    //   - The toggle calls ONLY `setActive` — never `remove`, never `update`
    //     (un toggle n'est pas un delete déguisé : la définition reste intacte).
    //   - The row visually de-emphasises when `active === false` (already
    //     covered by the slice-1 test « ligne grisée »; we re-pin it here to
    //     show that flipping the toggle is the source of truth that drives it).
    //   - Backward compat : when `onToggleActive` is omitted, the toggle
    //     stays rendered but disabled — same shape as slice 1's placeholder,
    //     no row-mutation risk for callers that haven't wired it yet.
    //
    // We pin the toggle via `data-slot="pricing-rule-active-toggle"` so the
    // page wiring + future e2e affordances have a stable hook.

    function findBySlot(n: SerializedNode, slot: string) {
      return flatten(n).filter((x) => {
        if (x === null || "text" in x) return false;
        return x.props["data-slot"] === slot;
      }) as Array<{
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      }>;
    }

    it("AC — every row exposes a Switch toggle (`data-slot=pricing-rule-active-toggle`)", () => {
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE, FIXED_AMOUNT_RULE],
          onToggleActive: () => {},
        }),
      );
      const toggles = findBySlot(tree, "pricing-rule-active-toggle");
      // 3 rules → 3 toggles, one per row.
      expect(toggles).toHaveLength(3);
    });

    it("AC — toggle `checked` mirrors `rule.active` (active rule → true ; inactive → false)", () => {
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE],
          onToggleActive: () => {},
        }),
      );
      const toggles = findBySlot(tree, "pricing-rule-active-toggle");
      expect(toggles).toHaveLength(2);
      // Match by aria-label which embeds the rule's _id (stable across the
      // render order — same affordance the screen-reader announces).
      const activeToggle = toggles.find(
        (t) =>
          typeof t.props["aria-label"] === "string" &&
          (t.props["aria-label"] as string).includes(String(ACTIVE_RULE._id)),
      );
      const inactiveToggle = toggles.find(
        (t) =>
          typeof t.props["aria-label"] === "string" &&
          (t.props["aria-label"] as string).includes(String(INACTIVE_RULE._id)),
      );
      expect(activeToggle?.props["checked"]).toBe(true);
      expect(inactiveToggle?.props["checked"]).toBe(false);
    });

    it("AC — toggle carries an aria-label (screen-reader announces the rule it controls)", () => {
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE],
          onToggleActive: () => {},
        }),
      );
      const toggles = findBySlot(tree, "pricing-rule-active-toggle");
      for (const t of toggles) {
        const aria = t.props["aria-label"];
        expect(typeof aria).toBe("string");
        // Load-bearing FR phrasing — same shape as the « Disponibilité de
        // <name> » pattern on the menu toggle.
        expect(aria as string).toMatch(/r[èe]gle/i);
      }
    });

    it("AC — `onCheckedChange(next)` fires `onToggleActive(ruleId, next)` exactly once with the FLIPPED value (active → false)", () => {
      const onToggleActive = vi.fn();
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE],
          onToggleActive,
        }),
      );
      const toggles = findBySlot(tree, "pricing-rule-active-toggle");
      const activeToggle = toggles.find(
        (t) =>
          typeof t.props["aria-label"] === "string" &&
          (t.props["aria-label"] as string).includes(String(ACTIVE_RULE._id)),
      );
      expect(activeToggle).toBeDefined();
      const onCheckedChange = activeToggle?.props["onCheckedChange"] as
        | ((next: boolean) => void)
        | undefined;
      expect(typeof onCheckedChange).toBe("function");
      // Radix Switch hands us the NEW (flipped) value — for an active row,
      // the flip means « deactivate », i.e. false.
      onCheckedChange?.(false);
      expect(onToggleActive).toHaveBeenCalledTimes(1);
      expect(onToggleActive).toHaveBeenCalledWith(ACTIVE_RULE._id, false);
    });

    it("AC — inactive row's toggle flips to true → re-activates the rule", () => {
      const onToggleActive = vi.fn();
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE],
          onToggleActive,
        }),
      );
      const toggles = findBySlot(tree, "pricing-rule-active-toggle");
      const inactiveToggle = toggles.find(
        (t) =>
          typeof t.props["aria-label"] === "string" &&
          (t.props["aria-label"] as string).includes(String(INACTIVE_RULE._id)),
      );
      const onCheckedChange = inactiveToggle?.props["onCheckedChange"] as
        | ((next: boolean) => void)
        | undefined;
      onCheckedChange?.(true);
      expect(onToggleActive).toHaveBeenCalledTimes(1);
      expect(onToggleActive).toHaveBeenCalledWith(INACTIVE_RULE._id, true);
    });

    it("AC — toggle is per-row (clicking row 2 fires with row 2's id, NOT row 1's — no shared closure leak)", () => {
      const captured: Array<[unknown, boolean]> = [];
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE, FIXED_AMOUNT_RULE],
          onToggleActive: (ruleId, active) => captured.push([ruleId, active]),
        }),
      );
      const toggles = findBySlot(tree, "pricing-rule-active-toggle");
      expect(toggles).toHaveLength(3);
      // Fire each row's onCheckedChange in turn — the captured calls must
      // match the rule under the row, not a leaked reference to a previous
      // closure value.
      for (const t of toggles) {
        const h = t.props["onCheckedChange"] as
          | ((next: boolean) => void)
          | undefined;
        h?.(false);
      }
      expect(captured).toHaveLength(3);
      expect(captured[0]?.[0]).toBe(ACTIVE_RULE._id);
      expect(captured[1]?.[0]).toBe(INACTIVE_RULE._id);
      expect(captured[2]?.[0]).toBe(FIXED_AMOUNT_RULE._id);
    });

    it("AC — flipping the toggle does NOT mutate the rule object (no in-place rewrite of conditions/action — pas un delete déguisé)", () => {
      // The « pas un delete déguisé » contract: the toggle is the ONLY thing
      // that should change about the rule. We snapshot the rule's conditions
      // + action before serialising, fire the toggle handler, and assert the
      // snapshots are still structurally equal. The page is responsible for
      // persisting via `setActive` (NOT `update` / `remove`) — that ban is
      // pinned on the page source string in `page.test.ts`.
      const beforeConditions = JSON.parse(
        JSON.stringify(ACTIVE_RULE.conditions),
      );
      const beforeAction = JSON.parse(JSON.stringify(ACTIVE_RULE.action));
      const tree = serialize(
        PricingView({ rules: [ACTIVE_RULE], onToggleActive: () => {} }),
      );
      const toggles = findBySlot(tree, "pricing-rule-active-toggle");
      const onCheckedChange = toggles[0]?.props["onCheckedChange"] as
        | ((next: boolean) => void)
        | undefined;
      onCheckedChange?.(false);
      expect(ACTIVE_RULE.conditions).toEqual(beforeConditions);
      expect(ACTIVE_RULE.action).toEqual(beforeAction);
    });

    it("AC — « Inactive » label still rendered when active === false (toggle drives the visual state, slice-1 contract retained)", () => {
      // Slice 1 already pinned « Inactive » label + opacity for inactive
      // rows; slice 4 doesn't break that — we re-pin from the slice-4 vantage
      // point so a future contributor who replaces the label with a toggle-
      // only signal sees the explicit slice-4 reason.
      const tree = serialize(
        PricingView({ rules: [INACTIVE_RULE], onToggleActive: () => {} }),
      );
      const text = allText(tree);
      expect(text).toMatch(/\bInactive\b/);
    });

    it("AC — when `onToggleActive` is OMITTED (F-PRICING-1 isolated caller), the toggle is rendered but `disabled` (backward compat)", () => {
      // Same backward-compat discipline as slice 3's `onEditRule`: the
      // toggle's shape stays identical (test serializer still finds it), but
      // it stays inert so the F-PRICING-1 isolated callers + the « placeholders
      // disabled » test keep passing without supplying a handler.
      const tree = serialize(PricingView({ rules: [ACTIVE_RULE] }));
      const toggles = findBySlot(tree, "pricing-rule-active-toggle");
      expect(toggles).toHaveLength(1);
      expect(toggles[0]?.props["disabled"]).toBe(true);
    });
  });

  describe("F-PRICING-5 (#251) — « Supprimer » becomes active with 2-click confirmation when `onDeleteRule` is wired", () => {
    // Slice 5 (#251) turns the « Supprimer » placeholder from slice 1 into a
    // working 2-click confirmation flow: row button → AlertDialog → « Supprimer »
    // inside the dialog. The page owns the wiring via a new
    // `onDeleteRule(ruleId)` callback that bridges to
    // `api.lib.pricing.rules.remove`. Hard guardrails from the issue body:
    //   - 1-click delete is INTERDIT — the row button must NEVER invoke
    //     `onDeleteRule` directly; only the dialog's « Supprimer » action does.
    //   - « Annuler » in the dialog = no-op (dialog closes, rule stays).
    //   - Backward compat: when `onDeleteRule` is omitted, the « Supprimer »
    //     button stays disabled — same shape as slice 1's placeholder, no
    //     row-mutation risk for callers that haven't wired it yet (already
    //     pinned by the « placeholders disabled » test above; we re-pin it
    //     here from the slice-5 vantage point).
    //
    // The dialog itself is a Radix `<AlertDialog>` which throws inside the
    // serializer's recursive call (no React renderer under `environment:
    // "node"`); the serializer catches and returns an empty placeholder. We
    // therefore pin the contract via two stable hooks the row exposes:
    //   - `data-slot="pricing-rule-delete"` on the row trigger button.
    //   - `data-slot="pricing-rule-delete-confirm"` on the dialog's action
    //     button. We reach into the row's `confirmAction` prop (a verbatim
    //     handler the dialog binds onClick to) via the same flat scan, NOT
    //     by trying to render the radix dialog itself.

    it("AC — when `onDeleteRule` is passed, every row's « Supprimer » button is ENABLED", () => {
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE],
          onDeleteRule: () => {},
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
      const removeBtns = buttons.filter((b) =>
        /^\s*Supprimer\s*$/.test(b.text),
      );
      // 2 rules → 2 « Supprimer » row buttons (the dialog's button is rendered
      // via radix and is unreachable from this serializer — we pin it via the
      // `confirmAction` prop below).
      expect(removeBtns).toHaveLength(2);
      for (const b of removeBtns) {
        expect(
          b.disabled,
          "Supprimer row button must be enabled when onDeleteRule is wired",
        ).toBe(false);
      }
    });

    it("AC — clicking the row « Supprimer » button does NOT call `onDeleteRule` directly (1-click delete INTERDIT — confirmation gate)", () => {
      // Load-bearing safety: a misclick on the row button must NEVER wipe a
      // rule. The row button only opens the dialog; only the dialog's
      // « Supprimer » action fires `onDeleteRule`. We mirror the
      // `category-list-editor.test.tsx` AC3 pattern: fire EVERY row delete
      // button's onClick and assert the callback was NOT invoked.
      const onDeleteRule = vi.fn();
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE],
          onDeleteRule,
        }),
      );
      const rowDeleteBtns = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "pricing-rule-delete";
      }) as Array<{
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      }>;
      expect(rowDeleteBtns).toHaveLength(2);
      for (const btn of rowDeleteBtns) {
        const onClick = btn.props["onClick"] as (() => void) | undefined;
        if (typeof onClick === "function") onClick();
      }
      expect(onDeleteRule).not.toHaveBeenCalled();
    });

    it("AC — dialog « Supprimer » action calls `onDeleteRule(ruleId)` with THIS row's id (per-row binding, no shared closure leak)", () => {
      const captured: unknown[] = [];
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE, FIXED_AMOUNT_RULE],
          onDeleteRule: (ruleId) => captured.push(ruleId),
        }),
      );
      // The confirm-action carries `data-slot="pricing-rule-delete-confirm"`.
      // We reach into its `onClick` via the flat scan (it's rendered inside
      // the radix AlertDialogAction shell, but the data-slot is on the
      // element itself).
      const confirmBtns = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "pricing-rule-delete-confirm";
      }) as Array<{
        type: string;
        props: Record<string, unknown>;
        children: SerializedNode[];
      }>;
      // 3 rules → 3 dialog confirm actions (one per row's dialog).
      expect(confirmBtns).toHaveLength(3);
      // Fire each row's confirm onClick in turn — the captured calls must
      // match the rule under the row, not a leaked closure value.
      for (const btn of confirmBtns) {
        const onClick = btn.props["onClick"] as (() => void) | undefined;
        onClick?.();
      }
      expect(captured).toHaveLength(3);
      expect(captured[0]).toBe(ACTIVE_RULE._id);
      expect(captured[1]).toBe(INACTIVE_RULE._id);
      expect(captured[2]).toBe(FIXED_AMOUNT_RULE._id);
    });

    it("AC — when `onDeleteRule` is OMITTED (F-PRICING-1 isolated caller), « Supprimer » stays disabled (backward compat)", () => {
      // The existing « placeholders disabled » test above already pins this
      // implicitly. We re-pin it from the slice-5 vantage point so a future
      // contributor who tries to drop the disabled-when-omitted fallback
      // sees the explicit slice-5 reason.
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
      const removeBtn = buttons.find((b) => /^\s*Supprimer\s*$/.test(b.text));
      expect(removeBtn?.disabled).toBe(true);
      // And the confirm action must NOT exist when no handler is wired (no
      // dialog is rendered for a disabled row — same shape as the slice-3 /
      // slice-4 « no handler → inert » contract).
      const confirmBtns = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "pricing-rule-delete-confirm";
      });
      expect(confirmBtns).toHaveLength(0);
    });

    it("AC — row delete button carries an aria-label (screen-reader announces the rule it deletes)", () => {
      const tree = serialize(
        PricingView({
          rules: [ACTIVE_RULE, INACTIVE_RULE],
          onDeleteRule: () => {},
        }),
      );
      const rowDeleteBtns = flatten(tree).filter((n) => {
        if (n === null || "text" in n) return false;
        return n.props["data-slot"] === "pricing-rule-delete";
      }) as Array<{ props: Record<string, unknown> }>;
      expect(rowDeleteBtns).toHaveLength(2);
      for (const b of rowDeleteBtns) {
        const aria = b.props["aria-label"];
        expect(typeof aria).toBe("string");
        expect(aria as string).toMatch(/supprimer/i);
        expect(aria as string).toMatch(/r[èe]gle/i);
      }
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
