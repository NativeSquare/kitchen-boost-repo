import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEW_SLOT,
  SERVICE_HOURS_SEGMENTS,
  WEEK_DAYS,
  dayLabel,
  decideServiceHoursScreen,
  filterTodayWindows,
  mergeTodayWindowsIntoWeek,
  minutesToTimeString,
  parisDayOfWeek,
  timeStringToMinutes,
  validateServiceWindows,
  type ServiceWindow,
} from "./decide-service-hours";

/**
 * #409 — `decideServiceHoursScreen` + helpers, pinned as pure functions
 * (PRD 20 §7d + ADR 0018, frontière disponibilité commerciale). Same
 * split convention as `decideClosureControl` (#407), `decidePauseControl`
 * (#406), `decideForceUpdate` (#394), `decideTenantSwitcher` (#399),
 * `decideItemAvailability` (#408) — React, Expo, Convex stay OUT so the
 * truth table lives in a fast vitest suite (node env, no jsdom).
 *
 * Scenarios pinned at the decision layer:
 *
 *  (a) `hours === undefined` (Convex en flight) → loading
 *  (b) `hours.windows === []` (resto sans horaires configurés) → ready avec
 *      windows vide (état légitime, l'éditeur affiche tous les jours
 *      « Fermé » avec un bouton Ajouter)
 *  (c) `hours.windows` chargé → ready avec windows transmis tel quel
 *
 * Plus :
 *   - `parisDayOfWeek` été (CEST) + hiver (CET) + boundary local-midnight
 *   - `filterTodayWindows` + `mergeTodayWindowsIntoWeek` round-trip
 *   - `validateServiceWindows` truth table (les 3 règles produit)
 *   - `minutesToTimeString` / `timeStringToMinutes` round-trip
 *   - `WEEK_DAYS` ordre FR (Lundi first)
 */

describe("#409 SERVICE_HOURS_SEGMENTS — toggle Aujourd'hui / Cette semaine (PRD 20 §7d)", () => {
  it("contient exactement today et week dans cet ordre", () => {
    expect(SERVICE_HOURS_SEGMENTS).toEqual(["today", "week"]);
  });
});

describe("#409 WEEK_DAYS — ordre FR (Lundi first, mirror service-hours-editor admin)", () => {
  it("commence par Lundi (1) et finit par Dimanche (0)", () => {
    expect(WEEK_DAYS.map((d) => d.dayOfWeek)).toEqual([1, 2, 3, 4, 5, 6, 0]);
  });

  it("expose le label FR de chaque jour", () => {
    expect(WEEK_DAYS.map((d) => d.label)).toEqual([
      "Lundi",
      "Mardi",
      "Mercredi",
      "Jeudi",
      "Vendredi",
      "Samedi",
      "Dimanche",
    ]);
  });
});

describe("#409 dayLabel — FR label lookup", () => {
  it("retourne le label FR pour chaque dayOfWeek valide", () => {
    expect(dayLabel(1)).toBe("Lundi");
    expect(dayLabel(0)).toBe("Dimanche");
    expect(dayLabel(3)).toBe("Mercredi");
  });

  it("retourne `Inconnu` pour un dayOfWeek hors range (defensive)", () => {
    expect(dayLabel(7)).toBe("Inconnu");
    expect(dayLabel(-1)).toBe("Inconnu");
  });
});

describe("#409 DEFAULT_NEW_SLOT — créneau midi par défaut (mirror admin)", () => {
  it("propose 12:00 → 14:00 (lunch service FR le plus courant)", () => {
    expect(DEFAULT_NEW_SLOT).toEqual({
      startMinute: 12 * 60,
      endMinute: 14 * 60,
    });
  });
});

describe("#409 decideServiceHoursScreen — verdict de l'écran Modif horaires", () => {
  it("`hours === undefined` (Convex en flight) → loading", () => {
    expect(decideServiceHoursScreen(undefined)).toEqual({ kind: "loading" });
  });

  it("`hours.windows === []` (resto sans horaires) → ready avec windows vide", () => {
    expect(decideServiceHoursScreen({ windows: [] })).toEqual({
      kind: "ready",
      windows: [],
    });
  });

  it("`hours.windows` chargé → ready avec windows transmis tel quel", () => {
    const windows: ServiceWindow[] = [
      { dayOfWeek: 1, startMinute: 690, endMinute: 870 },
      { dayOfWeek: 1, startMinute: 1110, endMinute: 1350 },
    ];
    expect(decideServiceHoursScreen({ windows })).toEqual({
      kind: "ready",
      windows,
    });
  });
});

describe("#409 parisDayOfWeek — Europe/Paris (CEST/CET DST handling)", () => {
  // 2026-07-15 10:00 UTC = 12:00 Paris (CEST, UTC+2), Wed = 3.
  it("été (CEST, UTC+2) → projecte sur le jour local Paris", () => {
    expect(parisDayOfWeek(Date.parse("2026-07-15T10:00:00Z"))).toBe(3);
  });

  // 2026-01-14 11:00 UTC = 12:00 Paris (CET, UTC+1), Wed = 3.
  it("hiver (CET, UTC+1) → projecte sur le jour local Paris", () => {
    expect(parisDayOfWeek(Date.parse("2026-01-14T11:00:00Z"))).toBe(3);
  });

  it("utilise 0=Sunday … 6=Saturday (JS getDay convention)", () => {
    // Sun 2026-07-12 08:00 UTC = 10:00 Paris (CEST).
    expect(parisDayOfWeek(Date.parse("2026-07-12T08:00:00Z"))).toBe(0);
    // Sat 2026-07-11 08:00 UTC = 10:00 Paris (CEST).
    expect(parisDayOfWeek(Date.parse("2026-07-11T08:00:00Z"))).toBe(6);
  });

  it("traverse correctement la frontière minuit locale (UTC day ≠ Paris day)", () => {
    // 2026-07-15 23:30 UTC = 2026-07-16 01:30 Paris (CEST). Day flip Wed → Thu.
    expect(parisDayOfWeek(Date.parse("2026-07-15T23:30:00Z"))).toBe(4);
  });
});

describe("#409 filterTodayWindows — projection créneaux du jour courant (Paris)", () => {
  const BB_WINDOWS: ServiceWindow[] = [
    // Wed (3)
    { dayOfWeek: 3, startMinute: 690, endMinute: 870 },
    { dayOfWeek: 3, startMinute: 1110, endMinute: 1350 },
    // Thu (4)
    { dayOfWeek: 4, startMinute: 720, endMinute: 870 },
    // Sun (0)
    { dayOfWeek: 0, startMinute: 600, endMinute: 900 },
  ];

  it("ne retient que les créneaux du jour courant (mercredi été)", () => {
    const today = filterTodayWindows(
      BB_WINDOWS,
      Date.parse("2026-07-15T10:00:00Z"),
    );
    expect(today).toEqual([
      { dayOfWeek: 3, startMinute: 690, endMinute: 870 },
      { dayOfWeek: 3, startMinute: 1110, endMinute: 1350 },
    ]);
  });

  it("ne retient que les créneaux du jour courant (dimanche)", () => {
    const today = filterTodayWindows(
      BB_WINDOWS,
      Date.parse("2026-07-12T08:00:00Z"),
    );
    expect(today).toEqual([{ dayOfWeek: 0, startMinute: 600, endMinute: 900 }]);
  });

  it("retourne une liste vide si aucun créneau le jour courant", () => {
    // Friday 2026-07-17 (5) — pas de créneau vendredi dans BB_WINDOWS.
    const today = filterTodayWindows(
      BB_WINDOWS,
      Date.parse("2026-07-17T10:00:00Z"),
    );
    expect(today).toEqual([]);
  });
});

describe("#409 mergeTodayWindowsIntoWeek — recompose la grille hebdo après édition Aujourd'hui", () => {
  const NOW_WED = Date.parse("2026-07-15T10:00:00Z");
  const BB_WINDOWS: ServiceWindow[] = [
    { dayOfWeek: 3, startMinute: 690, endMinute: 870 }, // Wed lunch (to be edited)
    { dayOfWeek: 3, startMinute: 1110, endMinute: 1350 }, // Wed dinner (to be edited)
    { dayOfWeek: 4, startMinute: 720, endMinute: 870 }, // Thu — PRESERVED
    { dayOfWeek: 0, startMinute: 600, endMinute: 900 }, // Sun — PRESERVED
  ];

  it("remplace les créneaux du jour, garde ceux des autres jours", () => {
    // Le gérant a édité son mercredi: un seul créneau, plus court.
    const newTodaySlots: ServiceWindow[] = [
      { dayOfWeek: 3, startMinute: 1110, endMinute: 1320 }, // 18:30 → 22:00 only
    ];
    const merged = mergeTodayWindowsIntoWeek(
      BB_WINDOWS,
      newTodaySlots,
      NOW_WED,
    );
    // Other-day windows kept first, in original order; today's edits appended.
    expect(merged).toEqual([
      { dayOfWeek: 4, startMinute: 720, endMinute: 870 },
      { dayOfWeek: 0, startMinute: 600, endMinute: 900 },
      { dayOfWeek: 3, startMinute: 1110, endMinute: 1320 },
    ]);
  });

  it("supprime tous les créneaux du jour si l'éditeur en envoie 0 (Khan ferme ce soir)", () => {
    const merged = mergeTodayWindowsIntoWeek(BB_WINDOWS, [], NOW_WED);
    expect(merged).toEqual([
      { dayOfWeek: 4, startMinute: 720, endMinute: 870 },
      { dayOfWeek: 0, startMinute: 600, endMinute: 900 },
    ]);
  });

  it("ajoute des créneaux à un jour qui n'en avait pas", () => {
    // Friday 2026-07-17 (5) — pas de créneau vendredi dans BB_WINDOWS,
    // le gérant ajoute son service du soir depuis Aujourd'hui.
    const newTodaySlots: ServiceWindow[] = [
      { dayOfWeek: 5, startMinute: 1110, endMinute: 1350 },
    ];
    const merged = mergeTodayWindowsIntoWeek(
      BB_WINDOWS,
      newTodaySlots,
      Date.parse("2026-07-17T10:00:00Z"),
    );
    // Tous les jours BB_WINDOWS préservés (aucun n'était friday) + le nouveau.
    expect(merged).toEqual([
      { dayOfWeek: 3, startMinute: 690, endMinute: 870 },
      { dayOfWeek: 3, startMinute: 1110, endMinute: 1350 },
      { dayOfWeek: 4, startMinute: 720, endMinute: 870 },
      { dayOfWeek: 0, startMinute: 600, endMinute: 900 },
      { dayOfWeek: 5, startMinute: 1110, endMinute: 1350 },
    ]);
  });
});

describe("#409 validateServiceWindows — les 3 règles produit (mirror backend assertServiceWindows)", () => {
  it("accepte une grille BB valide (lunch + dinner sans chevauchement)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 690, endMinute: 870 },
      { dayOfWeek: 1, startMinute: 1110, endMinute: 1350 },
    ]);
    expect(result.isValid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("accepte une grille vide (resto sans horaires = always closed, légitime)", () => {
    const result = validateServiceWindows([]);
    expect(result.isValid).toBe(true);
  });

  it("rejette un dayOfWeek hors [0..6]", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 7, startMinute: 600, endMinute: 700 },
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "INVALID_DAY",
      windowIndex: 0,
    });
  });

  it("rejette les minutes hors [0..1440] (cross-midnight forbidden V1)", () => {
    const negative = validateServiceWindows([
      { dayOfWeek: 1, startMinute: -1, endMinute: 700 },
    ]);
    expect(negative.errors).toContainEqual({
      kind: "OUT_OF_BOUNDS",
      windowIndex: 0,
    });
    const tooLate = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 600, endMinute: 1500 },
    ]);
    expect(tooLate.errors).toContainEqual({
      kind: "OUT_OF_BOUNDS",
      windowIndex: 0,
    });
  });

  it("accepte 24:00 (1440) comme borne de fin EXCLUSIVE (last minute)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 1380, endMinute: 1440 },
    ]);
    expect(result.isValid).toBe(true);
  });

  it("rejette start >= end (V1 ne span pas minuit)", () => {
    const equal = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 800, endMinute: 800 },
    ]);
    expect(equal.errors).toContainEqual({
      kind: "START_AFTER_OR_EQUAL_END",
      windowIndex: 0,
    });
    const inverted = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 900, endMinute: 600 },
    ]);
    expect(inverted.errors).toContainEqual({
      kind: "START_AFTER_OR_EQUAL_END",
      windowIndex: 0,
    });
  });

  it("rejette le chevauchement intra-jour (≥1 minute commune)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 690, endMinute: 870 },
      { dayOfWeek: 1, startMinute: 800, endMinute: 1000 }, // overlap 800-870
    ]);
    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual({
      kind: "OVERLAP",
      windowIndex: 0,
      otherWindowIndex: 1,
    });
  });

  it("accepte le touch-at-boundary (end_A === start_B, end EXCLUSIVE)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 690, endMinute: 870 },
      { dayOfWeek: 1, startMinute: 870, endMinute: 1000 }, // touche, ne chevauche pas
    ]);
    expect(result.isValid).toBe(true);
  });

  it("ne signale PAS de chevauchement entre deux jours différents", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 690, endMinute: 870 },
      { dayOfWeek: 2, startMinute: 690, endMinute: 870 }, // mêmes heures, jour différent
    ]);
    expect(result.isValid).toBe(true);
  });

  it("rejette les minutes non-entières", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 1, startMinute: 600.5, endMinute: 700 },
    ]);
    expect(result.errors).toContainEqual({
      kind: "OUT_OF_BOUNDS",
      windowIndex: 0,
    });
  });

  it("retourne TOUTES les erreurs (pas first-error-only)", () => {
    const result = validateServiceWindows([
      { dayOfWeek: 7, startMinute: 600, endMinute: 700 }, // INVALID_DAY
      { dayOfWeek: 1, startMinute: 900, endMinute: 800 }, // START_AFTER_OR_EQUAL_END
    ]);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("#409 minutesToTimeString / timeStringToMinutes — round-trip safe (mirror admin)", () => {
  it("round-trip exact sur chaque minute (échantillon)", () => {
    for (const m of [0, 1, 60, 690, 870, 1110, 1350, 1439, 1440]) {
      expect(timeStringToMinutes(minutesToTimeString(m))).toBe(m);
    }
  });

  it("minutesToTimeString formate avec zero-padding HH:MM", () => {
    expect(minutesToTimeString(0)).toBe("00:00");
    expect(minutesToTimeString(60)).toBe("01:00");
    expect(minutesToTimeString(690)).toBe("11:30");
    expect(minutesToTimeString(1440)).toBe("24:00");
  });

  it("timeStringToMinutes accepte 24:00 (borne EXCLUSIVE)", () => {
    expect(timeStringToMinutes("24:00")).toBe(1440);
  });

  it("timeStringToMinutes rejette 24:01 (hors plage)", () => {
    expect(timeStringToMinutes("24:01")).toBeNaN();
  });

  it("timeStringToMinutes rejette les inputs malformés", () => {
    expect(timeStringToMinutes("")).toBeNaN();
    expect(timeStringToMinutes("abc")).toBeNaN();
    expect(timeStringToMinutes("12:")).toBeNaN();
    expect(timeStringToMinutes(":00")).toBeNaN();
    expect(timeStringToMinutes("25:00")).toBeNaN();
    expect(timeStringToMinutes("12:60")).toBeNaN();
    expect(timeStringToMinutes("12.30")).toBeNaN();
  });
});
