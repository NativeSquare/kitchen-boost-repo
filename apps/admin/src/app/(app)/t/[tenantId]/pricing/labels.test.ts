/**
 * F-PRICING-1 (#241) — French label maps for the 6 V1 condition kinds and the
 * 3 V1 action kinds (PRD 35 §1 / PRD 70 §4.6).
 *
 * The map is the SINGLE SOURCE OF TRUTH for French copy used across the pricing
 * module (slice 1 = liste read-only; slices 2-5 will add the builder). Centralising
 * here means a copy tweak lands in ONE place — pinned at the structural level
 * (every kind enumerated) AND at the lexical level (a few load-bearing words) so
 * a regression on either axis fails loudly.
 *
 * Module-API discipline (#241 hard constraint): exposed via `./index.ts`, never
 * imported through deep relative paths.
 */
import { describe, expect, it } from "vitest";

import {
  CONDITION_KIND_LABELS,
  ACTION_KIND_LABELS,
  type ConditionKind,
  type ActionKind,
} from "./labels";

describe("CONDITION_KIND_LABELS — F-PRICING-1 (#241)", () => {
  it("covers the 6 V1 condition kinds (PRD 35 §1, closed list)", () => {
    // Pinned verbatim — drift here means the backend schema added/removed a
    // kind and the front silently fell behind. If that's the intent, fix the
    // map AND this test together.
    const kinds: ConditionKind[] = [
      "total_panier",
      "premiere_cmd_client",
      "nombre_cmds_client",
      "plage_horaire",
      "jour_semaine",
      "contient_item",
    ];
    for (const k of kinds) {
      expect(CONDITION_KIND_LABELS[k]).toBeTypeOf("string");
      expect(CONDITION_KIND_LABELS[k].length).toBeGreaterThan(0);
    }
    // No EXTRA kinds — keep the map exactly aligned to the backend's closed
    // list (a stray "mode_livraison" / "distance_livraison_km" from the
    // retired V1 list would silently re-enter the UI otherwise).
    expect(Object.keys(CONDITION_KIND_LABELS).sort()).toEqual(
      [...kinds].sort(),
    );
  });

  it("labels are French, lowercase-friendly, no jargon (a few load-bearing words pinned)", () => {
    // We don't pin every word — just the load-bearing French ones that the
    // gérant skims for in the list (« panier », « première », « horaire »,
    // « semaine », « item »). A future copy refactor can rephrase as long
    // as the keyword surfaces.
    expect(CONDITION_KIND_LABELS.total_panier).toMatch(/panier/i);
    expect(CONDITION_KIND_LABELS.premiere_cmd_client).toMatch(/premi[èe]re/i);
    expect(CONDITION_KIND_LABELS.nombre_cmds_client).toMatch(/commande/i);
    expect(CONDITION_KIND_LABELS.plage_horaire).toMatch(/horaire/i);
    expect(CONDITION_KIND_LABELS.jour_semaine).toMatch(/jour/i);
    expect(CONDITION_KIND_LABELS.contient_item).toMatch(/item|article|cat/i);
  });
});

describe("ACTION_KIND_LABELS — F-PRICING-1 (#241)", () => {
  it("covers the 3 V1 action kinds (PRD 35 §1, closed list)", () => {
    // `livraison_offerte_client` is DELIBERATELY ABSENT — KB does not subsidise
    // delivery in V1 (Q35-Q1) and the backend schema doesn't expose it. The
    // assertion below would catch a "useful-looking" addition by mistake.
    const kinds: ActionKind[] = [
      "livraison_offerte_resto",
      "frais_livraison_part_resto_fixe",
      "frais_livraison_part_resto_pourcentage_panier",
    ];
    for (const k of kinds) {
      expect(ACTION_KIND_LABELS[k]).toBeTypeOf("string");
      expect(ACTION_KIND_LABELS[k].length).toBeGreaterThan(0);
    }
    expect(Object.keys(ACTION_KIND_LABELS).sort()).toEqual([...kinds].sort());
  });

  it("explicit French copy for the 3 actions (resto pays the absorbed share — no client subsidy V1)", () => {
    // Each action mentions « resto » (the absorber) — the gérant reads the
    // list and must see at a glance who's footing the bill. The labels MUST
    // NOT say « offerte par KitchenBoost » or « offerte client » (the moat:
    // KB does not subsidise, Q35-Q1).
    expect(ACTION_KIND_LABELS.livraison_offerte_resto).toMatch(/resto/i);
    expect(ACTION_KIND_LABELS.livraison_offerte_resto).toMatch(/offerte/i);

    expect(ACTION_KIND_LABELS.frais_livraison_part_resto_fixe).toMatch(
      /resto/i,
    );
    expect(
      ACTION_KIND_LABELS.frais_livraison_part_resto_pourcentage_panier,
    ).toMatch(/resto/i);

    // The 3 actions must NOT name the client as payer or KB as subsidiser
    // (Q35-Q1) — pin both bans on the whole map.
    const all = Object.values(ACTION_KIND_LABELS).join(" ");
    expect(all).not.toMatch(/offerte\s+client/i);
    expect(all).not.toMatch(/KitchenBoost/i);
  });
});
