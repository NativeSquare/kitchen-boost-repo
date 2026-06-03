/**
 * #406 — pure decision functions for the home « Pause exceptionnelle » control
 * (PRD 20 §7a + ADR 0018 frontière disponibilité commerciale). Same split as
 * `decideForceUpdate` (#394), `decideTenantSwitcher` (#399) and
 * `decideRefuseFlow` (#403): keep React, expo and Convex out of the matrix so
 * the truth table is pinned by a fast deterministic vitest suite (node env, no
 * jsdom, no native mocks).
 *
 * The component `<PauseControl />` is a thin adapter that resolves the active
 * tenant's `getOperationalPause` via `useQuery`, ticks a local `nowMs` clock so
 * the « En pause jusqu'à HH:MM » badge stays live across the auto-reprise
 * boundary even with no Convex re-render, and feeds the decision here. Three
 * verdicts cover every state:
 *
 *  - `loading` — Convex sub still resolving (`pause === undefined`). Render a
 *    discreet placeholder; surfacing the 3 buttons before we know the state
 *    would flash the wrong CTA at the gérant.
 *  - `idle` — `pause` is null or expired (auto-reprise dérivée, PRD 20 §7a). The
 *    home renders the 15 / 30 / 60 min buttons (or the consolidated « Pause »
 *    entry-point on small screens).
 *  - `live` — pause active. Surface the badge « En pause jusqu'à HH:MM » + the
 *    « Reprendre maintenant » button (manual clear, `clearOperationalPause`).
 *
 * The auto-reprise itself is DERIVED from `until` and lives on the BACKEND gate
 * (`acceptsOrderNow` REUSED by the PWA checkout, status.ts) — this module just
 * mirrors the same predicate so the home UI flips back to `idle` at the same
 * instant the checkout reopens. No cron, no `scheduler.runAt` needed on the
 * native side (the issue AC says "auto-resume scheduler"; the backend resolves
 * it through the derived `until > nowMs` check — same end behaviour, simpler).
 */

import type { OperationalPause } from "@packages/backend/convex/lib/orders";

/** PRD 20 §7a — durées figées V1, pas de custom, dans l'ordre d'affichage. */
export const PAUSE_DURATIONS_MIN = [15, 30, 60] as const;

/** Sugar type for the 3 valid choices. */
export type PauseDurationMin = (typeof PAUSE_DURATIONS_MIN)[number];

/** Inputs the decision needs to reach a verdict. */
export type PauseControlInputs = {
  /**
   * Convex `getOperationalPause` result:
   *  - `undefined` = query still in flight (loading sentinel),
   *  - `null` = no pause configured,
   *  - `{ until }` = an active OR expired pause (the predicate decides).
   */
  pause: OperationalPause | undefined;
  /**
   * The wall-clock `Date.now()` resolved by the host component. Injected so
   * the decision stays pure — unit tests pin deterministic dates without
   * touching the real clock.
   */
  nowMs: number;
};

/** The three mutually-exclusive verdicts the host renders against. */
export type PauseControlDecision =
  /** Convex sub still resolving — render a discreet placeholder. */
  | { kind: "loading" }
  /** No pause active — surface the 3 duration buttons. */
  | { kind: "idle" }
  /** Pause active — surface badge + Reprendre button. `until` is exposed so
   * the host can format the ETA via `formatPauseEta` without re-deriving. */
  | { kind: "live"; until: number };

/**
 * Pure auto-reprise predicate, mirror of the backend `isPauseActive` (status.ts).
 * `until` is EXCLUSIVE: at exactly `until` the pause is over (matches the
 * backend gate `acceptsOrderNow` so the home UI and the PWA checkout flip at
 * the same instant). No cron — the derivation IS the auto-reprise.
 */
export function isPauseLive(pause: OperationalPause, nowMs: number): boolean {
  return pause !== null && pause.until > nowMs;
}

/**
 * Compute the frozen ETA the gérant taps. PRD 20 §7a « ETA reprise figée » —
 * the duration is captured the moment the gérant taps, NOT recomputed at the
 * mutation site; the host passes `computePauseUntil(Date.now(), 15)` straight
 * into `setOperationalPause({ until })`.
 */
export function computePauseUntil(
  nowMs: number,
  durationMin: PauseDurationMin,
): number {
  return nowMs + durationMin * 60_000;
}

/**
 * Format the resume ETA as fr-FR `HH:MM`. Used by the home badge today
 * (« En pause jusqu'à HH:MM ») AND, when the PWA client banner lands, by the
 * customer-side message (« Resto en pause, reprise HH:MM », PRD 20 §7a) — same
 * formatting in both surfaces so the gérant + the client see the same time.
 *
 * The `try`/`catch` defends against ancient runtimes where `Intl.DateTimeFormat`
 * may throw or omit options; we fall back to manual zero-padding on the local
 * time fields.
 */
export function formatPauseEta(untilMs: number): string {
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(untilMs));
  } catch {
    const d = new Date(untilMs);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }
}

/**
 * Decide what the home Pause control renders this frame. Pure: same inputs ⇒
 * same output, no `Date.now()`, no side effects. Truth table pinned in
 * `decide-pause-control.test.ts`.
 */
export function decidePauseControl(
  inputs: PauseControlInputs,
): PauseControlDecision {
  if (inputs.pause === undefined) {
    return { kind: "loading" };
  }
  // Local narrowing — `isPauseLive` checks `pause !== null && pause.until > now`,
  // but TS's return type (`boolean`) loses the discriminant; we re-narrow on the
  // returned tuple here so `pause.until` is reachable without a non-null bang.
  if (inputs.pause !== null && isPauseLive(inputs.pause, inputs.nowMs)) {
    return { kind: "live", until: inputs.pause.until };
  }
  return { kind: "idle" };
}
