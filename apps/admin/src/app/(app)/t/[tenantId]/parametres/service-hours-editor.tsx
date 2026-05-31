"use client";

/**
 * F-PARAMETRES-05 (#236) — `ServiceHoursEditor`, the section éditeur for
 * « Horaires de service » on the tenant Paramètres page (last slice of
 * EPIC F-PARAMETRES #148).
 *
 * Stand-alone reusable deep module, mirrors the design of
 * `branding-editor.tsx` (#229), `coordonnees-editor.tsx` (#231) and
 * `modes-editor.tsx` (#234): a narrow `{ value, onSave }` contract, an
 * isolated local state (user story 9 — save isolé : un échec sur cette
 * section ne perd pas les inputs en cours sur d'autres sections), and no
 * coupling to the URL / tenant context / backend api (so a future surface
 * — e.g. F-WIZARD step 6 « Horaires » — can mount it without rework).
 *
 * What it owns
 * ------------
 *   - A 7-day grid (Lundi → Dimanche, FR convention) where each row lists
 *     ALL the windows configured for that day. Within a row, slots are
 *     displayed in the order the user added them (V1 = insertion order,
 *     EPIC #148 « Out of Scope » — drag reordering = V2). Each slot has
 *     two time-pickers (start / end, `<input type="time">`) and a remove
 *     button. Each day row exposes an « Ajouter un créneau » button.
 *   - The PURE validator `validateServiceWindows` — extracted and exported
 *     so the unit suite can pin every limit case (AC clé : « validation
 *     pure côté front, fonction extraite et testable isolément »). The
 *     three product rules from the issue body:
 *      * `startMinute < endMinute` (égalité interdite),
 *      * pas de chevauchement intra-jour (deux créneaux qui se recouvrent
 *        par ≥1 minute — touch-at-boundary stays valid because the backend
 *        treats `end` as EXCLUSIVE, cf. `isWithinServiceHours`),
 *      * pas de cross-midnight (créneau qui passe minuit — encoded as the
 *        out-of-bounds check on minute values, V1 windows ∈ [0, 1440]).
 *     Mirrors the backend's `assertServiceWindows` (cf.
 *     `convex/lib/menu/serviceHours.ts`) — the front-side gate prevents an
 *     invalid save from ever reaching the network.
 *   - The PURE formatters `minutesToTimeString` /
 *     `timeStringToMinutes` — bridge between the backend's int-minute
 *     model and the HTML `<input type="time">` `HH:MM` wire format.
 *     Round-trip safe over every minute (exported for the unit test).
 *   - The save flow — `onSave(windows)` receives the ENTIRE current
 *     windows array. The backend mutation `serviceHours.set({ windows })`
 *     is an UPSERT atomic replace (one row per tenant carries the full
 *     list, cf. `table/serviceHours.ts`), so a patch shape is unnecessary
 *     and would actually be wrong — we forward the whole array.
 *   - The Save button DISABLED state (« bouton Enregistrer désactivé tant
 *     qu'il y a des erreurs ») + the inline error surface per offending
 *     slot via a stable `data-slot` consumers can target.
 *
 * What it does NOT own
 * --------------------
 *   - The toast (page-level concern, consistent with sibling editors).
 *   - The tenantId / mutation wiring (the page does both, the editor
 *     stays UI-only — reusable across surfaces).
 *
 * Empty state
 * -----------
 * An empty windows list is a LEGITIMATE state (« le resto est fermé toute
 * la semaine pour l'instant » / a fresh tenant before onboarding step 6).
 * The backend's `isOpenNow` returns `false` for an empty list — the
 * checkout simply blocks. The Save button stays ENABLED on an empty list
 * so the gérant can wipe his schedule (e.g. seasonal closure) without
 * being trapped.
 *
 * Day-of-week convention
 * ----------------------
 * The backend's `serviceWindow.dayOfWeek` follows the JS `Date.getDay()`
 * convention: 0 = Sunday … 6 = Saturday (cf. `table/serviceHours.ts` AND
 * `WEEKDAY_INDEX` in `lib/menu/serviceHours.ts`). The UI however shows
 * Monday FIRST (FR convention) — so the rendered row order is
 * `[1, 2, 3, 4, 5, 6, 0]` while each row's `dayOfWeek` field still
 * carries the JS index. This is purely a presentation choice; the
 * persisted shape is unchanged.
 *
 * Scope discipline (#236 hard constraint, mirrors sibling editors): this
 * file lives under `apps/admin/src/app/(app)/t/[tenantId]/parametres/`.
 * Zero coupling to the backend api / Convex hooks / tenant context —
 * pinned by `service-hours-editor.test.tsx`'s source-level guards.
 */

import { useState } from "react";
import { IconPlus, IconTrash } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// ---------------------------------------------------------------------------
// Public types — frozen by the issue body. Mirrors the backend
// `serviceWindow` (cf. `packages/backend/convex/table/serviceHours.ts`).
// We re-declare locally to avoid an import from `@packages/backend` (the
// editor is presentation-only — same discipline as `branding-editor.tsx`).
// ---------------------------------------------------------------------------

/** One open window. `dayOfWeek`: 0 = Sunday … 6 = Saturday (JS
 *  `Date.getDay()` convention, matches the backend schema).
 *  `startMinute` / `endMinute`: minutes from local midnight (0..1440),
 *  `start < end`. */
export type ServiceWindow = {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
};

export type ServiceHoursEditorProps = {
  /**
   * The current persisted windows — seeds the local state on first
   * render. An empty list is legitimate (« fermé toute la semaine » or
   * a fresh tenant).
   */
  value: ServiceWindow[];
  /**
   * Commit handler — receives the ENTIRE current windows list. The
   * backend mutation is an UPSERT replace (one row per tenant carries
   * the full list), so the editor forwards the whole array — never a
   * patch. Page-side wiring:
   * `useTenantMutation(api.lib.menu.serviceHours.set)`.
   */
  onSave: (windows: ServiceWindow[]) => Promise<void>;
};

// ---------------------------------------------------------------------------
// Pure validator — the three product rules from the issue body, encoded
// as a function that returns a list of typed errors (so the UI can
// surface ONE inline message PER offending slot, not first-error-only).
// ---------------------------------------------------------------------------

/** The 1440-minute exclusive upper bound (24 * 60). A window may END at
 *  exactly 1440 (24:00), but no minute value > 1440 is accepted (would
 *  be a cross-midnight window, forbidden in V1). */
const MINUTES_PER_DAY = 1440;

/** Typed error kinds — the UI can branch on `kind` to render a
 *  contextual message, and the test can assert on the kind without
 *  reading the user-facing copy. */
export type ServiceHoursValidationError =
  | {
      kind: "OUT_OF_BOUNDS";
      windowIndex: number;
    }
  | {
      kind: "INVALID_DAY";
      windowIndex: number;
    }
  | {
      kind: "START_AFTER_OR_EQUAL_END";
      windowIndex: number;
    }
  | {
      kind: "OVERLAP";
      windowIndex: number;
      /** The OTHER conflicting window (so the UI can highlight both). */
      otherWindowIndex: number;
    };

export type ServiceHoursValidationResult = {
  isValid: boolean;
  errors: ServiceHoursValidationError[];
};

/**
 * Validate a windows list against the three product rules:
 *   1. `dayOfWeek` ∈ [0..6] (JS convention, matches the backend).
 *   2. `startMinute` / `endMinute` ∈ [0..1440] (inclusive upper bound
 *      = 24:00 exclusive minute), `startMinute < endMinute` (no
 *      cross-midnight, no zero-length window).
 *   3. No two windows on the SAME day overlap by ≥1 minute. Touch at
 *      the boundary (end_A === start_B) is VALID — `end` is exclusive
 *      in `isWithinServiceHours`.
 *
 * Returns ALL errors found (the UI surfaces one inline message per
 * offending slot — not first-error-only).
 */
export function validateServiceWindows(
  windows: ServiceWindow[],
): ServiceHoursValidationResult {
  const errors: ServiceHoursValidationError[] = [];

  // Per-window bounds + day + ordering checks. We push at most one
  // bounds/order error per window so the inline messaging stays
  // unambiguous (the user fixes one thing at a time).
  for (let i = 0; i < windows.length; i += 1) {
    const w = windows[i];
    if (!Number.isInteger(w.dayOfWeek) || w.dayOfWeek < 0 || w.dayOfWeek > 6) {
      errors.push({ kind: "INVALID_DAY", windowIndex: i });
      continue;
    }
    if (
      !Number.isInteger(w.startMinute) ||
      !Number.isInteger(w.endMinute) ||
      w.startMinute < 0 ||
      w.endMinute < 0 ||
      w.startMinute > MINUTES_PER_DAY ||
      w.endMinute > MINUTES_PER_DAY
    ) {
      errors.push({ kind: "OUT_OF_BOUNDS", windowIndex: i });
      continue;
    }
    if (w.startMinute >= w.endMinute) {
      errors.push({ kind: "START_AFTER_OR_EQUAL_END", windowIndex: i });
    }
  }

  // Intra-day overlap — O(n²) over a small list (a typical resto has
  // < 14 windows, well within an acceptable budget). Two windows
  // overlap iff they share the same `dayOfWeek` AND
  // `start_a < end_b AND start_b < end_a` (touch at the boundary is NOT
  // an overlap — `end` is exclusive).
  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      const a = windows[i];
      const b = windows[j];
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      const overlaps =
        a.startMinute < b.endMinute && b.startMinute < a.endMinute;
      if (overlaps) {
        errors.push({
          kind: "OVERLAP",
          windowIndex: i,
          otherWindowIndex: j,
        });
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Pure formatters — bridge between the backend int-minute model and the
// HTML `<input type="time">` `HH:MM` wire format. Both exported so the
// unit suite can pin the round-trip in isolation.
// ---------------------------------------------------------------------------

/**
 * Format a minute count as `HH:MM`. `1440` formats as `"24:00"` (the
 * exclusive upper bound — NEVER wraps to `"00:00"`, which would be the
 * next day). Values outside [0, 1440] are clamped via simple integer
 * conversion: the caller is responsible for passing a valid range
 * (the validator catches out-of-bounds before this formatter is hit).
 */
export function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(mins).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Parse an `HH:MM` time string into minutes from midnight. Returns `NaN`
 * for garbage input (empty string, non-numeric characters, malformed
 * shape) — the caller branches on `Number.isNaN`. Accepts `"24:00"`
 * (the exclusive upper bound — a window may END at exactly 24:00).
 */
export function timeStringToMinutes(value: string): number {
  // Reject empty / whitespace-only.
  if (value.length === 0) return Number.NaN;
  // Strict HH:MM shape — two digits, colon, two digits.
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (match === null) return Number.NaN;
  const hours = Number.parseInt(match[1], 10);
  const mins = Number.parseInt(match[2], 10);
  if (Number.isNaN(hours) || Number.isNaN(mins)) return Number.NaN;
  // Reject ranges outside [0..24] hours or [0..59] minutes; allow 24:00
  // exactly.
  if (hours < 0 || hours > 24) return Number.NaN;
  if (mins < 0 || mins > 59) return Number.NaN;
  if (hours === 24 && mins !== 0) return Number.NaN;
  return hours * 60 + mins;
}

// ---------------------------------------------------------------------------
// Day labels — FR week order (Monday first).
// ---------------------------------------------------------------------------

/** The 7 day rows in FR display order. `dayOfWeek` carries the JS
 *  convention (0 = Sunday … 6 = Saturday) so it matches the backend
 *  schema unchanged; only the rendering order is FR-style. */
const WEEK_DAYS: ReadonlyArray<{ dayOfWeek: number; label: string }> = [
  { dayOfWeek: 1, label: "Lundi" },
  { dayOfWeek: 2, label: "Mardi" },
  { dayOfWeek: 3, label: "Mercredi" },
  { dayOfWeek: 4, label: "Jeudi" },
  { dayOfWeek: 5, label: "Vendredi" },
  { dayOfWeek: 6, label: "Samedi" },
  { dayOfWeek: 0, label: "Dimanche" },
];

// ---------------------------------------------------------------------------
// Editor component
// ---------------------------------------------------------------------------

/** Default slot a new « Ajouter un créneau » row inserts — a noon window
 *  matches the most common FR service (lunch service). The user
 *  immediately edits the times, so the default just has to be
 *  syntactically valid. */
const DEFAULT_NEW_SLOT = {
  startMinute: 12 * 60,
  endMinute: 14 * 60,
} as const;

export function ServiceHoursEditor({
  value,
  onSave,
}: ServiceHoursEditorProps): React.ReactElement {
  // Local state — owns the in-flight edits. The editor is NOT a
  // controlled component (`value` only seeds the initial state); a
  // future Convex refresh during edit would otherwise wipe the user's
  // input. Same isolation as sibling editors (user story 9).
  const [windows, setWindows] = useState<ServiceWindow[]>(() =>
    value.map((w) => ({ ...w })),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const validation = validateServiceWindows(windows);

  // Build a Set<windowIndex> of slots that carry at least one error,
  // so the per-slot inline marker can be rendered without re-scanning
  // the error array per render.
  const indicesWithError = new Set<number>();
  for (const err of validation.errors) {
    indicesWithError.add(err.windowIndex);
    if (err.kind === "OVERLAP") indicesWithError.add(err.otherWindowIndex);
  }

  const updateSlot = (
    index: number,
    patch: Partial<Pick<ServiceWindow, "startMinute" | "endMinute">>,
  ): void => {
    setWindows((prev) =>
      prev.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    );
  };

  const removeSlot = (index: number): void => {
    setWindows((prev) => prev.filter((_, i) => i !== index));
  };

  const addSlot = (dayOfWeek: number): void => {
    setWindows((prev) => [
      ...prev,
      {
        dayOfWeek,
        startMinute: DEFAULT_NEW_SLOT.startMinute,
        endMinute: DEFAULT_NEW_SLOT.endMinute,
      },
    ]);
  };

  const onSubmit = async (
    e: { preventDefault?: () => void } | undefined,
  ): Promise<void> => {
    if (e?.preventDefault !== undefined) e.preventDefault();
    setSubmitError(null);
    // Defence in depth — the button is also disabled, but a
    // programmatic submit could bypass that.
    if (!validation.isValid) return;
    setIsSubmitting(true);
    try {
      await onSave(windows);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Échec de l'enregistrement, réessayez.";
      setSubmitError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      data-slot="parametres-service-hours-form"
      onSubmit={onSubmit}
      className="flex flex-col gap-6"
    >
      <h2 className="sr-only">Horaires de service</h2>

      <div className="flex flex-col gap-4">
        {WEEK_DAYS.map((day) => {
          // Per-day slots, paired with their absolute index in the
          // master `windows` array (so updates/removes target the
          // right row without rebuilding indices on every render).
          const daySlots = windows
            .map((w, index) => ({ window: w, index }))
            .filter((s) => s.window.dayOfWeek === day.dayOfWeek);

          return (
            <DayRow
              key={day.dayOfWeek}
              dayOfWeek={day.dayOfWeek}
              label={day.label}
              slots={daySlots}
              errorIndices={indicesWithError}
              errors={validation.errors}
              onAdd={() => {
                addSlot(day.dayOfWeek);
              }}
              onUpdate={updateSlot}
              onRemove={removeSlot}
            />
          );
        })}
      </div>

      {submitError !== null ? (
        <p
          data-slot="parametres-service-hours-submit-error"
          className="text-destructive text-sm"
        >
          {submitError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button
          type="submit"
          data-slot="parametres-service-hours-save"
          disabled={isSubmitting || !validation.isValid}
        >
          Enregistrer
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Per-day row — pulled out so the parent stays readable. Pure
// presentational + thin callbacks back to the parent.
// ---------------------------------------------------------------------------

function DayRow({
  dayOfWeek,
  label,
  slots,
  errorIndices,
  errors,
  onAdd,
  onUpdate,
  onRemove,
}: {
  dayOfWeek: number;
  label: string;
  slots: ReadonlyArray<{ window: ServiceWindow; index: number }>;
  errorIndices: ReadonlySet<number>;
  errors: ReadonlyArray<ServiceHoursValidationError>;
  onAdd: () => void;
  onUpdate: (
    index: number,
    patch: Partial<Pick<ServiceWindow, "startMinute" | "endMinute">>,
  ) => void;
  onRemove: (index: number) => void;
}): React.ReactElement {
  return (
    <div
      data-slot={`parametres-service-hours-day-${dayOfWeek}`}
      className="flex flex-col gap-2 rounded-lg border p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-semibold">{label}</Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-slot={`parametres-service-hours-day-${dayOfWeek}-add`}
          onClick={onAdd}
        >
          <IconPlus className="size-4" aria-hidden="true" />
          Ajouter un créneau
        </Button>
      </div>

      {slots.length === 0 ? (
        <p
          data-slot={`parametres-service-hours-day-${dayOfWeek}-empty`}
          className="text-muted-foreground text-xs"
        >
          Fermé
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {slots.map((s) => {
            const slotErrors = errors.filter(
              (err) =>
                err.windowIndex === s.index ||
                (err.kind === "OVERLAP" && err.otherWindowIndex === s.index),
            );
            const hasError = errorIndices.has(s.index);
            return (
              <li
                key={s.index}
                data-slot={`parametres-service-hours-slot-${s.index}`}
                className="flex flex-col gap-1"
              >
                <div className="flex items-center gap-2">
                  <Input
                    type="time"
                    data-slot={`parametres-service-hours-slot-${s.index}-start`}
                    aria-label="Début"
                    aria-invalid={hasError || undefined}
                    value={minutesToTimeString(s.window.startMinute)}
                    step={60}
                    onChange={(e) => {
                      const parsed = timeStringToMinutes(e.target.value);
                      if (!Number.isNaN(parsed)) {
                        onUpdate(s.index, { startMinute: parsed });
                      }
                    }}
                  />
                  <span aria-hidden="true" className="text-muted-foreground">
                    →
                  </span>
                  <Input
                    type="time"
                    data-slot={`parametres-service-hours-slot-${s.index}-end`}
                    aria-label="Fin"
                    aria-invalid={hasError || undefined}
                    value={minutesToTimeString(s.window.endMinute)}
                    step={60}
                    onChange={(e) => {
                      const parsed = timeStringToMinutes(e.target.value);
                      if (!Number.isNaN(parsed)) {
                        onUpdate(s.index, { endMinute: parsed });
                      }
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-slot={`parametres-service-hours-slot-${s.index}-remove`}
                    aria-label="Supprimer le créneau"
                    onClick={() => {
                      onRemove(s.index);
                    }}
                  >
                    <IconTrash className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                {hasError ? (
                  <p
                    data-slot={`parametres-service-hours-slot-error-${s.index}`}
                    className="text-destructive text-xs"
                  >
                    {slotErrors.map((err) => slotErrorMessage(err)).join(" · ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** User-facing copy per error kind. */
function slotErrorMessage(error: ServiceHoursValidationError): string {
  switch (error.kind) {
    case "START_AFTER_OR_EQUAL_END":
      return "Le début doit être strictement avant la fin.";
    case "OVERLAP":
      return "Ce créneau chevauche un autre créneau du même jour.";
    case "OUT_OF_BOUNDS":
      return "L'heure doit être comprise entre 00:00 et 24:00 (sans passer minuit).";
    case "INVALID_DAY":
      return "Jour invalide.";
  }
}
