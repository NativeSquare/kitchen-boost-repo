import { describe, expect, it } from "vitest";
import {
  CLOSURE_QUICK_PRESETS,
  computeQuickClosureWindow,
  decideClosureControl,
  formatClosureUntilDate,
  isClosureLive,
  parseLocalDateInput,
} from "./decide-closure-control";

/**
 * #407 — `decideClosureControl` + helpers, pinned as pure functions (PRD 20 §7b
 * + ADR 0018, frontière disponibilité commerciale). Same split convention as
 * `decidePauseControl` (#406), `decideForceUpdate` (#394),
 * `decideTenantSwitcher` (#399) — React, Expo, Convex stay OUT so the truth
 * table lives in a fast vitest suite (node env, no jsdom).
 *
 * Three scenarios pinned at the decision layer:
 *
 *  (a) « tenant ouvert, pas de fermeture » → `idle` — surface les boutons
 *      preset (Aujourd'hui / J+1 / J+7) + entrée custom
 *  (b) « fermeture active » → `live` — surface badge "Fermé jusqu'au JJ/MM" +
 *      bouton « Rouvrir maintenant »
 *  (c) « fermeture future (from > now) » → `idle` — le row tenant peut
 *      contenir une closure planifiée ; tant que `from` n'est pas atteint, la
 *      home reste en mode normal (mirror du backend `isClosureActive` qui
 *      inclusive sur `from` et exclusive sur `until`)
 *  (d) « fermeture expirée (until <= now) » → `idle` — la dérivation
 *      `from <= now < until` remet la home en mode normal sans cron (PRD 20
 *      §7b auto-reprise dérivée, même discipline que la pause)
 *
 * Plus le loading guard (`closure === undefined` Convex sentinel) → `loading`.
 *
 * `computeQuickClosureWindow(nowMs, preset)` est le helper que le composant
 * appelle pour matérialiser les choix rapides du PRD §7b (« raccourci
 * aujourd'hui seulement »). Le « custom » passe par `parseLocalDateInput`
 * qui convertit un YYYY-MM-DD saisi en epoch ms à minuit local (les attentes
 * « JJ/MM » du gérant s'alignent sur sa pendule, pas sur UTC).
 *
 * `formatClosureUntilDate(untilMs)` est le formateur fr-FR `JJ/MM` partagé
 * entre la badge home + (plus tard) la bannière PWA client (« Resto fermé
 * jusqu'au JJ/MM », PRD 20 §7b).
 */

describe("#407 CLOSURE_QUICK_PRESETS — presets PRD 20 §7b (« raccourci aujourd'hui seulement »)", () => {
  it("contient exactement today, plus_1, plus_7 dans cet ordre", () => {
    expect(CLOSURE_QUICK_PRESETS).toEqual(["today", "plus_1", "plus_7"]);
  });
});

describe("#407 isClosureLive — pure, [from, until) (mirror backend `isClosureActive`)", () => {
  // Même contrat sémantique que le backend `isClosureActive` (status.ts) : on
  // duplique côté front pour le rendering, on ne refait pas la gate — le
  // backend reste la source de vérité (`tenantAcceptsOrderNow`, ADR 0018).
  it("INACTIVE si pas de fermeture", () => {
    expect(isClosureLive(null, 1_000)).toBe(false);
  });

  it("ACTIVE tant que from <= now < until", () => {
    expect(isClosureLive({ from: 1_000, until: 2_000 }, 1_500)).toBe(true);
  });

  it("INACTIVE si now < from (fermeture future planifiée)", () => {
    expect(isClosureLive({ from: 1_000, until: 2_000 }, 500)).toBe(false);
  });

  it("INACTIVE dès que until est atteint (EXCLUSIVE sur until, auto-reprise)", () => {
    expect(isClosureLive({ from: 1_000, until: 2_000 }, 2_000)).toBe(false);
  });

  it("INACTIVE longtemps après until (row tenant peut traîner avant clear)", () => {
    expect(isClosureLive({ from: 1_000, until: 2_000 }, 999_999)).toBe(false);
  });

  it("INCLUSIVE sur from — à exactement from, la fermeture commence", () => {
    expect(isClosureLive({ from: 1_000, until: 2_000 }, 1_000)).toBe(true);
  });
});

describe("#407 computeQuickClosureWindow — presets PRD 20 §7b", () => {
  // Use a fixed local-time anchor for reproducibility across CI runners.
  // 2026-06-15 14:00:00 local — middle of June, well clear of DST edges.
  const NOW = new Date(2026, 5, 15, 14, 0, 0, 0).getTime();

  it("today → from = aujourd'hui 00:00, until = demain 00:00 (1 jour)", () => {
    const window = computeQuickClosureWindow(NOW, "today");
    expect(window.from).toBe(new Date(2026, 5, 15, 0, 0, 0, 0).getTime());
    expect(window.until).toBe(new Date(2026, 5, 16, 0, 0, 0, 0).getTime());
  });

  it("plus_1 → from = aujourd'hui 00:00, until = J+2 00:00 (2 jours)", () => {
    const window = computeQuickClosureWindow(NOW, "plus_1");
    expect(window.from).toBe(new Date(2026, 5, 15, 0, 0, 0, 0).getTime());
    expect(window.until).toBe(new Date(2026, 5, 17, 0, 0, 0, 0).getTime());
  });

  it("plus_7 → from = aujourd'hui 00:00, until = J+8 00:00 (8 jours)", () => {
    const window = computeQuickClosureWindow(NOW, "plus_7");
    expect(window.from).toBe(new Date(2026, 5, 15, 0, 0, 0, 0).getTime());
    expect(window.until).toBe(new Date(2026, 5, 23, 0, 0, 0, 0).getTime());
  });

  it("from < until pour chaque preset (backend rejette sinon)", () => {
    for (const preset of CLOSURE_QUICK_PRESETS) {
      const window = computeQuickClosureWindow(NOW, preset);
      expect(window.from).toBeLessThan(window.until);
    }
  });
});

describe("#407 parseLocalDateInput — YYYY-MM-DD → epoch ms local midnight", () => {
  // Le backend stocke des epoch ms ; les pickers natifs renvoient
  // typiquement un Date. Le helper accepte aussi un YYYY-MM-DD textuel
  // pour parité avec la mirror admin (PRD §7b « du… au… »).
  it("parse YYYY-MM-DD en minuit local", () => {
    const ms = parseLocalDateInput("2026-06-15");
    expect(ms).toBe(new Date(2026, 5, 15, 0, 0, 0, 0).getTime());
  });

  it("retourne null pour input vide", () => {
    expect(parseLocalDateInput("")).toBeNull();
  });

  it("retourne null pour format invalide", () => {
    expect(parseLocalDateInput("15/06/2026")).toBeNull();
    expect(parseLocalDateInput("2026-6-15")).toBeNull();
    expect(parseLocalDateInput("abc")).toBeNull();
  });
});

describe("#407 formatClosureUntilDate — fr-FR `JJ/MM` (PRD 20 §7b « jusqu'au JJ/MM »)", () => {
  it("retourne `JJ/MM` zero-padded", () => {
    const date = new Date(2026, 5, 7, 0, 0, 0, 0); // 7 juin 2026 local
    expect(formatClosureUntilDate(date.getTime())).toBe("07/06");
  });

  it("31 décembre", () => {
    const date = new Date(2026, 11, 31, 0, 0, 0, 0);
    expect(formatClosureUntilDate(date.getTime())).toBe("31/12");
  });

  it("1er janvier", () => {
    const date = new Date(2027, 0, 1, 0, 0, 0, 0);
    expect(formatClosureUntilDate(date.getTime())).toBe("01/01");
  });
});

describe("#407 decideClosureControl — verdict du panneau Fermeture sur la home", () => {
  const NOW = new Date(2026, 5, 15, 14, 0, 0, 0).getTime();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it("`closure === undefined` (Convex en flight) → loading", () => {
    expect(decideClosureControl({ closure: undefined, nowMs: NOW })).toEqual({
      kind: "loading",
    });
  });

  it("(a) pas de fermeture → idle (les presets + custom sont rendus)", () => {
    expect(decideClosureControl({ closure: null, nowMs: NOW })).toEqual({
      kind: "idle",
    });
  });

  it("(b) fermeture active → live + until exposé pour la badge JJ/MM", () => {
    const closure = { from: NOW - HOUR, until: NOW + 2 * DAY };
    expect(decideClosureControl({ closure, nowMs: NOW })).toEqual({
      kind: "live",
      until: closure.until,
    });
  });

  it("(c) fermeture future (from > now) → idle (planifiée, pas encore live)", () => {
    // Cas théorique : closure pour demain. Le gérant l'a planifiée d'avance.
    const closure = { from: NOW + DAY, until: NOW + 3 * DAY };
    expect(decideClosureControl({ closure, nowMs: NOW })).toEqual({
      kind: "idle",
    });
  });

  it("(d) fermeture expirée (until <= now) → idle (auto-reprise dérivée)", () => {
    // `until` est exactement maintenant — le contrat EXCLUSIVE sur until décide idle.
    const closure = { from: NOW - DAY, until: NOW };
    expect(decideClosureControl({ closure, nowMs: NOW })).toEqual({
      kind: "idle",
    });
  });

  it("(d bis) fermeture expirée depuis longtemps → idle (no manual clear nécessaire)", () => {
    const closure = { from: NOW - 10 * DAY, until: NOW - 3 * DAY };
    expect(decideClosureControl({ closure, nowMs: NOW })).toEqual({
      kind: "idle",
    });
  });
});
