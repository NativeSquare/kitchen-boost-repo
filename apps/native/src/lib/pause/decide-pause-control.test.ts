import { describe, expect, it } from "vitest";
import {
  PAUSE_DURATIONS_MIN,
  computePauseUntil,
  decidePauseControl,
  formatPauseEta,
  isPauseLive,
} from "./decide-pause-control";

/**
 * #406 — `decidePauseControl` + helpers, pinned as pure functions (PRD 20 §7a +
 * ADR 0018, frontière disponibilité commerciale). Same split convention as the
 * other native libs (`decideForceUpdate` #394, `decideTenantSwitcher` #399,
 * `decideRefuseFlow` #403) — keep React, expo, Convex OUT so the truth table
 * lives in a fast vitest suite (node env, no jsdom).
 *
 * Three scenarios pinned at the decision layer:
 *
 *  (a) « tenant ouvert, pas de pause » → `idle` — surface les 3 boutons 15/30/60
 *  (b) « pause active » → `live` — surface la badge "En pause jusqu'à HH:MM" +
 *      bouton « Reprendre maintenant »
 *  (c) « pause expirée (auto-reprise) » → `idle` — la dérivation `until > now`
 *      remet la home en mode normal sans cron (PRD 20 §7a auto-reprise)
 *
 *  Plus le loading guard (`pause === undefined` Convex sentinel) → `loading`.
 *
 *  `computePauseUntil(now, durationMin)` est le helper que le composant appelle
 *  pour figer l'ETA à `now + duration` au tap (PRD 20 §7a « ETA reprise figée »).
 *
 *  `formatPauseEta(untilMs)` est le formateur fr-FR `HH:MM` partagé entre la
 *  badge home + (plus tard) la bannière PWA client.
 */

describe("#406 PAUSE_DURATIONS_MIN — figée V1 (PRD 20 §7a, pas de custom)", () => {
  it("contient exactement 15, 30, 60 dans cet ordre", () => {
    expect(PAUSE_DURATIONS_MIN).toEqual([15, 30, 60]);
  });
});

describe("#406 isPauseLive — pure (pause + clock → boolean), `until` EXCLUSIVE", () => {
  // Même contrat sémantique que le backend `isPauseActive` (status.ts) : on
  // duplique côté front pour le rendering, on ne refait pas l'auto-reprise —
  // le backend reste la source de vérité gate (acceptsOrderNow, ADR 0018).
  it("INACTIVE si pas de pause", () => {
    expect(isPauseLive(null, 1_000)).toBe(false);
  });

  it("ACTIVE tant que `until` est dans le futur", () => {
    expect(isPauseLive({ until: 2_000 }, 1_000)).toBe(true);
  });

  it("INACTIVE dès que `until` est passé (auto-reprise, pas de cron)", () => {
    expect(isPauseLive({ until: 1_000 }, 2_000)).toBe(false);
  });

  it("EXCLUSIVE — à exactement `until` la pause est finie", () => {
    expect(isPauseLive({ until: 1_000 }, 1_000)).toBe(false);
  });
});

describe("#406 computePauseUntil — `now + duration * 60_000` (ETA reprise figée)", () => {
  it("15 min → +900_000 ms", () => {
    expect(computePauseUntil(10_000, 15)).toBe(10_000 + 15 * 60_000);
  });

  it("30 min → +1_800_000 ms", () => {
    expect(computePauseUntil(10_000, 30)).toBe(10_000 + 30 * 60_000);
  });

  it("60 min → +3_600_000 ms", () => {
    expect(computePauseUntil(10_000, 60)).toBe(10_000 + 60 * 60_000);
  });
});

describe("#406 formatPauseEta — fr-FR `HH:MM`", () => {
  it("retourne `HH:MM` zero-padded", () => {
    // Sun Jan 01 2023 08:05:00 GMT  (avoid DST surprises)
    const date = new Date(2023, 0, 1, 8, 5, 0, 0);
    expect(formatPauseEta(date.getTime())).toBe("08:05");
  });

  it("midi pile", () => {
    const date = new Date(2023, 0, 1, 12, 0, 0, 0);
    expect(formatPauseEta(date.getTime())).toBe("12:00");
  });
});

describe("#406 decidePauseControl — verdict du panneau Pause sur la home", () => {
  const NOW = 10_000;
  const HOUR = 60 * 60 * 1000;

  it("`pause === undefined` (Convex en flight) → loading", () => {
    expect(decidePauseControl({ pause: undefined, nowMs: NOW })).toEqual({
      kind: "loading",
    });
  });

  it("(a) pas de pause → idle (les 3 boutons 15/30/60 sont rendus)", () => {
    expect(decidePauseControl({ pause: null, nowMs: NOW })).toEqual({
      kind: "idle",
    });
  });

  it("(b) pause active → live + ETA exposée pour la badge / le bouton Reprendre", () => {
    const until = NOW + HOUR;
    expect(decidePauseControl({ pause: { until }, nowMs: NOW })).toEqual({
      kind: "live",
      until,
    });
  });

  it("(c) pause expirée → idle (auto-reprise dérivée, pas de manual clear)", () => {
    // `until` est exactement maintenant — le contrat EXCLUSIVE doit décider idle.
    expect(decidePauseControl({ pause: { until: NOW }, nowMs: NOW })).toEqual({
      kind: "idle",
    });
  });

  it("(c bis) pause expirée depuis longtemps → idle (le row tenant peut traîner avant clear)", () => {
    expect(
      decidePauseControl({ pause: { until: NOW - HOUR }, nowMs: NOW }),
    ).toEqual({ kind: "idle" });
  });
});
