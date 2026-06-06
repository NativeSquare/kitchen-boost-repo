/**
 * #407 — pure decision functions for the home « Fermeture exceptionnelle »
 * control (PRD 20 §7b + ADR 0018 frontière disponibilité commerciale). Same
 * split as `decidePauseControl` (#406), `decideForceUpdate` (#394),
 * `decideTenantSwitcher` (#399), `decideRefuseFlow` (#403): keep React, Expo
 * and Convex out of the matrix so the truth table is pinned by a fast
 * deterministic vitest suite (node env, no jsdom, no native mocks).
 *
 * The component `<ClosureControl />` is a thin adapter that resolves the
 * active tenant's `getExceptionalClosure` via `useQuery`, ticks a local
 * `nowMs` clock so the « Fermé jusqu'au JJ/MM » badge stays live across the
 * auto-reprise boundary even with no Convex re-render, and feeds the
 * decision here. Three verdicts cover every state:
 *
 *  - `loading` — Convex sub still resolving (`closure === undefined`). Render
 *    a discreet placeholder; surfacing the entry button before we know the
 *    state would flash the wrong CTA at the gérant.
 *  - `idle` — `closure` is null OR expired OR scheduled in the future. The
 *    home renders the entry pill that opens the bottom sheet with quick
 *    presets (Aujourd'hui / J+1 / J+7) + the custom YYYY-MM-DD inputs.
 *  - `live` — closure active (`from <= now < until`). Surface the badge
 *    « Resto fermé jusqu'au JJ/MM » + the « Rouvrir maintenant » button
 *    (manual clear, `clearExceptionalClosure`).
 *
 * The auto-reprise itself is DERIVED from `[from, until)` and lives on the
 * BACKEND gate (`acceptsOrderNow` REUSED by the PWA checkout, status.ts) —
 * this module just mirrors the same predicate so the home UI flips back to
 * `idle` at the same instant the checkout reopens. No cron, no
 * `scheduler.runAt` needed on the native side: the backend resolves the
 * réouverture through the derived check, same end behaviour as the pause
 * (#406), simpler than a scheduler.
 *
 * Distinct from the pause (`decidePauseControl`, #406) on three axes:
 *
 *  1. **Window vs duration**: closure carries an explicit `[from, until)`
 *     window — the gérant chooses the dates. The pause is `until` only,
 *     duration figée 15/30/60 min.
 *  2. **Reopen wording**: « Rouvrir » (closure semantics) vs « Reprendre »
 *     (pause semantics — the kitchen never stopped, only NEW checkouts were
 *     paused).
 *  3. **PWA banner wording**: « Resto fermé jusqu'au JJ/MM » (date) vs
 *     « Resto en pause, reprise HH:MM » (heure).
 *
 * The semantic distinction matches PRD 20 §7a/§7b and ADR 0018: closure is
 * a DURABLE absence (1+ jour, vacances/panne frigo/intempéries), pause is a
 * TRANSIENT operational signal (15-60 min, rush/incident éclair).
 */

import type { ExceptionalClosure } from "@packages/backend/convex/lib/orders";

/**
 * PRD 20 §7b — presets de fermeture rapide pour le bottom sheet. Le PRD
 * appelle à un « raccourci aujourd'hui seulement » + « du… au… » custom ;
 * J+1 et J+7 sont les granularités utiles inférables de la mention
 * « durable 1+ jour » + le profil d'usage (panne frigo court / vacances
 * weekend). Toute durée custom passe par la saisie texte YYYY-MM-DD.
 *
 * Tuple en lecture seule pour qu'on puisse mapper côté UI sans risquer
 * d'append accidentel ailleurs.
 */
export const CLOSURE_QUICK_PRESETS = ["today", "plus_1", "plus_7"] as const;

/** Sugar type pour les 3 presets valides. */
export type ClosureQuickPreset = (typeof CLOSURE_QUICK_PRESETS)[number];

/** Inputs the decision needs to reach a verdict. */
export type ClosureControlInputs = {
  /**
   * Convex `getExceptionalClosure` result:
   *  - `undefined` = query still in flight (loading sentinel),
   *  - `null` = no closure configured,
   *  - `{ from, until }` = a scheduled OR active OR expired closure (the
   *    predicate decides).
   */
  closure: ExceptionalClosure | undefined;
  /**
   * The wall-clock `Date.now()` resolved by the host component. Injected so
   * the decision stays pure — unit tests pin deterministic dates without
   * touching the real clock.
   */
  nowMs: number;
};

/** The three mutually-exclusive verdicts the host renders against. */
export type ClosureControlDecision =
  /** Convex sub still resolving — render a discreet placeholder. */
  | { kind: "loading" }
  /** No closure active — surface the entry pill + presets. */
  | { kind: "idle" }
  /** Closure active — surface badge + Rouvrir button. `until` is exposed so
   * the host can format the date via `formatClosureUntilDate` without
   * re-deriving. */
  | { kind: "live"; until: number };

/**
 * Pure « is closure active right now » predicate, mirror of the backend
 * `isClosureActive` (status.ts). `from` is INCLUSIVE, `until` is EXCLUSIVE
 * (same auto-reprise discipline as the pause). A closure planned for
 * tomorrow does NOT gate today; one whose `until` has passed gates no
 * more. No cron needed — the derivation IS the auto-reprise.
 */
export function isClosureLive(
  closure: ExceptionalClosure,
  nowMs: number,
): boolean {
  if (closure === null) return false;
  return closure.from <= nowMs && closure.until > nowMs;
}

/**
 * Compute the `[from, until)` window for one of the quick presets. The PRD
 * §7b « raccourci aujourd'hui seulement » materialises as `today` = today
 * 00:00 → tomorrow 00:00 (single day). `plus_1` = today 00:00 → J+2 00:00
 * (2 days, fast weekend). `plus_7` = today 00:00 → J+8 00:00 (week off,
 * typical vacance courte).
 *
 * Local midnight on purpose: the gérant thinks in his pendule, not UTC; a
 * closure that says « jusqu'au 16/06 » must really end at local 16/06 00:00.
 * Mirror of the admin `dateInputToMs` (disponibilite-view.tsx) which uses
 * the same local-time constructor.
 */
export function computeQuickClosureWindow(
  nowMs: number,
  preset: ClosureQuickPreset,
): { from: number; until: number } {
  const start = startOfLocalDay(nowMs);
  const daysAhead = preset === "today" ? 1 : preset === "plus_1" ? 2 : 8;
  const until = addLocalDays(start, daysAhead);
  return { from: start, until };
}

/** Local-midnight of the day containing `ms`. */
function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
    0,
    0,
    0,
    0,
  ).getTime();
}

/** Add N calendar days to a local-midnight epoch, stays at local midnight
 * (handles DST transitions correctly via the Date constructor). */
function addLocalDays(localMidnightMs: number, days: number): number {
  const d = new Date(localMidnightMs);
  return new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate() + days,
    0,
    0,
    0,
    0,
  ).getTime();
}

/**
 * Parse a YYYY-MM-DD text input into an epoch ms at local midnight. Mirror
 * of the admin `dateInputToMs` so a YYYY-MM-DD typed in the native bottom
 * sheet produces the SAME `from`/`until` epoch the admin side would have
 * produced for the same date — no drift across surfaces.
 *
 * Returns `null` for empty input OR malformed shape (anything other than
 * exactly 4-2-2 digits, zero-padded).
 */
export function parseLocalDateInput(value: string): number | null {
  if (value.length === 0) return null;
  // Strict YYYY-MM-DD: the admin `<input type="date">` always emits this
  // shape, and the native bottom sheet enforces it client-side. Refuse
  // anything looser so a typo doesn't silently land an off-by-one window.
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day)
  ) {
    return null;
  }
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
}

/**
 * Initial value for the « Du » date picker when the gérant opens the bottom
 * sheet — local midnight of TODAY. Most permissive `from` (the closure can
 * start immediately) AND the value most gérants want in practice (« je
 * ferme à partir d'aujourd'hui »). The picker also enforces this as the
 * `minimumDate` so retroactive closures are rejected at the UI layer.
 *
 * Pure: same `nowMs` ⇒ same epoch. Tests pin a fixed `now` to verify the
 * 00:00 alignment + the day-boundary edges (juste après minuit / 23:59).
 */
export function decideClosureCustomFromInitial(nowMs: number): number {
  return startOfLocalDay(nowMs);
}

/**
 * Minimum value for the « Au » date picker = `from + 24h`. The backend
 * mutation `setExceptionalClosure` rejects `from >= until`; the UI enforces
 * a stricter +24h floor because the « fermeture exceptionnelle » spec is a
 * DURABLE absence (PRD 20 §7b, ≥ 1 jour). Anything shorter would belong to
 * the pause (`<PauseControl />` #406, 15-60 min).
 *
 * Pure: trivial offset, no DST handling. The picker natif lit l'epoch en
 * temps local, donc une DST entre `from` et `from + 24h` est gérée par le
 * picker à l'affichage — pas notre problème côté contrat.
 */
export function decideClosureCustomUntilMinimum(fromMs: number): number {
  return fromMs + 24 * 60 * 60 * 1000;
}

/**
 * Format the réouverture date as fr-FR `JJ/MM`. Used by the home badge
 * today (« Resto fermé jusqu'au JJ/MM ») AND, when the PWA client banner
 * lands, by the customer-side message (PRD 20 §7b) — same formatting in
 * both surfaces so the gérant + the client see the same date.
 *
 * The `try`/`catch` defends against ancient runtimes where
 * `Intl.DateTimeFormat` may throw or omit options; we fall back to manual
 * zero-padding on the local-time fields.
 */
export function formatClosureUntilDate(untilMs: number): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
    }).format(new Date(untilMs));
  } catch {
    const d = new Date(untilMs);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}`;
  }
}

/**
 * Format a date in full fr-FR long form — « vendredi 12 juin 2026 ». Used
 * under the « Du » / « Au » Pressable buttons that drive the
 * `DateTimePicker` natif : the home badge format (`JJ/MM`) is too compact
 * to confirm a year when the gérant is picking a multi-month window. The
 * full form removes ambiguity (12/06 = 12 juin OR 6 décembre US? Here :
 * « vendredi 12 juin 2026 », sans ambiguïté).
 *
 * The `try`/`catch` defends against ancient runtimes where
 * `Intl.DateTimeFormat` may throw; we fall back to a minimal numeric
 * `JJ/MM/AAAA`.
 */
export function formatClosureFullDate(ms: number): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(new Date(ms));
  } catch {
    const d = new Date(ms);
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}/${d.getFullYear()}`;
  }
}

/**
 * Decide what the home Closure control renders this frame. Pure: same
 * inputs ⇒ same output, no `Date.now()`, no side effects. Truth table
 * pinned in `decide-closure-control.test.ts`.
 */
export function decideClosureControl(
  inputs: ClosureControlInputs,
): ClosureControlDecision {
  if (inputs.closure === undefined) {
    return { kind: "loading" };
  }
  // Local narrowing — `isClosureLive` checks
  // `closure !== null && closure.from <= now < closure.until`, but TS's
  // return type (`boolean`) loses the discriminant; we re-narrow on the
  // returned tuple here so `closure.until` is reachable without a non-null
  // bang.
  if (inputs.closure !== null && isClosureLive(inputs.closure, inputs.nowMs)) {
    return { kind: "live", until: inputs.closure.until };
  }
  return { kind: "idle" };
}
