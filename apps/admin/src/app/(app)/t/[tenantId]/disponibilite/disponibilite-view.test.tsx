/**
 * #397 (KB Admin — Toggles disponibilité commerciale) — `DisponibiliteView`,
 * pure presentational shell of the « Disponibilité commerciale » page
 * (PRD 20 §7 / ADR 0018). Surface équivalente à l'app native (#406–#409)
 * avec **même state Convex partagé** : un changement KB Admin se reflète
 * immédiatement côté app native (et inversement).
 *
 * Owns the visible contract:
 *   - Page title « Disponibilité commerciale ».
 *   - 4 sections dans l'ordre canonique :
 *      1. Pause exceptionnelle — 3 boutons fixes 15 / 30 / 60 min + ETA
 *         reprise + bouton « Lever la pause » quand active (PRD 20 §7a / #406).
 *      2. Fermeture exceptionnelle — date picker début / fin + bouton
 *         « Lever la fermeture » quand active (PRD 20 §7b / #407).
 *      3. Toggle dispo item — lien explicite vers `/menu` (le toggle live
 *         existe déjà sur les cards item, ADR 0018) avec le tooltip RGPD du
 *         PRD §7c rappelé inline (PRD 20 §7c / #408).
 *      4. Modif horaires d'ouverture — lien vers `/parametres` section
 *         « Horaires de service » (le ServiceHoursEditor existant gère
 *         l'édition, PRD 20 §7d / #409).
 *
 * Split out of `page.tsx` (which owns `useTenantQuery` / `useTenantMutation`)
 * so vitest can pin every branch under `environment: "node"` — same
 * React-tree-serializer pattern as `parametres-view.test.tsx` /
 * `sessions-view.test.tsx`. The page hands the live state in as props
 * (Convex sentinel = `undefined`); the view is a pure function of its props.
 */
import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

// Under `environment: "node"` the real React hooks throw — stub them. Same
// pattern as parametres-view.test.tsx / sessions-view.test.tsx.
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

const { DisponibiliteView } = await import("./disponibilite-view");
type DisponibiliteViewProps =
  import("./disponibilite-view").DisponibiliteViewProps;

// ---------------------------------------------------------------------------
// Tiny React-tree serializer — same shape as sessions-view.test.tsx.
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

function structural(node: ReactElement): SerializedNode {
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
        return structural(node);
      }
    }
    if (typeof node.type === "object" && node.type !== null) {
      const obj = node.type as {
        render?: (p: unknown, r: unknown) => ReactNode;
      };
      if (typeof obj.render === "function") {
        try {
          return serialize(obj.render(node.props, null));
        } catch {
          return structural(node);
        }
      }
    }
    return structural(node);
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
const TENANT_ID = "tenants:xyz";
const noopAsync = async () => {};

// Fixtures use LOCAL-time constructors (`new Date(...).getTime()`) instead
// of `Date.UTC(...)` so the Intl.DateTimeFormat output the view produces
// matches the wall-clock the test expects regardless of the CI timezone.
const NOW = new Date(2026, 5, 3, 18, 0).getTime();
const NOW_PLUS_30MIN = new Date(2026, 5, 3, 18, 30).getTime();
const NOW_MINUS_1H = new Date(2026, 5, 3, 17, 0).getTime();
const CLOSURE_FROM = new Date(2026, 5, 3, 0, 0).getTime();
const CLOSURE_UNTIL = new Date(2026, 5, 5, 0, 0).getTime();

const LOADING: DisponibiliteViewProps = {
  tenantId: TENANT_ID,
  pause: undefined,
  closure: undefined,
  onSetPause: noopAsync,
  onClearPause: noopAsync,
  onSetClosure: noopAsync,
  onClearClosure: noopAsync,
  // Injected clock — every time-sensitive copy is a function of `nowMs` so
  // tests are deterministic (no real wall-clock).
  nowMs: NOW,
};

const NO_PAUSE_NO_CLOSURE: DisponibiliteViewProps = {
  ...LOADING,
  pause: null,
  closure: null,
};

const PAUSE_ACTIVE_30MIN: DisponibiliteViewProps = {
  ...NO_PAUSE_NO_CLOSURE,
  pause: { until: NOW_PLUS_30MIN },
};

const PAUSE_EXPIRED: DisponibiliteViewProps = {
  ...NO_PAUSE_NO_CLOSURE,
  pause: { until: NOW_MINUS_1H },
};

const CLOSURE_ACTIVE: DisponibiliteViewProps = {
  ...NO_PAUSE_NO_CLOSURE,
  closure: {
    from: CLOSURE_FROM,
    until: CLOSURE_UNTIL,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("DisponibiliteView — #397", () => {
  it("surfaces the page title « Disponibilité commerciale » on every branch", () => {
    for (const props of [
      LOADING,
      NO_PAUSE_NO_CLOSURE,
      PAUSE_ACTIVE_30MIN,
      CLOSURE_ACTIVE,
    ]) {
      const text = allText(serialize(DisponibiliteView(props)));
      expect(text).toMatch(/Disponibilit[ée] commerciale/);
    }
  });

  it("renders the 4 canonical section titles in order: Pause / Fermeture / Toggle item / Horaires", () => {
    const text = allText(serialize(DisponibiliteView(NO_PAUSE_NO_CLOSURE)));
    const pauseIdx = text.search(/Pause exceptionnelle/);
    const closureIdx = text.search(/Fermeture exceptionnelle/);
    const itemIdx = text.search(/Disponibilit[ée] des? articles?/i);
    const horairesIdx = text.search(/Horaires d['']ouverture/);

    expect(pauseIdx).toBeGreaterThanOrEqual(0);
    expect(closureIdx).toBeGreaterThan(pauseIdx);
    expect(itemIdx).toBeGreaterThan(closureIdx);
    expect(horairesIdx).toBeGreaterThan(itemIdx);
  });

  it("every section card carries a stable data-slot marker (one per canonical section)", () => {
    const slots = dataSlots(serialize(DisponibiliteView(NO_PAUSE_NO_CLOSURE)));
    expect(slots).toContain("disponibilite-section-pause");
    expect(slots).toContain("disponibilite-section-closure");
    expect(slots).toContain("disponibilite-section-items");
    expect(slots).toContain("disponibilite-section-hours");
  });

  // -------------------------------------------------------------------------
  // Pause exceptionnelle (PRD 20 §7a)
  // -------------------------------------------------------------------------

  it("Pause section surfaces 3 fixed buttons (15 / 30 / 60 min) when no pause is active (PRD 20 §7a)", () => {
    const tree = serialize(DisponibiliteView(NO_PAUSE_NO_CLOSURE));
    const slots = dataSlots(tree);
    expect(slots).toContain("disponibilite-pause-15");
    expect(slots).toContain("disponibilite-pause-30");
    expect(slots).toContain("disponibilite-pause-60");
  });

  it("Pause section displays the ETA reprise when a pause is active (HH:MM)", () => {
    const text = allText(serialize(DisponibiliteView(PAUSE_ACTIVE_30MIN)));
    // 18:30 in Europe/Paris (the locale the view uses). We pin the load-
    // bearing fact: the reprise time surfaces somewhere on the page.
    expect(text).toMatch(/18[:h]30/);
  });

  it("Pause section surfaces a « Lever la pause » button when a pause is active", () => {
    const tree = serialize(DisponibiliteView(PAUSE_ACTIVE_30MIN));
    const slots = dataSlots(tree);
    expect(slots).toContain("disponibilite-pause-clear");
    const text = allText(tree);
    expect(text).toMatch(/Lever la pause/);
  });

  it("Pause section does NOT surface « Lever la pause » when the pause has already expired (auto-reprise, PRD 20 §7a)", () => {
    // Past pause = auto-reprise. The 3 duration buttons are back, the clear
    // button is gone (UI honours derived expiry).
    const tree = serialize(DisponibiliteView(PAUSE_EXPIRED));
    const slots = dataSlots(tree);
    expect(slots).not.toContain("disponibilite-pause-clear");
    expect(slots).toContain("disponibilite-pause-15");
  });

  // -------------------------------------------------------------------------
  // Fermeture exceptionnelle (PRD 20 §7b)
  // -------------------------------------------------------------------------

  it("Closure section surfaces a date picker (from / until) + a « Fermer » CTA when no closure is active", () => {
    const tree = serialize(DisponibiliteView(NO_PAUSE_NO_CLOSURE));
    const slots = dataSlots(tree);
    expect(slots).toContain("disponibilite-closure-from-input");
    expect(slots).toContain("disponibilite-closure-until-input");
    expect(slots).toContain("disponibilite-closure-submit");
  });

  it("Closure section surfaces a « Lever la fermeture » button when a closure is active (PRD 20 §7b — réversible à tout moment)", () => {
    const tree = serialize(DisponibiliteView(CLOSURE_ACTIVE));
    const slots = dataSlots(tree);
    expect(slots).toContain("disponibilite-closure-clear");
    const text = allText(tree);
    expect(text).toMatch(/Lever la fermeture/);
  });

  it("Closure section displays the « jusqu'au … » date when a closure is active", () => {
    const text = allText(serialize(DisponibiliteView(CLOSURE_ACTIVE)));
    // Free polish — pin the load-bearing fact: the réouverture date surfaces.
    expect(text).toMatch(/jusqu['']au/i);
  });

  // -------------------------------------------------------------------------
  // Toggle item — pointe vers /menu (PRD 20 §7c)
  // -------------------------------------------------------------------------

  it("Items section surfaces a link to the Menu page (where the live toggle lives, ADR 0018)", () => {
    const tree = serialize(DisponibiliteView(NO_PAUSE_NO_CLOSURE));
    // The link href must point at the tenant's /menu route (the existing
    // page hosts the live toggle, ADR 0018 — no duplication).
    const flat = flatten(tree);
    const hasMenuLink = flat.some((n) => {
      if (n === null || "text" in n) return false;
      const href = n.props["href"];
      return typeof href === "string" && href === `/t/${TENANT_ID}/menu`;
    });
    expect(hasMenuLink).toBe(true);
  });

  it("Items section surfaces the PRD 20 §7c tooltip copy (« masque l'item ») as inline help", () => {
    // The exact polish stays free, but the load-bearing « pas de modification
    // permanente » framing of the PRD must surface so the gérant doesn't
    // confuse rupture with deletion.
    const text = allText(serialize(DisponibiliteView(NO_PAUSE_NO_CLOSURE)));
    expect(text).toMatch(/masque/i);
    expect(text).toMatch(/permanente|catalogue/i);
  });

  // -------------------------------------------------------------------------
  // Horaires — pointe vers /parametres (PRD 20 §7d)
  // -------------------------------------------------------------------------

  it("Hours section surfaces a link to the Paramètres page (where the ServiceHoursEditor lives, ADR 0018)", () => {
    const tree = serialize(DisponibiliteView(NO_PAUSE_NO_CLOSURE));
    const flat = flatten(tree);
    const hasParametresLink = flat.some((n) => {
      if (n === null || "text" in n) return false;
      const href = n.props["href"];
      return typeof href === "string" && href === `/t/${TENANT_ID}/parametres`;
    });
    expect(hasParametresLink).toBe(true);
  });
});
