/**
 * F-WIZARD [10/10] (#274) — `Step8ActivationForm` test matrix.
 *
 * Pure presentational form for Step 8 of the provisioning wizard (activation
 * du tenant `pending → active` + confirmation à 2 étapes destructive). The
 * Convex wiring (`tenant.activate` mutation + the seed reads for the récap
 * blocks + the post-success navigation) is owned by the `Step8Form` wrapper
 * in `step-forms.tsx`; this pure component receives the already-resolved
 * `recap` data + `slug` + `onActivate` / `isActivating` / `activateError` +
 * `menuPublished` and renders the récap + the « Mettre en production » button
 * + the 2-step confirmation dialog (slug typing) + the « menu non publié »
 * disabled-state path.
 *
 * Acceptance criteria covered (issue #274):
 *   - Form renders the 6 récap blocks (compte resto, domaine, Stripe,
 *     branding, menu, invitation).
 *   - « Mettre en production » button is rendered, visible, and triggers the
 *     dialog (NOT the activation directly — 2-step UX).
 *   - Dialog asks the operator to TYPE THE SLUG to confirm. Until the typed
 *     value === the slug, the « Activer définitivement » button stays
 *     DISABLED.
 *   - When the typed slug matches, clicking « Activer définitivement » calls
 *     `onActivate()`.
 *   - When `menuPublished === false`, the « Mettre en production » button is
 *     DISABLED + a warning is rendered with a « Retour step 5 » action.
 *   - When `activateError !== null`, the message is surfaced inline (the
 *     wrapper also fires a toast).
 *   - When `isActivating === true`, the activation button (inside the dialog)
 *     is disabled.
 *   - Scope discipline: the form module does NOT import from `apps/web` /
 *     `apps/native` and does NOT call backend directly.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

// ---------------------------------------------------------------------------
// React hooks shim — same lean shim as the sibling Step{N}Form tests.
// ---------------------------------------------------------------------------
vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const v =
        typeof initial === "function" ? (initial as () => T)() : initial;
      return [v, () => {}];
    },
    useEffect: () => {},
    useMemo: <T,>(factory: () => T) => factory(),
    useRef: <T,>(initial: T) => ({ current: initial }),
    useCallback: <T,>(fn: T) => fn,
  };
});

const { Step8ActivationForm } = await import("./step8-activation-form");
type Step8ActivationFormProps =
  import("./step8-activation-form").Step8ActivationFormProps;

// ---------------------------------------------------------------------------
// React-tree serializer — mirror of step7-manager-invite-form.test.tsx.
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
    const name = typeName(node.type);
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
        return { type: name, props, children };
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
    return { type: name, props, children };
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
  predicate: (n: NonNullable<SerializedNode>) => boolean,
): SerializedNode[] {
  return flatten(n).filter(
    (x): x is NonNullable<SerializedNode> => x !== null && predicate(x),
  );
}

function findButtonByText(
  n: SerializedNode,
  label: RegExp,
): SerializedNode | null {
  const candidates = findAll(n, (x) => {
    if (!("props" in x)) return false;
    const text = allText(x);
    return label.test(text);
  });
  const withHandler = candidates
    .reverse()
    .find(
      (x) =>
        x !== null &&
        "props" in x &&
        typeof (x.props as { onClick?: unknown }).onClick === "function",
    );
  if (withHandler !== undefined) return withHandler;
  return candidates[candidates.length - 1] ?? null;
}

function findBySlot(n: SerializedNode, slot: string): SerializedNode | null {
  const matches = findAll(n, (x) => {
    if (!("props" in x)) return false;
    const p = x.props as { "data-slot"?: string };
    return p["data-slot"] === slot;
  });
  return matches[0] ?? null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
function defaultProps(
  overrides: Partial<Step8ActivationFormProps> = {},
): Step8ActivationFormProps {
  return {
    slug: "le-resto",
    pwaUrl: "https://le-resto.kitchen-boost.com",
    recap: {
      compteResto: {
        name: "Le Resto",
        slug: "le-resto",
        address: "12 rue de Paris, 75001 Paris",
        phone: "+33 1 23 45 67 89",
        emailManager: "gerant@le-resto.fr",
      },
      domaine: {
        customDomain: undefined,
        bootstrapHost: "le-resto.kitchen-boost.com",
      },
      stripe: {
        accountLinkGenerated: true,
        status: "ready",
      },
      branding: {
        logoUrl: "https://cdn.example.fr/logo.png",
        primaryColor: "#1B7A3D",
      },
      menu: {
        categoriesCount: 4,
        itemsCount: 18,
        lastPublishedAt: new Date("2026-05-30T12:00:00Z").getTime(),
      },
      invitation: {
        sentAt: new Date("2026-05-30T13:00:00Z").getTime(),
        email: "gerant@le-resto.fr",
      },
    },
    menuPublished: true,
    onActivate: vi.fn(async () => {}),
    isActivating: false,
    activateError: null,
    onPrev: vi.fn(),
    onBackToMenuStep: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("Step8ActivationForm — F-WIZARD [10/10] (#274)", () => {
  it("renders the 6 récap blocks (compte resto, domaine, Stripe, branding, menu, invitation)", () => {
    const tree = serialize(Step8ActivationForm(defaultProps()));
    const text = allText(tree);
    // Block headings — wording must convey each topic to the operator.
    expect(text).toMatch(/Compte resto/i);
    expect(text).toMatch(/Domaine/i);
    expect(text).toMatch(/Stripe/i);
    expect(text).toMatch(/Branding/i);
    expect(text).toMatch(/Menu/i);
    expect(text).toMatch(/Invitation/i);
  });

  it("récap shows the resto name, slug, address, phone and email gérant", () => {
    const tree = serialize(Step8ActivationForm(defaultProps()));
    const text = allText(tree);
    expect(text).toContain("Le Resto");
    expect(text).toContain("le-resto");
    expect(text).toContain("12 rue de Paris, 75001 Paris");
    expect(text).toContain("+33 1 23 45 67 89");
    expect(text).toContain("gerant@le-resto.fr");
  });

  it("récap shows the bootstrap host when no customDomain is set", () => {
    const tree = serialize(Step8ActivationForm(defaultProps()));
    const text = allText(tree);
    expect(text).toContain("le-resto.kitchen-boost.com");
  });

  it("récap shows the customDomain when set (in addition to / in place of the bootstrap host)", () => {
    const tree = serialize(
      Step8ActivationForm(
        defaultProps({
          recap: {
            ...defaultProps().recap,
            domaine: {
              customDomain: "leresto.fr",
              bootstrapHost: "le-resto.kitchen-boost.com",
            },
          },
        }),
      ),
    );
    const text = allText(tree);
    expect(text).toContain("leresto.fr");
  });

  it("récap shows the menu counts (catégories + items) + last published timestamp", () => {
    const tree = serialize(Step8ActivationForm(defaultProps()));
    const text = allText(tree);
    expect(text).toMatch(/4\s*cat[ée]gorie/i);
    expect(text).toMatch(/18\s*item/i);
    // Last published date in fr-FR formatting → 30/05/2026.
    expect(text).toMatch(/30\/05\/2026|2026-05-30/);
  });

  it("récap shows a warning when no manager invite has been sent", () => {
    const tree = serialize(
      Step8ActivationForm(
        defaultProps({
          recap: {
            ...defaultProps().recap,
            invitation: { sentAt: null, email: "gerant@le-resto.fr" },
          },
        }),
      ),
    );
    const text = allText(tree);
    // The invitation block carries a non-blocking warning when no row exists.
    expect(text).toMatch(/non envoy[ée]e|aucune invitation/i);
  });

  it("« Mettre en production » button is rendered and enabled when menu is published", () => {
    const tree = serialize(Step8ActivationForm(defaultProps()));
    const btn = findButtonByText(tree, /Mettre en production/i) as {
      props: { onClick?: () => void; disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).not.toBe(true);
  });

  it("« Mettre en production » does NOT call `onActivate` directly (the 2-step dialog gates the actual call)", () => {
    const onActivate = vi.fn(async () => {});
    const tree = serialize(Step8ActivationForm(defaultProps({ onActivate })));
    const btn = findButtonByText(tree, /^Mettre en production$/i) as {
      props: { onClick?: () => void };
    } | null;
    expect(btn).not.toBeNull();
    // Clicking the outer CTA must NOT trigger the activation — it only opens
    // the dialog (the dialog's confirm button is what calls `onActivate`).
    btn?.props.onClick?.();
    expect(onActivate).not.toHaveBeenCalled();
  });

  it("when menuPublished === false: « Mettre en production » is DISABLED + warning is shown + « Retour step 5 » CTA is wired to `onBackToMenuStep`", () => {
    const onBackToMenuStep = vi.fn();
    const tree = serialize(
      Step8ActivationForm(
        defaultProps({ menuPublished: false, onBackToMenuStep }),
      ),
    );
    const text = allText(tree);
    expect(text).toMatch(/menu n[oô]?n publi[ée]/i);

    const cta = findButtonByText(tree, /Mettre en production/i) as {
      props: { disabled?: boolean };
    } | null;
    expect(cta?.props.disabled).toBe(true);

    const back = findButtonByText(tree, /Retour.*step\s*5|Retour.*menu/i) as {
      props: { onClick?: () => void };
    } | null;
    expect(back).not.toBeNull();
    back?.props.onClick?.();
    expect(onBackToMenuStep).toHaveBeenCalledTimes(1);
  });

  it("activation error (`activateError !== null`) is rendered inline", () => {
    const tree = serialize(
      Step8ActivationForm(
        defaultProps({ activateError: "INVALID_STATE: tenant déjà actif" }),
      ),
    );
    const text = allText(tree);
    expect(text).toContain("INVALID_STATE");
  });

  it("« Précédent » button is wired to `onPrev`", () => {
    const onPrev = vi.fn();
    const tree = serialize(Step8ActivationForm(defaultProps({ onPrev })));
    const btn = findButtonByText(tree, /Pr[ée]c[ée]dent/i) as {
      props: { onClick?: () => void };
    } | null;
    expect(btn).not.toBeNull();
    btn?.props.onClick?.();
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it("confirmation dialog content is rendered (récap + slug-input + activate button)", () => {
    // The dialog content is part of the tree even when closed (Radix renders
    // the structure conditionally on `open`); we use a `data-slot` sentinel
    // and assert its content shape.
    const tree = serialize(Step8ActivationForm(defaultProps()));
    const dialog = findBySlot(tree, "wizard-step8-confirm-dialog");
    expect(dialog).not.toBeNull();
    const text = allText(dialog);
    // The dialog spells out the slug to type + a clear « Activer
    // définitivement » CTA.
    expect(text).toMatch(/le-resto/);
    expect(text).toMatch(/Activer/i);
  });

  it("dialog: « Activer définitivement » button calls `onActivate` (the slug-typing gate is enforced via disabled, pinned in the decision test)", async () => {
    const onActivate = vi.fn(async () => {});
    // We pass `confirmTyped === slug` to simulate the operator having typed the
    // correct slug (the form's local state is unobservable under the hooks
    // shim; we drive the gate via the public prop so the dialog's confirm
    // button is enabled).
    const tree = serialize(
      Step8ActivationForm(
        defaultProps({ onActivate, confirmTypedSlug: "le-resto" }),
      ),
    );
    const btn = findButtonByText(tree, /Activer d[ée]finitivement/i) as {
      props: { onClick?: () => void | Promise<void>; disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).not.toBe(true);
    await btn?.props.onClick?.();
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it("dialog: « Activer définitivement » is DISABLED until the typed slug matches", () => {
    const tree = serialize(
      Step8ActivationForm(
        defaultProps({ confirmTypedSlug: "le-rest" }), // partial, not matching
      ),
    );
    const btn = findButtonByText(tree, /Activer d[ée]finitivement/i) as {
      props: { disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).toBe(true);
  });

  it("dialog: « Activer définitivement » is DISABLED while activation is in flight", () => {
    const tree = serialize(
      Step8ActivationForm(
        defaultProps({ confirmTypedSlug: "le-resto", isActivating: true }),
      ),
    );
    const btn = findButtonByText(tree, /Activer|Activation en cours/i) as {
      props: { disabled?: boolean };
    } | null;
    expect(btn).not.toBeNull();
    expect(btn?.props.disabled).toBe(true);
  });

  it("the dialog spells out the final PWA URL the customer will hit", () => {
    const tree = serialize(Step8ActivationForm(defaultProps()));
    const dialog = findBySlot(tree, "wizard-step8-confirm-dialog");
    const text = allText(dialog);
    // The final URL is the canonical confirmation cue (issue body: « URL PWA
    // finale » in the dialog).
    expect(text).toContain("le-resto.kitchen-boost.com");
  });

  it("scope discipline: the form module does not import from `apps/web` or `apps/native`", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./step8-activation-form.tsx"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/apps\/web/);
    expect(code).not.toMatch(/apps\/native/);
  });

  it("scope discipline: the form module does NOT call backend (zero `useMutation` / `useAction` / `useQuery`)", () => {
    const source = readFileSync(
      path.resolve(__dirname, "./step8-activation-form.tsx"),
      "utf8",
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/useMutation/);
    expect(code).not.toMatch(/useAction/);
    expect(code).not.toMatch(/useQuery/);
    expect(code).not.toMatch(/convex\/react/);
  });
});
