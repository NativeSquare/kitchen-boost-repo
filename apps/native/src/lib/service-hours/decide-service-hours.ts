/**
 * #409 — pure decision functions for the home « Modif horaires d'ouverture »
 * screen (PRD 20 §7d + ADR 0018, frontière disponibilité commerciale vs
 * édition catalogue). Same split convention as `decideClosureControl`
 * (#407), `decidePauseControl` (#406), `decideForceUpdate` (#394),
 * `decideTenantSwitcher` (#399), `decideItemAvailability` (#408): React,
 * Expo and Convex stay OUT so the truth table is pinned by a fast
 * deterministic vitest suite (node env, no jsdom, no native mocks).
 *
 * What this story carries
 * -----------------------
 * Le KB Manager peut, depuis l'app native, ajuster les créneaux d'ouverture
 * « ici et maintenant » :
 *
 *   - **Aujourd'hui** — vue rapide qui n'expose QUE les créneaux du jour
 *     courant (resté en Europe/Paris, FR-only V1). Cas d'usage : « ce soir
 *     on ferme à 22h au lieu de 23h », « un seul cuisinier de service →
 *     réduction du créneau du soir ». Mutation : un `set` qui remplace les
 *     créneaux du jour courant tout en préservant ceux des 6 autres jours
 *     (UPSERT atomique côté backend, cf. `serviceHours.set`).
 *
 *   - **Cette semaine** — vue grille hebdo standard (Lun → Dim, FR order),
 *     7 rows + N créneaux chacun. Édition « posée mais terrain » : un
 *     gérant peut typiquement ajuster son weekend ouvert depuis l'app, sans
 *     ouvrir KB Admin sur grand écran.
 *
 * Édition complète des horaires permanents (jours fériés annuels) reste
 * **KB Admin seul** (ADR 0018) — pas dans cette story. La frontière
 * « fréquence × urgence × granularité » de l'ADR 0018 reste :
 *
 *   - Modif horaires du jour / de la semaine → app native (acté ici)
 *   - Holiday rules, jours fériés annuels → KB Admin seul (out of scope V1)
 *
 * Source de vérité unique
 * -----------------------
 * Le backend `api.lib.menu.serviceHours.get` / `.set` est posé par
 * `2.2-E` (chantier `lib/menu/serviceHours.ts`) ET réutilisé par #397 côté
 * KB Admin (mirror `service-hours-editor.tsx`). Le state Convex partagé
 * fait le reste : un changement KB Admin se reflète en temps réel côté
 * native (et inversement). Pas de nouvelle table, pas de mutation
 * `setTenantHoursOverride` séparée — la mutation `set` remplace l'ENTIER
 * `windows[]` (atomic replace, UPSERT par tenant). La défense en
 * profondeur côté backend (`assertServiceWindows`) reste la source de
 * vérité — l'UI native fait la validation côté front pour l'UX, mais elle
 * ne peut pas être contournée côté serveur.
 *
 * Trois verdicts pour la query `get`
 * ----------------------------------
 *   - `loading` — Convex sub en flight (`hours === undefined`). Spinner
 *     discret + label « Chargement des horaires… ». Surfacer le formulaire
 *     vide avant ce verdict flashes la mauvaise grille (« le resto est
 *     fermé toute la semaine » alors qu'il y a des créneaux configurés).
 *
 *   - `ready` — `windows[]` chargé (peut être vide, c'est légitime — le
 *     resto n'a pas encore configuré ses horaires). L'éditeur affiche la
 *     grille avec les créneaux + le bouton « Ajouter un créneau » par jour.
 *
 * Validation côté front (mirror du backend `assertServiceWindows`)
 * ----------------------------------------------------------------
 * Les TROIS règles produit, encodées en pure function pour que les unit
 * tests pinnent chaque cas limite (AC clé : « validation pure côté front,
 * fonction extraite et testable isolément ») :
 *
 *   1. `dayOfWeek` ∈ [0..6] (JS getDay convention, 0=Sun … 6=Sat, mirror
 *      du backend).
 *   2. `startMinute` / `endMinute` ∈ [0..1440] (inclusive upper bound =
 *      24:00 exclusive minute), `startMinute < endMinute` (pas de
 *      cross-midnight V1 ; pas de créneau vide).
 *   3. Pas de chevauchement intra-jour (deux créneaux qui se recouvrent
 *      par ≥1 minute — touch-at-boundary stays valid because the backend
 *      treats `end` as EXCLUSIVE, cf. `isWithinServiceHours`).
 *
 * Le validator retourne TOUTES les erreurs (un message inline par créneau
 * fautif — pas first-error-only) pour que le gérant voie d'un coup ce qui
 * cloche sur sa grille.
 *
 * Pure / déterministe
 * -------------------
 * Aucun `Date.now()` interne : la projection « quel jour est aujourd'hui
 * en Europe/Paris ? » prend `nowMs` en argument (le composant le passe via
 * `Date.now()` au moment du rendu). Permet aux tests de pinner des dates
 * précises (été CEST, hiver CET, transitions DST) sans flakiness.
 */

import type { ServiceWindow } from "@packages/backend/convex/table/serviceHours";

/** Re-export the backend shape so the screen can talk in `ServiceWindow`
 *  without re-declaring the type (single source of truth — the schema). */
export type { ServiceWindow };

/** Result of `serviceHours.get` as the editor consumes it. */
export type ServiceHoursValue = { windows: ServiceWindow[] };

/** The Convex query sentinel + the loaded value. */
export type ServiceHoursQueryResult = ServiceHoursValue | undefined;

/** The two segments the screen toggles between (PRD 20 §7d). */
export const SERVICE_HOURS_SEGMENTS = ["today", "week"] as const;
export type ServiceHoursSegment = (typeof SERVICE_HOURS_SEGMENTS)[number];

/** The pure decision: what does the screen render this frame? */
export type ServiceHoursDecision =
  /** Convex sub still resolving — render a discreet placeholder. */
  | { kind: "loading" }
  /** Hours loaded — render the editor. `windows` is the in-flight value the
   *  editor seeds local state with; the screen owns its own state once
   *  loaded so a Convex refresh during edit does not wipe user input. */
  | { kind: "ready"; windows: ServiceWindow[] };

/** Decide what the « Modif horaires » screen renders. PURE. */
export function decideServiceHoursScreen(
  hours: ServiceHoursQueryResult,
): ServiceHoursDecision {
  if (hours === undefined) return { kind: "loading" };
  return { kind: "ready", windows: hours.windows };
}

// ---------------------------------------------------------------------------
// "Today" projection — Europe/Paris-aware
// ---------------------------------------------------------------------------

/** Europe/Paris is the V1 timezone (FR-only). Same constant as the backend
 *  `serviceHours.ts` so a window projected with `parisDayOfWeek` matches
 *  the one `isWithinServiceHours` consumes. */
const PARIS_TZ = "Europe/Paris";

/** Mirror of the backend `WEEKDAY_INDEX` (`lib/menu/serviceHours.ts`). */
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Project an epoch ms to the Europe/Paris `dayOfWeek` (0=Sun..6=Sat,
 * JS convention). Mirror of the backend `parisLocalParts` — keeps DST
 * correct (the IANA tz database resolved by `Intl.DateTimeFormat` matches
 * what the backend uses to gate `isOpenNow`).
 *
 * Deterministic for a given `nowMs` (no hidden wall-clock) so the unit
 * suite can pin summer (CEST) AND winter (CET) instants. PURE.
 */
export function parisDayOfWeek(nowMs: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TZ,
    weekday: "short",
  }).formatToParts(new Date(nowMs));
  for (const part of parts) {
    if (part.type === "weekday") {
      return WEEKDAY_INDEX[part.value] ?? 0;
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Today vs week filtering
// ---------------------------------------------------------------------------

/**
 * Filter the full windows list down to the créneaux du jour courant (Paris).
 * PURE — pinned in the test suite for the boundaries (DST instants + UTC
 * day flip).
 */
export function filterTodayWindows(
  windows: ServiceWindow[],
  nowMs: number,
): ServiceWindow[] {
  const today = parisDayOfWeek(nowMs);
  return windows.filter((w) => w.dayOfWeek === today);
}

/**
 * Merge the « créneaux du jour » edits back into the FULL windows list,
 * preserving the créneaux des 6 autres jours unchanged. Used by the
 * « Aujourd'hui » segment when the gérant saves: the editor only knows
 * about today, but the backend mutation replaces the ENTIRE windows array
 * (UPSERT atomic), so we need to recompose.
 *
 * Order : non-today entries kept in their original insertion order,
 * suivies des `todayWindows` édités (insertion order V1 = ce que l'éditeur
 * vient de produire, EPIC #148 « Out of Scope » — drag reordering = V2).
 *
 * PURE.
 */
export function mergeTodayWindowsIntoWeek(
  fullWindows: ServiceWindow[],
  todayWindows: ServiceWindow[],
  nowMs: number,
): ServiceWindow[] {
  const today = parisDayOfWeek(nowMs);
  const otherDays = fullWindows.filter((w) => w.dayOfWeek !== today);
  return [...otherDays, ...todayWindows];
}

// ---------------------------------------------------------------------------
// Validator — mirror of backend `assertServiceWindows` (defence in depth)
// ---------------------------------------------------------------------------

/** Minute upper bound (24 * 60). A window MAY end at exactly 1440 (24:00). */
const MINUTES_PER_DAY = 1440;

/** Typed error kinds — the UI branches on `kind` to render a contextual
 *  message; tests assert on the kind without coupling to user copy. */
export type ServiceHoursValidationError =
  | { kind: "OUT_OF_BOUNDS"; windowIndex: number }
  | { kind: "INVALID_DAY"; windowIndex: number }
  | { kind: "START_AFTER_OR_EQUAL_END"; windowIndex: number }
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
 * Validate a windows list against the three product rules. Returns ALL
 * errors found (the UI surfaces one inline message per offending slot —
 * not first-error-only). PURE.
 *
 * Mirror of the backend `assertServiceWindows` (cf.
 * `convex/lib/menu/serviceHours.ts`) — the front-side gate prevents an
 * invalid save from ever reaching the network. Backend reste la source de
 * vérité (défense en profondeur).
 */
export function validateServiceWindows(
  windows: ServiceWindow[],
): ServiceHoursValidationResult {
  const errors: ServiceHoursValidationError[] = [];

  // Per-window bounds + day + ordering checks. At most one bounds/order
  // error per window so the inline messaging stays unambiguous.
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

  // Intra-day overlap — O(n²) over a small list (< 14 windows typical).
  // Touch-at-boundary stays VALID (`end` exclusive in
  // `isWithinServiceHours`).
  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      const a = windows[i];
      const b = windows[j];
      if (a.dayOfWeek !== b.dayOfWeek) continue;
      const overlaps =
        a.startMinute < b.endMinute && b.startMinute < a.endMinute;
      if (overlaps) {
        errors.push({ kind: "OVERLAP", windowIndex: i, otherWindowIndex: j });
      }
    }
  }

  return { isValid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Pure formatters — bridge between the backend int-minute model and the
// `HH:MM` text shape the native text inputs render. Same shape as the
// admin `minutesToTimeString` / `timeStringToMinutes` (mirror discipline
// across surfaces — a window saved on KB Admin reads identically here).
// ---------------------------------------------------------------------------

/**
 * Format a minute count as `HH:MM`. `1440` formats as `"24:00"` (the
 * exclusive upper bound — NEVER wraps to `"00:00"`, which would be the
 * next day). PURE.
 */
export function minutesToTimeString(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const hh = String(hours).padStart(2, "0");
  const mm = String(mins).padStart(2, "0");
  return `${hh}:${mm}`;
}

/**
 * Parse an `HH:MM` text string into minutes from midnight. Returns `NaN`
 * for garbage input (empty string, non-numeric, malformed shape, hour > 24,
 * minute > 59). Accepts exactly `"24:00"` (the exclusive upper bound — a
 * window may END at 24:00). PURE.
 */
export function timeStringToMinutes(value: string): number {
  if (value.length === 0) return Number.NaN;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (match === null) return Number.NaN;
  const hours = Number.parseInt(match[1], 10);
  const mins = Number.parseInt(match[2], 10);
  if (Number.isNaN(hours) || Number.isNaN(mins)) return Number.NaN;
  if (hours < 0 || hours > 24) return Number.NaN;
  if (mins < 0 || mins > 59) return Number.NaN;
  if (hours === 24 && mins !== 0) return Number.NaN;
  return hours * 60 + mins;
}

// ---------------------------------------------------------------------------
// Day labels — FR display order (Monday first)
// ---------------------------------------------------------------------------

/**
 * The 7 day rows in FR display order. `dayOfWeek` carries the JS
 * convention (0 = Sunday … 6 = Saturday) so it matches the backend schema
 * unchanged; only the rendering order is FR-style.
 *
 * Mirror of the admin `WEEK_DAYS` array (`service-hours-editor.tsx`) —
 * exposed as a constant so the test suite can assert the order.
 */
export const WEEK_DAYS: readonly { dayOfWeek: number; label: string }[] = [
  { dayOfWeek: 1, label: "Lundi" },
  { dayOfWeek: 2, label: "Mardi" },
  { dayOfWeek: 3, label: "Mercredi" },
  { dayOfWeek: 4, label: "Jeudi" },
  { dayOfWeek: 5, label: "Vendredi" },
  { dayOfWeek: 6, label: "Samedi" },
  { dayOfWeek: 0, label: "Dimanche" },
];

/** Lookup helper — returns the French day name for a given JS dayOfWeek. */
export function dayLabel(dayOfWeek: number): string {
  for (const d of WEEK_DAYS) {
    if (d.dayOfWeek === dayOfWeek) return d.label;
  }
  return "Inconnu";
}

/** Default slot a new « Ajouter un créneau » row inserts — a noon window
 *  matches the most common FR lunch service. The user immediately edits
 *  the times; the default just has to be syntactically valid. Mirror of
 *  the admin `DEFAULT_NEW_SLOT`. */
export const DEFAULT_NEW_SLOT = {
  startMinute: 12 * 60,
  endMinute: 14 * 60,
} as const;
