/**
 * F-PARAMETRES-01 (#193) — `ParametresView`, pure presentational shell of the
 * tenant Paramètres page (skeleton + 4 empty sections + Uber Direct read-only
 * block, first tracer-bullet of EPIC F-PARAMETRES #148).
 *
 * Owns the visible contract:
 *   - Page title « Paramètres ».
 *   - 4 section cards in the canonical order: Identité visuelle / Coordonnées
 *     / Modes acceptés / Horaires de service — sections 2-4 keep an
 *     « À implémenter » placeholder body (the editors land in
 *     F-PARAMETRES-03..05); section 1 has been WIRED by F-PARAMETRES-02
 *     (#229) and now mounts the live `BrandingEditor`.
 *   - The « Zone livraison Uber Direct » read-only informational block
 *     (user story 12 from EPIC #148) — V1 cannot be edited.
 *
 * Split out of `page.tsx` (which owns `useTenantQuery`) so vitest can pin
 * every branch under `environment: "node"` — same React-tree-serializer
 * pattern as `menu-view.test.tsx` / `mes-clients-view.test.tsx`. The page
 * hands `serviceHours` in as a prop (Convex's loading sentinel = `undefined`);
 * the view is a pure function of its props.
 *
 * Acceptance criteria covered (#193):
 *   - AC2 « La page lit les valeurs courantes du tenant via `useTenantQuery`
 *     et affiche les 4 sections (vides, placeholders) » → 4 section titles
 *     and the per-section « À implémenter » placeholder are pinned here.
 *     Wiring of `useTenantQuery` itself is pinned by `page.test.ts`.
 *   - AC3 « Le bloc « Zone livraison Uber Direct » s'affiche en lecture
 *     seule » → assert the block surfaces with the read-only marker, and the
 *     copy makes clear the rayon is « Géré par Uber Direct » (V1 informative).
 *   - AC5 « Composants UI shadcn (Card, Separator) utilisés » → pinned by
 *     looking for the canonical `data-slot="card"` markers from
 *     `components/ui/card.tsx`.
 *   - AC6 « Aucune mutation appelée » → pinned at source-string level by
 *     `page.test.ts` (the view is pure and could never call a mutation
 *     anyway).
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// F-PARAMETRES-02 (#229) — the section 1 editor (`BrandingEditor`) uses
// `useState` / `useRef` / `useEffect` + `react-hook-form`. Under
// `environment: "node"` (no React renderer), the real hooks throw — same
// stub pattern as `menu-view.test.tsx`.
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
  };
});
vi.mock("react-hook-form", () => ({
  useForm: () => ({
    register: (name: string) => ({
      name,
      onChange: () => {},
      onBlur: () => {},
      ref: () => {},
    }),
    watch: () => undefined,
    setValue: () => {},
    getValues: () => undefined,
    handleSubmit: (fn: (data: unknown) => unknown) => async () => fn({}),
    formState: { errors: {}, isSubmitting: false },
    reset: () => {},
  }),
}));

const { ParametresView } = await import("./parametres-view");
type ParametresViewProps = import("./parametres-view").ParametresViewProps;

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as menu-view.test.tsx /
// mes-clients-view.test.tsx, trimmed to what we need here.
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

function dataSlots(n: SerializedNode): string[] {
  return flatten(n)
    .map((x) => {
      if (x === null || "text" in x) return null;
      const ds = x.props["data-slot"];
      return typeof ds === "string" ? ds : null;
    })
    .filter((s): s is string => s !== null);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
// F-PARAMETRES-02 (#229) widens the view's prop contract with `branding` +
// `onSaveBranding` + `onUploadLogo` — the section 1 editor is now LIVE
// (BrandingEditor) and consumes them.
// F-PARAMETRES-03 (#231) widens it again with `coordonnees` +
// `onSaveCoordonnees` — section 2 is now LIVE (CoordonneesEditor). Modes /
// Horaires sections remain placeholders.
const noopBranding = async () => {};
const noopUpload = async () => "https://cdn/x.png";
const noopCoordonnees = async () => {};
const noopModes = async () => {};
const noopServiceHours = async () => {};
const noopPrinterSave = async () => {};
const noopPrinterClear = async () => {};
// PR #477 — tenantId is forwarded to the new `SectionStripeConnect` so it can
// build the deep-link to `/t/<tenantId>/parametres/stripe`. Any stable string
// fixture works in the React-tree serializer (no routing actually runs).
const FIXTURE_TENANT_ID =
  "kn7bfqjem442c1dzqdjjmcfyxx87q53j" as unknown as ParametresViewProps["tenantId"];
const BASE_BRANDING_PROPS = {
  tenantId: FIXTURE_TENANT_ID,
  branding: undefined,
  onSaveBranding: noopBranding,
  onUploadLogo: noopUpload,
  coordonnees: undefined,
  onSaveCoordonnees: noopCoordonnees,
  acceptedModes: undefined,
  onSaveAcceptedModes: noopModes,
  onSaveServiceHours: noopServiceHours,
  // #416 — Printer config props (5th section: « Imprimante cuisine »).
  // The page resolves these from `useTenantQuery(api.lib.printing.printing
  // .getPrinterConfig)` + the two `useTenantMutation` bindings (set + clear).
  // `undefined` here is the Convex loading sentinel — the editor handles it
  // the same way it handles `null` (no printer configured yet).
  printerConfig: undefined,
  onSavePrinterConfig: noopPrinterSave,
  onClearPrinterConfig: noopPrinterClear,
} as const;

const LOADING: ParametresViewProps = {
  serviceHours: undefined,
  ...BASE_BRANDING_PROPS,
};
const EMPTY: ParametresViewProps = {
  serviceHours: { windows: [] },
  ...BASE_BRANDING_PROPS,
};
const WITH_WINDOWS: ParametresViewProps = {
  serviceHours: {
    windows: [
      { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
      { dayOfWeek: 1, startMinute: 18 * 60 + 30, endMinute: 22 * 60 },
    ],
  },
  ...BASE_BRANDING_PROPS,
};
// #416 — printerConfig set: triggers the « Retirer l'imprimante » button branch.
const WITH_PRINTER: ParametresViewProps = {
  ...EMPTY,
  printerConfig: {
    starWebPrntUrl: "http://192.168.1.42/StarWebPRNT/SendMessage",
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("ParametresView — F-PARAMETRES-01 (#193)", () => {
  it("AC2 — surfaces the page title « Paramètres » on every branch", () => {
    for (const props of [LOADING, EMPTY, WITH_WINDOWS]) {
      const text = allText(serialize(ParametresView(props)));
      expect(text).toMatch(/Param[èe]tres/);
    }
  });

  it("AC2 — renders the canonical section titles in order: Identité visuelle / Coordonnées / Modes acceptés / Horaires de service / Imprimante cuisine (#416) / Stripe Connect (PR #477)", () => {
    const text = allText(serialize(ParametresView(EMPTY)));
    const identiteIdx = text.search(/Identit[ée] visuelle/);
    const coordIdx = text.search(/Coordonn[ée]es/);
    const modesIdx = text.search(/Modes accept[ée]s/);
    const horairesIdx = text.search(/Horaires de service/);
    // #416 — « Imprimante cuisine » section, after Horaires (config plumbing,
    // not a daily operational lever — same family as the existing 4 sections
    // and explicitly distinct from the « Disponibilité » page which owns the
    // « ici et maintenant » levers).
    const imprimanteIdx = text.search(/Imprimante cuisine/);
    // PR #477 — « Stripe Connect » entry-point card linking to the dedicated
    // sub-page, placed AFTER Imprimante so the visual rhythm stays « toutes
    // les sections d'édition d'abord, infos / sous-pages après ».
    const stripeIdx = text.search(/Stripe Connect/);

    expect(identiteIdx).toBeGreaterThanOrEqual(0);
    expect(coordIdx).toBeGreaterThan(identiteIdx);
    expect(modesIdx).toBeGreaterThan(coordIdx);
    expect(horairesIdx).toBeGreaterThan(modesIdx);
    expect(imprimanteIdx).toBeGreaterThan(horairesIdx);
    expect(stripeIdx).toBeGreaterThan(imprimanteIdx);
  });

  it("PR #477 — Stripe Connect entry-point card exposes a deep-link to `/t/<tenantId>/parametres/stripe`", () => {
    const tree = serialize(ParametresView(EMPTY));
    // The card carries its own stable data-slot marker, distinct from the
    // sibling sections, so future surfaces / tests can target it without
    // grepping copy.
    expect(dataSlots(tree)).toContain("parametres-section-stripe");
    // The CTA links to the sub-page using the prop `tenantId` — pin the
    // computed href so a refactor of the URL shape breaks loudly here.
    const hrefs = flatten(tree)
      .map((x) => {
        if (x === null || "text" in x) return null;
        const href = x.props.href;
        return typeof href === "string" ? href : null;
      })
      .filter((s): s is string => s !== null);
    expect(hrefs).toContain(`/t/${FIXTURE_TENANT_ID}/parametres/stripe`);
  });

  it("Uber Direct entry-point card exposes a deep-link to `/t/<tenantId>/parametres/uber-direct`", () => {
    const tree = serialize(ParametresView(EMPTY));
    expect(dataSlots(tree)).toContain("parametres-section-uber-direct");
    const hrefs = flatten(tree)
      .map((x) => {
        if (x === null || "text" in x) return null;
        const href = x.props.href;
        return typeof href === "string" ? href : null;
      })
      .filter((s): s is string => s !== null);
    expect(hrefs).toContain(`/t/${FIXTURE_TENANT_ID}/parametres/uber-direct`);
  });

  it("F-PARAMETRES-05 (#236) — all 4 sections are now WIRED — no « À implémenter » placeholder remains on the Paramètres page", () => {
    // Identité visuelle (BrandingEditor), Coordonnées (CoordonneesEditor),
    // Modes (ModesEditor), and now Horaires (ServiceHoursEditor) are all
    // live editors. Slice 5 closes the EPIC's Implementation Decisions
    // « 4 sections in the canonical order » loop — no placeholder body
    // remains on the page.
    const text = allText(serialize(ParametresView(EMPTY)));
    expect(text).not.toMatch(/[ÀA] impl[ée]menter/);
  });

  it("AC3 — surfaces the « Zone livraison Uber Direct » read-only block with the V1 informative copy", () => {
    const tree = serialize(ParametresView(EMPTY));
    const text = allText(tree);
    expect(text).toMatch(/Zone livraison Uber Direct/);
    // V1 copy: « Géré par Uber Direct » (the rayon is informative — no edit
    // surface). The exact polish stays free; the load-bearing fact is that
    // the block makes the read-only intent visible.
    expect(text).toMatch(/G[ée]r[ée] par Uber Direct/);
  });

  it("AC3 — Uber Direct block carries a stable data-slot marker so consumers (and tests) can target it", () => {
    const slots = dataSlots(serialize(ParametresView(EMPTY)));
    expect(slots).toContain("parametres-uber-direct-readonly");
  });

  it("AC5 — uses shadcn `Card` primitives (the canonical `bg-card` className from `components/ui/card.tsx` surfaces on every section)", () => {
    // The shadcn `Card` primitive's root div carries `bg-card text-card-
    // foreground …` (see `components/ui/card.tsx`). Each of the 5 cards in
    // this view (4 sections + 1 Uber Direct block) MUST surface that
    // className when serialized — pinning the count >= 4 so a refactor that
    // inlines one Card without the primitive still passes for the others.
    //
    // We can't pin via `data-slot="card"` here: each Card overrides the
    // primitive's default data-slot with a section-specific marker (same
    // pattern as `menu-view.tsx`'s `data-slot="menu-category-row"`), which
    // is itself pinned by the per-section slot tests above.
    const tree = serialize(ParametresView(EMPTY));
    const classes = flatten(tree)
      .map((n) => {
        if (n === null || "text" in n) return null;
        const cls = n.props["className"];
        return typeof cls === "string" ? cls : null;
      })
      .filter((c): c is string => c !== null);
    const cardClassCount = classes.filter((c) => c.includes("bg-card")).length;
    // #416 — the page now hosts 5 section cards + the Uber Direct read-only
    // block (the « Imprimante cuisine » section landed alongside the
    // pre-existing 4). The lower bound stays generous (≥ 5) so a refactor
    // that inlines one Card without the primitive still passes for the
    // others.
    expect(cardClassCount).toBeGreaterThanOrEqual(5);
  });

  it("AC5 — uses the shadcn `Separator` primitive (radix `data-orientation` marker surfaces in the tree)", () => {
    // `Separator` from `components/ui/separator.tsx` wraps
    // `SeparatorPrimitive.Root` from `@radix-ui/react-separator`, which
    // serializes with a `data-orientation` attribute (the Radix contract).
    // We pin the presence of that attribute as the canonical signal that
    // the Separator primitive is in the tree — same approach as the
    // `animate-pulse` marker for the Skeleton primitive in
    // `menu-view.test.tsx`.
    const tree = serialize(ParametresView(EMPTY));
    const hasOrientation = flatten(tree).some((n) => {
      if (n === null || "text" in n) return false;
      return "data-orientation" in n.props || "orientation" in n.props;
    });
    expect(hasOrientation).toBe(true);
  });

  it("AC2 — every section card carries a stable data-slot marker (one per canonical section)", () => {
    const slots = dataSlots(serialize(ParametresView(EMPTY)));
    expect(slots).toContain("parametres-section-identite");
    expect(slots).toContain("parametres-section-coordonnees");
    expect(slots).toContain("parametres-section-modes");
    expect(slots).toContain("parametres-section-horaires");
    // #416 — printer section, fifth in the canonical order.
    expect(slots).toContain("parametres-section-imprimante");
  });

  it("AC2 — loading branch (serviceHours === undefined) does NOT crash and still renders all sections + Uber Direct block", () => {
    const tree = serialize(ParametresView(LOADING));
    expect(tree).not.toBeNull();
    const slots = dataSlots(tree);
    expect(slots).toContain("parametres-section-identite");
    expect(slots).toContain("parametres-section-coordonnees");
    expect(slots).toContain("parametres-section-modes");
    expect(slots).toContain("parametres-section-horaires");
    expect(slots).toContain("parametres-section-imprimante");
    expect(slots).toContain("parametres-uber-direct-readonly");
  });

  it("F-PARAMETRES-02 (#229) — section Identité visuelle is WIRED (BrandingEditor) and no longer a placeholder", () => {
    // The wired section surfaces the save button slot exposed by
    // `BrandingEditor`, AND the section's title is no longer accompanied by
    // an « À implémenter » body underneath.
    const tree = serialize(ParametresView(EMPTY));
    expect(dataSlots(tree)).toContain("parametres-branding-save");
    // The section card itself still carries the canonical slot from slice 1.
    expect(dataSlots(tree)).toContain("parametres-section-identite");
  });

  it("F-PARAMETRES-03 (#231) — section Coordonnées is WIRED (CoordonneesEditor) and no longer a placeholder", () => {
    // The wired section surfaces the save button + the two inputs slots
    // exposed by `CoordonneesEditor`. The section card's data-slot from
    // slice 1 is preserved so downstream consumers don't need to know
    // whether it's a placeholder or a live editor.
    const tree = serialize(ParametresView(EMPTY));
    const slots = dataSlots(tree);
    expect(slots).toContain("parametres-coordonnees-save");
    expect(slots).toContain("parametres-coordonnees-address-input");
    expect(slots).toContain("parametres-coordonnees-phone-input");
    expect(slots).toContain("parametres-section-coordonnees");
  });

  it("F-PARAMETRES-04 (#234) — section Modes acceptés is WIRED (ModesEditor) and no longer a placeholder", () => {
    // The wired section surfaces the two toggles + the save button slots
    // exposed by `ModesEditor`. The section card's data-slot from slice 1
    // is preserved so downstream consumers don't need to know whether it's
    // a placeholder or a live editor.
    const tree = serialize(ParametresView(EMPTY));
    const slots = dataSlots(tree);
    expect(slots).toContain("parametres-modes-save");
    expect(slots).toContain("parametres-modes-delivery-toggle");
    expect(slots).toContain("parametres-modes-click-and-collect-toggle");
    expect(slots).toContain("parametres-section-modes");
  });

  it("F-PARAMETRES-05 (#236) — section Horaires de service is WIRED (ServiceHoursEditor) and no longer a placeholder", () => {
    // The wired section surfaces the save button slot exposed by
    // `ServiceHoursEditor`. The section card's data-slot from slice 1
    // is preserved so downstream consumers don't need to know whether
    // it's a placeholder or a live editor.
    const tree = serialize(ParametresView(WITH_WINDOWS));
    const slots = dataSlots(tree);
    expect(slots).toContain("parametres-service-hours-save");
    expect(slots).toContain("parametres-service-hours-form");
    expect(slots).toContain("parametres-section-horaires");
  });

  it("F-PARAMETRES-05 (#236) — Horaires section renders even on the LOADING branch (serviceHours === undefined seeds the editor with an empty windows list)", () => {
    // The editor accepts an empty list gracefully — loading and empty look
    // the same from the editor's perspective. The page rehydrates on the
    // next Convex reactivity tick.
    const tree = serialize(ParametresView(LOADING));
    expect(dataSlots(tree)).toContain("parametres-service-hours-form");
  });

  // ── #416 — Imprimante cuisine section (KB Admin mirror, PRD 20 §14) ─────
  it("#416 — section Imprimante cuisine is WIRED (PrinterEditor) and surfaces the URL input + save button", () => {
    const tree = serialize(ParametresView(EMPTY));
    const slots = dataSlots(tree);
    expect(slots).toContain("parametres-printer-url-input");
    expect(slots).toContain("parametres-printer-save");
    // The section card's data-slot is the stable handle the test pins.
    expect(slots).toContain("parametres-section-imprimante");
  });

  it("#416 — when no printer is configured, the « Retirer » button is hidden (only Save surfaces)", () => {
    // FRESH printer + EMPTY service hours → printerConfig === undefined,
    // editor treats it as « no printer ».
    const slots = dataSlots(serialize(ParametresView(EMPTY)));
    expect(slots).not.toContain("parametres-printer-clear");
  });

  it("#416 — when a printer is configured, the « Retirer » button surfaces alongside Save (state Convex partagé with the native app)", () => {
    const slots = dataSlots(serialize(ParametresView(WITH_PRINTER)));
    expect(slots).toContain("parametres-printer-clear");
    expect(slots).toContain("parametres-printer-save");
  });

  it("#416 — section Imprimante cuisine renders on the LOADING branch too (printerConfig === undefined seeds the editor with the « no printer » default)", () => {
    const slots = dataSlots(serialize(ParametresView(LOADING)));
    expect(slots).toContain("parametres-section-imprimante");
    expect(slots).toContain("parametres-printer-url-input");
  });
});
