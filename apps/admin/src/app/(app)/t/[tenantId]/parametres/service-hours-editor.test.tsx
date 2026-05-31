/**
 * F-PARAMETRES-05 (#236) — `ServiceHoursEditor`, the section éditeur for
 * « Horaires de service » on the tenant Paramètres page.
 *
 * Public contract (frozen by the issue body — « éditeur d'horaires extrait
 * comme module deep ») :
 *   {
 *     value:  ServiceWindow[],
 *     onSave: (windows: ServiceWindow[]) => Promise<void>,
 *   }
 *
 * Pinned here:
 *   - The editor is a stand-alone module — no coupling to tenant context /
 *     URL / backend api / Convex hooks (same discipline as branding /
 *     coordonnees / modes editors).
 *   - Owns its OWN local state (user story 9 — save isolé : an error on
 *     another section can't blow away the user's input here).
 *   - PURE validation function `validateServiceWindows` :
 *      * startMinute < endMinute (égalité interdite)
 *      * pas de chevauchement intra-jour (deux créneaux qui se recouvrent
 *        par ≥1 minute)
 *      * pas de cross-midnight (créneau qui passe minuit — interdit V1)
 *      * Bornes 00:00..24:00 minutes (0..1440) — mirrors the backend
 *        `assertServiceWindows` (cf. `convex/lib/menu/serviceHours.ts`).
 *     Exhaustive cases below (AC : « tests unitaires exhaustifs sur les cas
 *     limites — 00:00, 23:59, créneaux qui se touchent, qui se chevauchent
 *     par 1 min, start >= end, cross-midnight »).
 *   - Grid 7 days × N slots — chaque ligne = un jour, chaque ligne liste
 *     ses créneaux + un bouton « Ajouter un créneau ». Chaque créneau a
 *     deux time-pickers (start/end) + bouton supprimer.
 *   - Save button DISABLED tant qu'il y a une erreur de validation (AC :
 *     « bouton Enregistrer désactivé tant qu'il y a des erreurs »).
 *   - Save flow → `onSave(windows)` reçoit le tableau complet (la mutation
 *     backend `serviceHours.set({ windows })` remplace l'intégralité du
 *     tableau — UPSERT atomique, pas de patch partiel).
 *   - Inline error per invalid slot via un `data-slot` ciblable.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";

// Same `useState` stub pattern as `parametres-view.test.tsx` / sibling
// editors: under `environment: "node"` (no React renderer), the real hook
// throws. We mock it as a value-stub that returns the initial value + a
// no-op setter — the editor is render-as-function tested.
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

const {
  ServiceHoursEditor,
  validateServiceWindows,
  minutesToTimeString,
  timeStringToMinutes,
} = await import("./service-hours-editor");

// ---------------------------------------------------------------------------
// Tiny React-tree serializer (same shape as the sibling editors' tests).
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

function findBySlot(n: SerializedNode, slot: string): SerializedNode | null {
  const all = flatten(n);
  for (const node of all) {
    if (
      node !== null &&
      !("text" in node) &&
      node.props["data-slot"] === slot
    ) {
      return node;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
type ServiceWindow = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

function makeProps(
  overrides: {
    value?: ServiceWindow[];
    onSave?: (windows: ServiceWindow[]) => Promise<void>;
  } = {},
) {
  return {
    value: overrides.value ?? [],
    onSave: overrides.onSave ?? vi.fn(async () => {}),
  };
}

// ---------------------------------------------------------------------------
// Source-level pins (catches an editor that secretly couples to the
// tenant context / URL / backend api — reusability guard).
// ---------------------------------------------------------------------------
const EDITOR_SOURCE = readFileSync(
  path.resolve(__dirname, "./service-hours-editor.tsx"),
  "utf8",
);

function stripNonCode(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/`[^`]*`/g, "");
}

describe("ServiceHoursEditor — F-PARAMETRES-05 (#236) module contract", () => {
  it("is a stand-alone module — no coupling to URL / tenant context / backend api", () => {
    const code = stripNonCode(EDITOR_SOURCE);
    expect(code).not.toMatch(/useCurrentTenantId/);
    expect(code).not.toMatch(/useTenantQuery/);
    expect(code).not.toMatch(/useTenantMutation/);
    expect(code).not.toMatch(/useParams/);
    expect(code).not.toMatch(/api\.lib\.menu\.serviceHours/);
    expect(code).not.toMatch(/\buseMutation\b/);
    expect(code).not.toMatch(/\buseQuery\b/);
  });

  it("exports a typed Props interface with the `{ value, onSave }` contract", () => {
    expect(EDITOR_SOURCE).toMatch(/ServiceHoursEditorProps/);
    expect(EDITOR_SOURCE).toMatch(/onSave/);
  });

  it("exports the pure validator `validateServiceWindows` (extracted as a testable function — AC clé)", () => {
    expect(EDITOR_SOURCE).toMatch(/export function validateServiceWindows/);
  });

  it("exports the pure formatters `minutesToTimeString` / `timeStringToMinutes` (used by the time-picker inputs — extracted so they can be unit-tested in isolation)", () => {
    expect(EDITOR_SOURCE).toMatch(/export function minutesToTimeString/);
    expect(EDITOR_SOURCE).toMatch(/export function timeStringToMinutes/);
  });
});

// ---------------------------------------------------------------------------
// Pure validator — exhaustive AC limits (issue body)
// ---------------------------------------------------------------------------
describe("validateServiceWindows — AC clé : tests exhaustifs sur les cas limites", () => {
  it("an EMPTY list is valid (a resto with no hours set yet — same convention as the backend `assertServiceWindows`)", () => {
    const result = validateServiceWindows([]);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("a single well-formed window is valid (canonical BB slot 11:30 → 14:00, Monday)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
    ]);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("00:00 → 23:59 (extrema) is VALID — start at exactly midnight, end at the last minute of the day", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 0, startMinute: 0, endMinute: 23 * 60 + 59 },
    ]);
    expect(result.isValid).toBe(true);
  });

  it("00:00 → 24:00 (end exactly at midnight of the next day) is VALID — end is the EXCLUSIVE upper bound 1440, matches the backend invariant", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 0, startMinute: 0, endMinute: 1440 },
    ]);
    expect(result.isValid).toBe(true);
  });

  it("start >= end is INVALID (start === end : égalité interdite)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 12 * 60, endMinute: 12 * 60 },
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].kind).toBe("START_AFTER_OR_EQUAL_END");
    expect(result.errors[0].windowIndex).toBe(0);
  });

  it("start > end is INVALID (start strictement après end : same `START_AFTER_OR_EQUAL_END` error)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 14 * 60, endMinute: 11 * 60 },
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors[0].kind).toBe("START_AFTER_OR_EQUAL_END");
  });

  it("cross-midnight (start > 0, end > 1440) is INVALID via the bounds check", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 22 * 60, endMinute: 1500 },
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors[0].kind).toBe("OUT_OF_BOUNDS");
  });

  it("negative start is INVALID (out-of-bounds lower)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: -1, endMinute: 60 },
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors[0].kind).toBe("OUT_OF_BOUNDS");
  });

  it("end > 1440 is INVALID (out-of-bounds upper)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 60, endMinute: 1441 },
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors[0].kind).toBe("OUT_OF_BOUNDS");
  });

  it("dayOfWeek out of [0..6] is INVALID", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 7, startMinute: 60, endMinute: 120 },
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors[0].kind).toBe("INVALID_DAY");
  });

  it("two windows on the SAME day that TOUCH at the boundary (11:30 → 14:00 + 14:00 → 18:00) are VALID — end is exclusive, no overlap", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
      { dayOfWeek: 1, startMinute: 14 * 60, endMinute: 18 * 60 },
    ]);
    expect(result.isValid).toBe(true);
  });

  it("two windows on the SAME day that OVERLAP by 1 minute (11:30 → 14:00 + 13:59 → 18:00) are INVALID", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
      { dayOfWeek: 1, startMinute: 13 * 60 + 59, endMinute: 18 * 60 },
    ]);
    expect(result.isValid).toBe(false);
    const overlap = result.errors.find((e) => e.kind === "OVERLAP");
    expect(overlap).toBeDefined();
  });

  it("two windows on the SAME day where ONE CONTAINS THE OTHER (11:30 → 22:00 contains 13:00 → 14:00) is INVALID", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 22 * 60 },
      { dayOfWeek: 1, startMinute: 13 * 60, endMinute: 14 * 60 },
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors.find((e) => e.kind === "OVERLAP")).toBeDefined();
  });

  it("two IDENTICAL windows on the SAME day are INVALID (full overlap)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
      { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors.find((e) => e.kind === "OVERLAP")).toBeDefined();
  });

  it("two OVERLAPPING windows on DIFFERENT days are VALID (l'overlap est intra-jour uniquement)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
      { dayOfWeek: 2, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
    ]);
    expect(result.isValid).toBe(true);
  });

  it("the OVERLAP error attaches a stable identifier to the two conflicting windows (so the UI can mark them individually)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
      { dayOfWeek: 1, startMinute: 13 * 60 + 59, endMinute: 18 * 60 },
    ]);
    const overlap = result.errors.find((e) => e.kind === "OVERLAP");
    expect(overlap).toBeDefined();
    if (overlap !== undefined && overlap.kind === "OVERLAP") {
      // Both indices must be set so the UI can highlight both cells.
      expect(typeof overlap.windowIndex).toBe("number");
      expect(typeof overlap.otherWindowIndex).toBe("number");
      expect(overlap.windowIndex).not.toBe(overlap.otherWindowIndex);
    }
  });

  it("multiple distinct errors are ALL surfaced (the editor can render an inline message per offending slot — not first-error-only)", () => {
    const result = validateServiceWindows([
      // window 0: start === end (INVALID)
      { dayOfWeek: 1, startMinute: 12 * 60, endMinute: 12 * 60 },
      // window 1: out of bounds (INVALID)
      { dayOfWeek: 1, startMinute: 60, endMinute: 1500 },
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Pure formatters — round-trip safety
// ---------------------------------------------------------------------------
describe("minutesToTimeString / timeStringToMinutes — pure formatters", () => {
  it("minutesToTimeString(0) === '00:00'", () => {
    expect(minutesToTimeString(0)).toBe("00:00");
  });

  it("minutesToTimeString(1440) === '24:00' (the EXCLUSIVE upper bound — never wraps to '00:00')", () => {
    expect(minutesToTimeString(1440)).toBe("24:00");
  });

  it("minutesToTimeString(11 * 60 + 30) === '11:30'", () => {
    expect(minutesToTimeString(11 * 60 + 30)).toBe("11:30");
  });

  it("minutesToTimeString(23 * 60 + 59) === '23:59'", () => {
    expect(minutesToTimeString(23 * 60 + 59)).toBe("23:59");
  });

  it("timeStringToMinutes('00:00') === 0", () => {
    expect(timeStringToMinutes("00:00")).toBe(0);
  });

  it("timeStringToMinutes('11:30') === 690", () => {
    expect(timeStringToMinutes("11:30")).toBe(11 * 60 + 30);
  });

  it("timeStringToMinutes('24:00') === 1440 (the EXCLUSIVE upper bound — accepted as input)", () => {
    expect(timeStringToMinutes("24:00")).toBe(1440);
  });

  it("round-trip on every 15-minute slot from 00:00 to 24:00 is stable", () => {
    for (let m = 0; m <= 1440; m += 15) {
      expect(timeStringToMinutes(minutesToTimeString(m))).toBe(m);
    }
  });

  it("timeStringToMinutes on garbage returns NaN (rejected by the caller — pure function, never throws)", () => {
    expect(Number.isNaN(timeStringToMinutes("not-a-time"))).toBe(true);
    expect(Number.isNaN(timeStringToMinutes(""))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Rendering branches
// ---------------------------------------------------------------------------
describe("ServiceHoursEditor — rendering branches", () => {
  it("renders the 7 day rows (Lundi → Dimanche) so the gérant sees the whole week at a glance", () => {
    const tree = serialize(ServiceHoursEditor(makeProps()));
    const text = allText(tree);
    // The week starts on MONDAY (FR convention), ends on SUNDAY.
    expect(text).toMatch(/Lundi/);
    expect(text).toMatch(/Mardi/);
    expect(text).toMatch(/Mercredi/);
    expect(text).toMatch(/Jeudi/);
    expect(text).toMatch(/Vendredi/);
    expect(text).toMatch(/Samedi/);
    expect(text).toMatch(/Dimanche/);
  });

  it("renders the Enregistrer button + the form wrapper with stable data-slots", () => {
    const tree = serialize(ServiceHoursEditor(makeProps()));
    const slots = dataSlots(tree);
    expect(slots).toContain("parametres-service-hours-form");
    expect(slots).toContain("parametres-service-hours-save");
  });

  it("each day row carries a stable data-slot keyed on the dayOfWeek (0=Sun..6=Sat — JS convention, matches the backend `serviceWindow`)", () => {
    const tree = serialize(ServiceHoursEditor(makeProps()));
    const slots = dataSlots(tree);
    for (let d = 0; d <= 6; d += 1) {
      expect(slots).toContain(`parametres-service-hours-day-${d}`);
    }
  });

  it("each day row exposes an « Ajouter un créneau » button (data-slot per day)", () => {
    const tree = serialize(ServiceHoursEditor(makeProps()));
    const slots = dataSlots(tree);
    for (let d = 0; d <= 6; d += 1) {
      expect(slots).toContain(`parametres-service-hours-day-${d}-add`);
    }
  });

  it("renders the seeded windows — BB-style 11:30 → 14:00 + 18:30 → 22:00 on Monday", () => {
    const tree = serialize(
      ServiceHoursEditor(
        makeProps({
          value: [
            { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
            { dayOfWeek: 1, startMinute: 18 * 60 + 30, endMinute: 22 * 60 },
          ],
        }),
      ),
    );
    const slots = dataSlots(tree);
    // Two slot rows under Monday (dayOfWeek = 1).
    const slotMatches = slots.filter((s) =>
      s.startsWith("parametres-service-hours-slot-"),
    );
    expect(slotMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("AC — when a seeded window is INVALID (e.g. overlap), an inline error data-slot surfaces under the offending slot", () => {
    const tree = serialize(
      ServiceHoursEditor(
        makeProps({
          value: [
            { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
            { dayOfWeek: 1, startMinute: 13 * 60 + 59, endMinute: 18 * 60 },
          ],
        }),
      ),
    );
    const slots = dataSlots(tree);
    const errorSlots = slots.filter((s) =>
      s.startsWith("parametres-service-hours-slot-error-"),
    );
    expect(errorSlots.length).toBeGreaterThan(0);
  });

  it("AC — Save button is DISABLED when at least one validation error is present (« bouton Enregistrer désactivé »)", () => {
    const tree = serialize(
      ServiceHoursEditor(
        makeProps({
          value: [
            // start === end — invalid
            { dayOfWeek: 1, startMinute: 12 * 60, endMinute: 12 * 60 },
          ],
        }),
      ),
    );
    const saveButton = findBySlot(tree, "parametres-service-hours-save");
    expect(saveButton).not.toBeNull();
    if (saveButton !== null && !("text" in saveButton)) {
      expect(saveButton.props["disabled"]).toBe(true);
    }
  });

  it("AC — Save button is ENABLED on an empty (all-deleted) state — an empty list is a legit save (« fermé toute la semaine »)", () => {
    const tree = serialize(ServiceHoursEditor(makeProps({ value: [] })));
    const saveButton = findBySlot(tree, "parametres-service-hours-save");
    expect(saveButton).not.toBeNull();
    if (saveButton !== null && !("text" in saveButton)) {
      expect(saveButton.props["disabled"]).not.toBe(true);
    }
  });

  it("AC — Save button is ENABLED on a valid populated state", () => {
    const tree = serialize(
      ServiceHoursEditor(
        makeProps({
          value: [
            { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
          ],
        }),
      ),
    );
    const saveButton = findBySlot(tree, "parametres-service-hours-save");
    if (saveButton !== null && !("text" in saveButton)) {
      expect(saveButton.props["disabled"]).not.toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Save flow
// ---------------------------------------------------------------------------
describe("ServiceHoursEditor — save flow", () => {
  it("AC — Save → onSave(windows) called with the ENTIRE current windows list (the backend mutation is an UPSERT replace, not a patch)", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      ServiceHoursEditor(
        makeProps({
          value: [
            { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
          ],
          onSave,
        }),
      ),
    );
    const formNode = findBySlot(tree, "parametres-service-hours-form");
    expect(formNode).not.toBeNull();
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith([
      { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
    ]);
  });

  it("AC — programmatic Submit with INVALID state is REFUSED (defence in depth on top of the disabled button)", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      ServiceHoursEditor(
        makeProps({
          value: [{ dayOfWeek: 1, startMinute: 12 * 60, endMinute: 12 * 60 }],
          onSave,
        }),
      ),
    );
    const formNode = findBySlot(tree, "parametres-service-hours-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).not.toHaveBeenCalled();
  });

  it("AC — save error → inline submit-error surface (no swallow, no crash)", async () => {
    const failure = new Error("FORBIDDEN: cross-tenant");
    const onSave = vi.fn(async () => {
      throw failure;
    });
    const tree = serialize(
      ServiceHoursEditor(
        makeProps({
          value: [
            { dayOfWeek: 1, startMinute: 11 * 60 + 30, endMinute: 14 * 60 },
          ],
          onSave,
        }),
      ),
    );
    const formNode = findBySlot(tree, "parametres-service-hours-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      // Must NOT throw — the editor catches and surfaces inline.
      await expect(
        onSubmit?.({ preventDefault: () => {} }),
      ).resolves.not.toThrow();
    }
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("AC — save empty windows (« fermé toute la semaine ») reaches onSave with an empty array (a legitimate state — the backend accepts it)", async () => {
    const onSave = vi.fn(async () => {});
    const tree = serialize(
      ServiceHoursEditor(makeProps({ value: [], onSave })),
    );
    const formNode = findBySlot(tree, "parametres-service-hours-form");
    if (formNode !== null && !("text" in formNode)) {
      const onSubmit = formNode.props["onSubmit"] as
        | ((e: { preventDefault: () => void }) => Promise<void>)
        | undefined;
      await onSubmit?.({ preventDefault: () => {} });
    }
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith([]);
  });
});
