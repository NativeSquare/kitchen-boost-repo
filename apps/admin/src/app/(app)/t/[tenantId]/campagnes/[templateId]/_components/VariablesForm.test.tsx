/**
 * F-CAMPAGNES [3/7] (#205) — `VariablesForm`, the dynamic per-template form
 * (parent EPIC #145).
 *
 * Issue body verbatim: « `VariablesForm` génère les bons champs pour ≥2
 * templates V1 distincts (one cas par variante représentative) » + « valide
 * `{discount} ≤ 50 %`, refuse alcool, refuse longueur excessive » + « Bouton
 * « Envoyer maintenant » présent mais désactivé ».
 *
 * Pinned via the same pure React-tree-serializer pattern as the rest of the
 * campagnes folder — vitest runs in `environment: "node"` (no jsdom, no
 * RTL). We walk the React tree and assert text + structural shape (fields
 * present, button disabled).
 *
 * Acceptance criteria covered (#205):
 *   - AC2 « formulaire généré contient exactement les champs requis par le
 *     template sélectionné (pas de champs inutiles) » — assert one input
 *     surface per declared variable, NO input for variables not declared.
 *   - AC3 « Slider `{discount}` capé à 50 % » — slider has `max=50`.
 *   - AC4 « Time pickers HH:MM pour `{heure_debut}`, `{heure_fin}` » —
 *     `<input type="time">` surface.
 *   - AC5 « Inputs texte refusent les violations FR (alcool) et longueur
 *     excessive » — the validation module owns the rules; here we pin that
 *     the form THREADS those errors visibly when an invalid value is set
 *     (controlled props branch). The rule-set itself is pinned in
 *     `variables-form-validation.test.ts`.
 *   - AC6 « Bouton « Envoyer maintenant » présent mais désactivé » — the
 *     submit button surfaces with the FR « Envoyer maintenant » label AND
 *     is disabled (slice [4/7] activates it).
 *   - AC8 « FR uniquement » — no English fallback.
 *
 * MOAT / cross-tenant fuzz: this is a presentational form — no query, no
 * mutation, no recipient identity. Isolation owned upstream.
 */
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";

import type { TenantTemplateSummary } from "@packages/backend/convex/lib/notifications/campaigns";
import type { Id } from "@packages/backend/convex/_generated/dataModel";

import { VariablesFormView } from "./VariablesForm";

// ---------------------------------------------------------------------------
// React-tree serializer (same shape as `TemplateCard.test.tsx` /
// `TemplatePicker.test.tsx`).
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
    // Shadcn primitives + radix Slider/Slot are forwardRefs that use hooks
    // internally — invoking `.render()` outside a real React render throws.
    // We treat any forwardRef element as opaque by surface — preserve its
    // props (so `data-slot`, `max`, `type`, `disabled` are visible to
    // assertions) and recurse into its declared `children`.
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
      // Use a synthetic "ForwardRef" type tag carrying the displayName when
      // available; we don't rely on the tag for the assertions (we filter on
      // `data-slot` / `type` / `max` instead, which travel via props).
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

function findAll(
  n: SerializedNode,
  predicate: (s: SerializedNode) => boolean,
): SerializedNode[] {
  return flatten(n).filter(predicate);
}

// ---------------------------------------------------------------------------
// Fixtures — TWO representative V1 template variants (issue body AC):
//   - `welcome_back` uses { prenom_client, nom_resto } (text-only).
//   - `weekend_promo` uses { discount, item_hero, heure_debut, heure_fin, jour }
//     (the discount slider + time pickers + text inputs variant).
// ---------------------------------------------------------------------------
const TENANT_ID = "tenant_abc" as Id<"tenants">;

const TEMPLATE_TEXT_ONLY: TenantTemplateSummary = {
  id: "tpl_welcome_back" as Id<"notificationTemplates">,
  key: "welcome_back",
  label: "Bienvenue de retour",
  body: "Salut {prenom_client}, on est ravis de te revoir chez {nom_resto} !",
  variables: ["prenom_client", "nom_resto"],
  deepLinkTarget: "catalogue",
  language: "fr",
  maxDiscountPercent: 0,
  containsAlcohol: false,
};

const TEMPLATE_MIXED: TenantTemplateSummary = {
  id: "tpl_weekend_promo" as Id<"notificationTemplates">,
  key: "weekend_promo",
  label: "Promo weekend",
  body: "Ce {jour}, -{discount}% sur {item_hero} de {heure_debut} à {heure_fin} !",
  variables: ["jour", "discount", "item_hero", "heure_debut", "heure_fin"],
  deepLinkTarget: "catalogue",
  language: "fr",
  maxDiscountPercent: 30,
  containsAlcohol: false,
};

/**
 * Tiny no-op onChange — the node-env tests do not simulate events; the
 * tests assert the controlled-prop branch (the view paints from `values`).
 * Wiring the real shell `useState` is the production path.
 */
const NOOP = () => {};

// ---------------------------------------------------------------------------
// Tests — field generation per template
// ---------------------------------------------------------------------------
describe("VariablesForm — AC2 dynamic field generation per template", () => {
  it("text-only template surfaces ONLY the declared text variables (no slider, no time picker)", () => {
    const tree = serialize(
      <VariablesFormView
        tenantId={TENANT_ID}
        template={TEMPLATE_TEXT_ONLY}
        values={{}}
        onChange={NOOP}
      />,
    );
    const text = allText(tree);

    // Each declared variable label surfaces (we test the labels — the
    // human-readable copy — not the internal `name` string).
    expect(text).toMatch(/Prénom (du )?client/i);
    expect(text).toMatch(/Nom (du )?(resto|restaurant)/i);

    // No undeclared variable leaks (defensive — pin the "exactement les
    // champs requis" contract). `{discount}` would otherwise show its
    // « réduction » label; `{heure_debut}` would show a time label.
    expect(text).not.toMatch(/réduction/i);
    expect(text).not.toMatch(/Heure (de )?début/i);
    expect(text).not.toMatch(/Heure (de )?fin/i);

    // No slider surface (`data-slot="slider"`) in a text-only template.
    const sliders = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "slider";
    });
    expect(sliders).toHaveLength(0);

    // No time input.
    const timeInputs = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["type"] === "time";
    });
    expect(timeInputs).toHaveLength(0);
  });

  it("mixed template surfaces the discount slider, the time pickers, and the text inputs declared", () => {
    const tree = serialize(
      <VariablesFormView
        tenantId={TENANT_ID}
        template={TEMPLATE_MIXED}
        values={{}}
        onChange={NOOP}
      />,
    );
    const text = allText(tree);

    // Labels for every declared variable.
    expect(text).toMatch(/réduction/i); // discount label
    expect(text).toMatch(/Heure (de )?début/i);
    expect(text).toMatch(/Heure (de )?fin/i);
    expect(text).toMatch(/Plat (vedette|phare)|Item phare|item_hero|Plat mis/i); // item_hero label
    expect(text).toMatch(/Jour/i);

    // No leak of an undeclared variable (mixed template does NOT declare
    // prenom_client or nom_resto).
    expect(text).not.toMatch(/Prénom (du )?client/i);
    expect(text).not.toMatch(/Nom (du )?(resto|restaurant)/i);
    expect(text).not.toMatch(/Nom (du )?plat\b/i); // nom_plat NOT declared

    // EXACTLY ONE slider surface for `{discount}`.
    const sliders = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "slider";
    });
    expect(sliders).toHaveLength(1);

    // EXACTLY TWO time inputs (heure_debut + heure_fin).
    const timeInputs = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["type"] === "time";
    });
    expect(timeInputs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests — AC3 slider cap at 50
// ---------------------------------------------------------------------------
describe("VariablesForm — AC3 discount slider capped at 50 %", () => {
  it("`{discount}` slider declares max=50 (cap hardcoded, ADR 0006)", () => {
    const tree = serialize(
      <VariablesFormView
        tenantId={TENANT_ID}
        template={TEMPLATE_MIXED}
        values={{}}
        onChange={NOOP}
      />,
    );
    const sliders = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "slider";
    });
    expect(sliders).toHaveLength(1);
    const slider = sliders[0] as {
      props: Record<string, unknown>;
    };
    // `max` MUST equal 50 — the cap can never be raised at the widget
    // level. Mirrors `MAX_DISCOUNT_PERCENT` (exported from the backend
    // notifications module, single source of truth).
    expect(slider.props["max"]).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Tests — AC4 time picker HH:MM
// ---------------------------------------------------------------------------
describe("VariablesForm — AC4 time pickers HH:MM", () => {
  it('`{heure_debut}` and `{heure_fin}` surface as <input type="time">', () => {
    const tree = serialize(
      <VariablesFormView
        tenantId={TENANT_ID}
        template={TEMPLATE_MIXED}
        values={{}}
        onChange={NOOP}
      />,
    );
    const timeInputs = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["type"] === "time";
    });
    expect(timeInputs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests — AC5 validation threading (errors shown on bad controlled values)
// ---------------------------------------------------------------------------
describe("VariablesForm — AC5 validation errors surface on bad controlled values", () => {
  it("surfaces an alcohol violation message when a text input value contains a forbidden word", () => {
    const tree = serialize(
      <VariablesFormView
        tenantId={TENANT_ID}
        template={TEMPLATE_TEXT_ONLY}
        values={{ prenom_client: "Marie", nom_resto: "Bar du Vin" }}
        onChange={NOOP}
      />,
    );
    const text = allText(tree);
    // The exact copy is owned by the component; we pin the load-bearing
    // FR word « alcool » so a typographic polish stays free.
    expect(text).toMatch(/alcool/i);
  });

  it("surfaces a length violation message when a text input is too long", () => {
    const tooLong = "x".repeat(1000);
    const tree = serialize(
      <VariablesFormView
        tenantId={TENANT_ID}
        template={TEMPLATE_TEXT_ONLY}
        values={{ prenom_client: tooLong, nom_resto: "Chez Marie" }}
        onChange={NOOP}
      />,
    );
    const text = allText(tree);
    expect(text).toMatch(/trop long/i);
  });

  it("does NOT surface error copy when every value is valid", () => {
    const tree = serialize(
      <VariablesFormView
        tenantId={TENANT_ID}
        template={TEMPLATE_TEXT_ONLY}
        values={{ prenom_client: "Marie", nom_resto: "Chez Marie" }}
        onChange={NOOP}
      />,
    );
    const text = allText(tree);
    expect(text).not.toMatch(/alcool/i);
    expect(text).not.toMatch(/trop long/i);
  });
});

// ---------------------------------------------------------------------------
// Tests — AC6 submit button disabled
// ---------------------------------------------------------------------------
describe("VariablesForm — AC6 « Envoyer maintenant » button is present but disabled (slice [4/7] activates it)", () => {
  it("surfaces the « Envoyer maintenant » button label", () => {
    const tree = serialize(
      <VariablesFormView
        tenantId={TENANT_ID}
        template={TEMPLATE_TEXT_ONLY}
        values={{}}
        onChange={NOOP}
      />,
    );
    const text = allText(tree);
    expect(text).toMatch(/Envoyer maintenant/);
  });

  it("the button is rendered as disabled (slice [4/7] flips it once send wiring lands)", () => {
    const tree = serialize(
      <VariablesFormView
        tenantId={TENANT_ID}
        template={TEMPLATE_TEXT_ONLY}
        values={{}}
        onChange={NOOP}
      />,
    );
    // Find the button — `data-slot="button"` is the shadcn marker.
    const buttons = findAll(tree, (n) => {
      if (n === null || "text" in n) return false;
      return (n.props as Record<string, unknown>)["data-slot"] === "button";
    });
    // Exactly one button on the form for the V1 surface.
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    const submit = buttons[0] as { props: Record<string, unknown> };
    expect(submit.props["disabled"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tests — AC8 FR-only
// ---------------------------------------------------------------------------
describe("VariablesForm — AC8 FR-only", () => {
  it("no English fallback across the field labels and the submit button", () => {
    const branches = [
      allText(
        serialize(
          <VariablesFormView
            tenantId={TENANT_ID}
            template={TEMPLATE_TEXT_ONLY}
            values={{}}
            onChange={NOOP}
          />,
        ),
      ),
      allText(
        serialize(
          <VariablesFormView
            tenantId={TENANT_ID}
            template={TEMPLATE_MIXED}
            values={{}}
            onChange={NOOP}
          />,
        ),
      ),
    ];
    for (const text of branches) {
      expect(text).not.toMatch(/\bSubmit\b/);
      expect(text).not.toMatch(/\bSend now\b/i);
      expect(text).not.toMatch(/\bDiscount\b/);
      expect(text).not.toMatch(/\bStart time\b/i);
      expect(text).not.toMatch(/\bEnd time\b/i);
      expect(text).not.toMatch(/\bRestaurant name\b/i);
    }
  });
});
