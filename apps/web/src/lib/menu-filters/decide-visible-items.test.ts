/**
 * PWA-S4 (#452) — `decideVisibleItems` — PURE function that applies the V1
 * front-side dietary filters (Sans gluten / Vegan / Végé) to a list of menu
 * items (`PublicMenuItem[]`). Written BEFORE the implementation (TDD red).
 *
 * V1 FRONT-SIDE FILTER ONLY (CONTEXT client-ordering "Allergènes",
 * decisions-log Q2): `getPublicMenu` returns the full set of 14 allergens
 * per item; the PWA filter `Sans gluten / Vegan / Végé` is applied
 * client-side over that set — there is NO backend filter query, NO filter arg
 * on the endpoint.
 *
 * The filter map (V1 frozen):
 *  - `sans-gluten` ⇒ item is visible iff it does NOT carry `gluten` in its allergens.
 *  - `vegetarien`  ⇒ item is visible iff it carries NONE of the animal allergens:
 *                    `crustacés`, `œufs`, `poissons`, `lait`, `mollusques`. (Items
 *                    can carry plant allergens — gluten/soja/etc. — and still be
 *                    végétariens.)
 *  - `vegan`       ⇒ stricter than `vegetarien`: excludes the animal allergens
 *                    above. (No standalone « animal » allergen exists in UE 1169
 *                    — eggs/dairy/fish/etc. ARE the markers.)
 *
 * Multiple active filters compose AND (every active filter must accept the item).
 *
 * Why pure: the filter set is selected by the client UI checkboxes; the result
 * is a re-renderable list. Keeping it pure lets vitest pin every branch in
 * node env without rendering React.
 */
import { describe, expect, it } from "vitest";
import {
  type DietaryFilter,
  type FilterableMenuItem,
  decideVisibleItems,
} from "./decide-visible-items";

/** Tiny fixture factory — keeps each test self-contained. */
function item(
  id: string,
  allergens: FilterableMenuItem["allergens"],
): FilterableMenuItem {
  return {
    _id: id,
    name: `Item ${id}`,
    allergens,
  };
}

const SMASH_BURGER = item("burger", ["gluten", "lait", "œufs"]);
const FRITES = item("frites", []); // pas d'allergène déclaré
const SALAD_CRUSTACES = item("salad", ["crustacés"]);
const BAO_GLUTEN = item("bao", ["gluten", "graines de sésame", "soja"]);
const VEGAN_BOWL = item("bowl", ["soja"]); // soja = plante, OK vegan

const ALL = [SMASH_BURGER, FRITES, SALAD_CRUSTACES, BAO_GLUTEN, VEGAN_BOWL];

describe("decideVisibleItems — no filters active", () => {
  it("returns every item unchanged (set: empty)", () => {
    const result = decideVisibleItems(ALL, new Set<DietaryFilter>());
    expect(result).toHaveLength(ALL.length);
    expect(result.map((i) => i._id)).toEqual([
      "burger",
      "frites",
      "salad",
      "bao",
      "bowl",
    ]);
  });
});

describe("decideVisibleItems — sans-gluten", () => {
  it("hides items carrying `gluten`", () => {
    const result = decideVisibleItems(ALL, new Set(["sans-gluten"]));
    const ids = result.map((i) => i._id);
    expect(ids).not.toContain("burger");
    expect(ids).not.toContain("bao");
    expect(ids).toContain("frites");
    expect(ids).toContain("salad");
    expect(ids).toContain("bowl");
  });

  it("keeps items with no declared allergens (regulatory-compliant by absence)", () => {
    // FRITES has [] — the resto declared zero allergens. `sans-gluten` MUST
    // surface it (else a perfectly safe item would vanish). The legal
    // responsibility for the declaration is on the resto (CONTEXT
    // « Allergènes » : « responsabilité légale du resto qui reste
    // responsable de la véracité »); the PWA only enforces presence-check.
    const result = decideVisibleItems([FRITES], new Set(["sans-gluten"]));
    expect(result).toHaveLength(1);
  });
});

describe("decideVisibleItems — vegetarien", () => {
  it("hides items carrying any of the 5 animal allergens (crustacés, œufs, poissons, lait, mollusques)", () => {
    const result = decideVisibleItems(ALL, new Set(["vegetarien"]));
    const ids = result.map((i) => i._id);
    expect(ids).not.toContain("burger"); // lait + œufs
    expect(ids).not.toContain("salad"); // crustacés
    expect(ids).toContain("frites");
    expect(ids).toContain("bao"); // gluten + sésame + soja — plant-only
    expect(ids).toContain("bowl"); // soja — plant-only
  });
});

describe("decideVisibleItems — vegan", () => {
  it("excludes the 5 animal allergens (same set as végétarien V1)", () => {
    // V1: UE 1169 doesn't carry a standalone « miel »/« beurre » marker; the 5
    // animal allergens are the proxy. Plant-only allergens (gluten / soja /
    // sésame / fruits à coque / arachides / céleri / moutarde / sulfites /
    // lupin) DO NOT exclude an item from vegan.
    const result = decideVisibleItems([VEGAN_BOWL], new Set(["vegan"]));
    expect(result).toHaveLength(1);
  });

  it("hides items with any animal allergen", () => {
    const result = decideVisibleItems(
      [SMASH_BURGER, SALAD_CRUSTACES],
      new Set(["vegan"]),
    );
    expect(result).toHaveLength(0);
  });
});

describe("decideVisibleItems — multiple filters compose AND", () => {
  it("only surfaces items passing EVERY active filter", () => {
    // sans-gluten + vegan → must exclude gluten AND every animal allergen.
    // FRITES ([]) passes both. BAO has gluten ⇒ out. BOWL has soja (vegan
    // OK) but no gluten ⇒ in. SALAD has crustacés ⇒ out. BURGER ⇒ out.
    const result = decideVisibleItems(ALL, new Set(["sans-gluten", "vegan"]));
    const ids = result.map((i) => i._id);
    expect(ids).toEqual(["frites", "bowl"]);
  });
});

describe("decideVisibleItems — input immutability", () => {
  it("returns a new array (does not mutate the input)", () => {
    const input = [...ALL];
    const result = decideVisibleItems(input, new Set(["sans-gluten"]));
    expect(input).toHaveLength(ALL.length); // input untouched
    expect(result).not.toBe(input); // referentially new
  });
});
