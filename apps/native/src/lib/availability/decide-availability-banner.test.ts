import { describe, expect, it } from "vitest";
import {
  decideAvailabilityBanner,
  formatAvailabilityClosureUntilDate,
  formatAvailabilityPauseEta,
} from "./decide-availability-banner";

/**
 * `decideAvailabilityBanner` + helpers, pinned as pure functions (PRD 20 §7 +
 * ADR 0018, frontière disponibilité commerciale). Same split convention as
 * `decidePauseControl` (#406), `decideClosureControl` (#407),
 * `decideForceUpdate` (#394) — React, Expo, Convex stay OUT so the truth
 * table lives in a fast vitest suite (node env, no jsdom).
 *
 * Truth table : loading guard, 4 kinds × cas limites + priorité quand deux
 * signaux sont actifs simultanément.
 */

const NOW = 1_700_000_000_000; // 2023-11-14T22:13:20Z — date arbitraire stable
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

describe("decideAvailabilityBanner — loading guard", () => {
  // Avant que les queries Convex aient répondu, on rend `hidden` plutôt que
  // de flasher un état partiel. Le hors-horaires (`isOpenNow`) est facultatif
  // — il sert uniquement au kind 3, le moins prioritaire.
  it("pause === undefined (Convex en flight) → hidden", () => {
    expect(
      decideAvailabilityBanner({
        pause: undefined,
        closure: null,
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("closure === undefined (Convex en flight) → hidden", () => {
    expect(
      decideAvailabilityBanner({
        pause: null,
        closure: undefined,
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("les DEUX en flight → hidden", () => {
    expect(
      decideAvailabilityBanner({
        pause: undefined,
        closure: undefined,
        isOpenNow: undefined,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });
});

describe("decideAvailabilityBanner — kind `hidden` (tout va bien)", () => {
  it("pas de pause, pas de fermeture, ouvert → hidden", () => {
    expect(
      decideAvailabilityBanner({
        pause: null,
        closure: null,
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("pause expirée + closure expirée + ouvert → hidden (auto-reprise)", () => {
    expect(
      decideAvailabilityBanner({
        pause: { until: NOW - HOUR },
        closure: { from: NOW - DAY * 3, until: NOW - DAY },
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("isOpenNow encore undefined ET pas de pause / closure → hidden (pas de flash)", () => {
    // On NE flashe PAS « hors horaires » avant la résolution de isOpenNow.
    expect(
      decideAvailabilityBanner({
        pause: null,
        closure: null,
        isOpenNow: undefined,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });
});

describe("decideAvailabilityBanner — kind `closure` (rouge, le plus impactant)", () => {
  it("fermeture active → closure + until exposé", () => {
    const closure = { from: NOW - HOUR, until: NOW + DAY };
    expect(
      decideAvailabilityBanner({
        pause: null,
        closure,
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "closure", until: closure.until });
  });

  it("fermeture qui finit exactement maintenant (until == now) → NE GATE PLUS", () => {
    // EXCLUSIVE sur `until` : à l'instant exact `until`, c'est fini.
    expect(
      decideAvailabilityBanner({
        pause: null,
        closure: { from: NOW - DAY, until: NOW },
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });
});

describe("decideAvailabilityBanner — kind `closureScheduled` (planifiée, info muted)", () => {
  // Bug 2026-06-07 (Alex) : la bannière ne flip pas quand le gérant saisit
  // une fenêtre custom future via le bottom sheet. Conséquence UX : aucun
  // feedback de confirmation que les bornes saisies sont correctes. Fix :
  // surfacer un nouveau kind `closureScheduled` (gris/muted) tant que
  // `from > now`. Le backend NE gate PAS encore les checkouts (cohérent
  // avec `isClosureActive` qui reste exclusif sur le futur), mais le gérant
  // a une preview visuelle persistante des bornes — il peut détecter une
  // erreur de saisie immédiatement.
  it("fermeture planifiée pour demain (from > now) → closureScheduled + from/until exposés", () => {
    const closure = { from: NOW + HOUR, until: NOW + DAY };
    expect(
      decideAvailabilityBanner({
        pause: null,
        closure,
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({
      kind: "closureScheduled",
      from: closure.from,
      until: closure.until,
    });
  });

  it("fermeture planifiée + isOpenNow false → closureScheduled wins sur outsideHours", () => {
    // Priorité (top → bottom) : closure > pause > closureScheduled > outsideHours > hidden.
    // Une fermeture programmée est plus actionnable qu'une simple info hors horaires.
    const closure = { from: NOW + HOUR, until: NOW + DAY };
    expect(
      decideAvailabilityBanner({
        pause: null,
        closure,
        isOpenNow: false,
        nowMs: NOW,
      }),
    ).toEqual({
      kind: "closureScheduled",
      from: closure.from,
      until: closure.until,
    });
  });
});

describe("decideAvailabilityBanner — kind `pause` (amber, transient)", () => {
  it("pause active → pause + until exposé", () => {
    expect(
      decideAvailabilityBanner({
        pause: { until: NOW + 30 * 60 * 1000 },
        closure: null,
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "pause", until: NOW + 30 * 60 * 1000 });
  });

  it("pause expirée → NE GATE PLUS (auto-reprise dérivée)", () => {
    expect(
      decideAvailabilityBanner({
        pause: { until: NOW - 1 },
        closure: null,
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });

  it("pause exacte (until == now) → NE GATE PLUS (EXCLUSIVE)", () => {
    expect(
      decideAvailabilityBanner({
        pause: { until: NOW },
        closure: null,
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });
});

describe("decideAvailabilityBanner — kind `outsideHours` (gris, info)", () => {
  it("isOpenNow === false et rien d'autre → outsideHours", () => {
    expect(
      decideAvailabilityBanner({
        pause: null,
        closure: null,
        isOpenNow: false,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "outsideHours" });
  });

  it("isOpenNow === undefined (en flight) → hidden (pas de flash)", () => {
    // Le hors-horaires est le SEUL kind qui dépend de `isOpenNow`. Tant que
    // la query est en flight on ne flash pas — c'est un signal mou,
    // mieux vaut attendre que de surfacer une bannière fausse.
    expect(
      decideAvailabilityBanner({
        pause: null,
        closure: null,
        isOpenNow: undefined,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "hidden" });
  });
});

describe("decideAvailabilityBanner — PRIORITÉ quand plusieurs signaux sont actifs", () => {
  // L'ordre canonique est : closure > pause > closureScheduled > outsideHours > hidden.
  // « Le plus durable / impactant gagne l'attention du gérant. »

  it("closure ACTIVE + pause ACTIVE → closure wins (closure plus durable)", () => {
    const closure = { from: NOW - HOUR, until: NOW + DAY };
    expect(
      decideAvailabilityBanner({
        pause: { until: NOW + 30 * 60 * 1000 },
        closure,
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "closure", until: closure.until });
  });

  it("closure ACTIVE + isOpenNow false → closure wins", () => {
    const closure = { from: NOW - HOUR, until: NOW + DAY };
    expect(
      decideAvailabilityBanner({
        pause: null,
        closure,
        isOpenNow: false,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "closure", until: closure.until });
  });

  it("pause ACTIVE + isOpenNow false → pause wins (pause plus actionnable)", () => {
    expect(
      decideAvailabilityBanner({
        pause: { until: NOW + 30 * 60 * 1000 },
        closure: null,
        isOpenNow: false,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "pause", until: NOW + 30 * 60 * 1000 });
  });

  it("closure ACTIVE + pause ACTIVE + isOpenNow false → closure wins (triple)", () => {
    const closure = { from: NOW - HOUR, until: NOW + DAY };
    expect(
      decideAvailabilityBanner({
        pause: { until: NOW + 30 * 60 * 1000 },
        closure,
        isOpenNow: false,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "closure", until: closure.until });
  });

  it("pause ACTIVE + closureScheduled → pause wins (pause active = plus urgent)", () => {
    // V1 : on ne stacke pas 2 bannières. La pause active (transient, gère
    // le service en cours) prime sur la closure programmée (info passive).
    const closure = { from: NOW + HOUR, until: NOW + DAY };
    expect(
      decideAvailabilityBanner({
        pause: { until: NOW + 30 * 60 * 1000 },
        closure,
        isOpenNow: true,
        nowMs: NOW,
      }),
    ).toEqual({ kind: "pause", until: NOW + 30 * 60 * 1000 });
  });
});

describe("formatAvailabilityPauseEta — fr-FR `HH:MM`", () => {
  it("retourne `HH:MM` zero-padded", () => {
    const date = new Date(2023, 0, 1, 8, 5, 0, 0);
    expect(formatAvailabilityPauseEta(date.getTime())).toBe("08:05");
  });

  it("midi pile", () => {
    const date = new Date(2023, 0, 1, 12, 0, 0, 0);
    expect(formatAvailabilityPauseEta(date.getTime())).toBe("12:00");
  });
});

describe("formatAvailabilityClosureUntilDate — fr-FR `JJ/MM`", () => {
  it("retourne `JJ/MM` zero-padded", () => {
    const date = new Date(2023, 0, 1, 0, 0, 0, 0);
    expect(formatAvailabilityClosureUntilDate(date.getTime())).toBe("01/01");
  });

  it("decembre", () => {
    const date = new Date(2023, 11, 24, 0, 0, 0, 0);
    expect(formatAvailabilityClosureUntilDate(date.getTime())).toBe("24/12");
  });
});
