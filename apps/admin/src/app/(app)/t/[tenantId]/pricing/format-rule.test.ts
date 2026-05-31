/**
 * F-PRICING-1 (#241) — pure formatters that turn a persisted `pricingRules`
 * row into the two human-readable French strings the list cell shows:
 *
 *   formatConditionsSummary(conditions): "Panier ≥ 25 € · Lundi/Mardi · Première commande"
 *   formatActionSummary(action):          "Livraison offerte par le resto"
 *                                         "Part fixe absorbée : 2,50 €"
 *                                         "Part absorbée : 30 % du panier"
 *
 * Pure functions (no Convex, no React) → testable under `environment: "node"`.
 * Centralised so the slice-1 list AND the slices 2-5 builder share the same
 * source-of-truth for the FR resume — no duplication.
 */
import { describe, expect, it } from "vitest";

import type {
  PricingAction,
  PricingCondition,
} from "@packages/backend/convex/table/pricingRules";

import { formatConditionsSummary, formatActionSummary } from "./format-rule";

describe("formatConditionsSummary — F-PRICING-1 (#241)", () => {
  it("formats `total_panier ≥ 25 €` with FR euro typography", () => {
    const summary = formatConditionsSummary([
      { kind: "total_panier", operator: "gte", valueCents: 2500 },
    ]);
    // Single condition → no separator.
    expect(summary).toMatch(/Panier/);
    expect(summary).toMatch(/≥/);
    expect(summary).toMatch(/25/);
    expect(summary).toMatch(/€/);
    // The raw cents value MUST NOT leak.
    expect(summary).not.toMatch(/2500/);
  });

  it("formats `total_panier ≤ 12,50 €` with FR comma decimal", () => {
    const summary = formatConditionsSummary([
      { kind: "total_panier", operator: "lte", valueCents: 1250 },
    ]);
    expect(summary).toMatch(/≤/);
    // FR formatting: comma decimal, € as suffix (with NBSP or regular space).
    expect(summary).toMatch(/12,50\s?€/);
  });

  it("formats `premiere_cmd_client: true` as « Première commande »", () => {
    const summary = formatConditionsSummary([
      { kind: "premiere_cmd_client", value: true },
    ]);
    expect(summary).toMatch(/Premi[èe]re commande/i);
    // The boolean must NOT leak as `true` / `false` literals.
    expect(summary).not.toMatch(/\btrue\b/);
    expect(summary).not.toMatch(/\bfalse\b/);
  });

  it("formats `premiere_cmd_client: false` as « Pas la première commande »", () => {
    const summary = formatConditionsSummary([
      { kind: "premiere_cmd_client", value: false },
    ]);
    // « Pas la première commande » or any explicit negation (« Sauf première
    // commande », « Hors première commande »…). The load-bearing word is
    // « première » + an explicit negation — pin both.
    expect(summary).toMatch(/(pas|sauf|hors).*premi[èe]re/i);
  });

  it("formats `nombre_cmds_client ≥ 5` as a clear FR sentence", () => {
    const summary = formatConditionsSummary([
      { kind: "nombre_cmds_client", operator: "gte", value: 5 },
    ]);
    expect(summary).toMatch(/5/);
    expect(summary).toMatch(/commande/i);
    expect(summary).toMatch(/≥/);
  });

  it("formats `plage_horaire 11:30-14:00` keeping the HH:MM shape", () => {
    const summary = formatConditionsSummary([
      { kind: "plage_horaire", start: "11:30", end: "14:00" },
    ]);
    expect(summary).toMatch(/11:30/);
    expect(summary).toMatch(/14:00/);
  });

  it("formats `jour_semaine [LU, MA]` as « Lundi/Mardi » (full FR names)", () => {
    const summary = formatConditionsSummary([
      { kind: "jour_semaine", days: ["LU", "MA"] },
    ]);
    expect(summary).toMatch(/Lundi/);
    expect(summary).toMatch(/Mardi/);
    // The 2-letter code MUST NOT leak as-is.
    expect(summary).not.toMatch(/\bLU\b/);
    expect(summary).not.toMatch(/\bMA\b/);
  });

  it("formats `jour_semaine` for all 7 codes (no missing day)", () => {
    const summary = formatConditionsSummary([
      {
        kind: "jour_semaine",
        days: ["LU", "MA", "ME", "JE", "VE", "SA", "DI"],
      },
    ]);
    for (const day of [
      /Lundi/,
      /Mardi/,
      /Mercredi/,
      /Jeudi/,
      /Vendredi/,
      /Samedi/,
      /Dimanche/,
    ]) {
      expect(summary).toMatch(day);
    }
  });

  it("formats `contient_item` with a category", () => {
    const summary = formatConditionsSummary([
      { kind: "contient_item", category: "Boissons" },
    ]);
    expect(summary).toMatch(/Boissons/);
    expect(summary).toMatch(/cat[ée]gorie/i);
  });

  it("formats `contient_item` with an itemId (raw id surfaced — slice 1 fallback)", () => {
    // Slice 1 has no item-name resolution (no menuItems join). The id is
    // surfaced so the gérant can still locate the rule; the builder (slices
    // 2-5) will swap to the item's display name. We pin the fallback shape
    // (« Contient l'item ... ») so a future regression that drops the id
    // entirely fails loudly.
    const summary = formatConditionsSummary([
      { kind: "contient_item", itemId: "k1234567890item" },
    ]);
    expect(summary).toMatch(/item/i);
    expect(summary).toMatch(/k1234567890item/);
  });

  it("joins multiple conditions with « · » (middle dot, AND-ed)", () => {
    const conditions: PricingCondition[] = [
      { kind: "total_panier", operator: "gte", valueCents: 2500 },
      { kind: "jour_semaine", days: ["LU", "MA"] },
      { kind: "premiere_cmd_client", value: true },
    ];
    const summary = formatConditionsSummary(conditions);
    expect(summary).toMatch(/Panier/);
    expect(summary).toMatch(/Lundi/);
    expect(summary).toMatch(/Premi[èe]re/);
    // Middle dot used as separator (issue body example).
    expect(summary).toMatch(/·/);
    // 3 conditions → 2 separators.
    expect(summary.split("·").length).toBe(3);
  });

  it("returns a non-empty fallback for an empty conditions array", () => {
    // A rule with [] conditions matches always. The list cell must render
    // SOMETHING (not an empty string) — pin a fallback so a future slice that
    // forgets the case fails the test.
    const summary = formatConditionsSummary([]);
    expect(summary.length).toBeGreaterThan(0);
    // « Toujours » or « Sans condition » — load-bearing FR word.
    expect(summary).toMatch(/toujours|sans condition|aucune condition/i);
  });
});

describe("formatActionSummary — F-PRICING-1 (#241)", () => {
  it("formats `livraison_offerte_resto` as « Livraison offerte par le resto »", () => {
    const action: PricingAction = { kind: "livraison_offerte_resto" };
    const summary = formatActionSummary(action);
    expect(summary).toMatch(/Livraison/i);
    expect(summary).toMatch(/offerte/i);
    expect(summary).toMatch(/resto/i);
    // Must NOT say « offerte client » or « offerte KitchenBoost » — Q35-Q1.
    expect(summary).not.toMatch(/offerte\s+client/i);
    expect(summary).not.toMatch(/KitchenBoost/i);
  });

  it("formats `frais_livraison_part_resto_fixe 250 cents` as « Part fixe absorbée : 2,50 € »", () => {
    const action: PricingAction = {
      kind: "frais_livraison_part_resto_fixe",
      valueCents: 250,
    };
    const summary = formatActionSummary(action);
    expect(summary).toMatch(/Part/i);
    expect(summary).toMatch(/absorb[ée]e/i);
    expect(summary).toMatch(/2,50\s?€/);
    expect(summary).not.toMatch(/250(?!\s*,)/); // not the raw cents
  });

  it("formats `frais_livraison_part_resto_pourcentage_panier 30 %` as « Part absorbée : 30 % du panier »", () => {
    const action: PricingAction = {
      kind: "frais_livraison_part_resto_pourcentage_panier",
      percent: 30,
    };
    const summary = formatActionSummary(action);
    expect(summary).toMatch(/Part/i);
    expect(summary).toMatch(/absorb[ée]e/i);
    expect(summary).toMatch(/30\s?%/);
    expect(summary).toMatch(/panier/i);
  });
});
