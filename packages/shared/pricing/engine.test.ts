import { describe, it, expect } from "vitest";
import { engine } from "./index.js";
import type { Action, Condition, PricingInput, Rule } from "./index.js";

// ─── helpers ──────────────────────────────────────────────────────────────
// Gross Uber Direct cost used across most tests: 5,90 € = 590 cents (PRD §0).
const GROSS = 590;

function rule(action: Action, conditions: Condition[] = [], id = "r"): Rule {
  return { id, conditions, action };
}

function input(overrides: Partial<PricingInput> = {}): PricingInput {
  return {
    items: [{ itemId: "burger", category: "plats", quantity: 1 }],
    totalPanierCents: 2000,
    orderDateTime: new Date("2026-05-26T13:00:00"), // a Tuesday (MA), 13:00
    customer: { isFirstOrder: false, orderCount: 3 },
    grossDeliveryCostCents: GROSS,
    rules: [],
    ...overrides,
  };
}

// ─── fallback ───────────────────────────────────────────────────────────────
describe("fallback (no rule matches)", () => {
  it("with no rules at all, the client pays the full gross cost", () => {
    const r = engine.evaluate(input({ rules: [] }));
    expect(r.winningRuleId).toBeNull();
    expect(r.fraisLivraisonClientCents).toBe(GROSS);
    expect(r.fraisLivraisonRestoCents).toBe(0);
  });

  it("when present rules all fail to match, falls back to client pays gross", () => {
    const r = engine.evaluate(
      input({
        totalPanierCents: 1000,
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "total_panier", operator: "gte", valueCents: 2500 },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBeNull();
    expect(r.fraisLivraisonClientCents).toBe(GROSS);
    expect(r.fraisLivraisonRestoCents).toBe(0);
  });
});

// ─── the 3 actions ────────────────────────────────────────────────────────
describe("action: livraison_offerte_resto", () => {
  it("resto absorbs 100% of gross, client pays 0", () => {
    const r = engine.evaluate(
      input({ rules: [rule({ kind: "livraison_offerte_resto" })] }),
    );
    expect(r.winningRuleId).toBe("r");
    expect(r.fraisLivraisonClientCents).toBe(0);
    expect(r.fraisLivraisonRestoCents).toBe(GROSS);
  });
});

describe("action: frais_livraison_part_resto_fixe", () => {
  it("resto absorbs the fixed amount, client pays the rest", () => {
    const r = engine.evaluate(
      input({
        rules: [
          rule({ kind: "frais_livraison_part_resto_fixe", valueCents: 200 }),
        ],
      }),
    );
    expect(r.fraisLivraisonRestoCents).toBe(200);
    expect(r.fraisLivraisonClientCents).toBe(GROSS - 200); // 390
  });

  it("caps the fixed amount at the gross cost (resto never absorbs more)", () => {
    const r = engine.evaluate(
      input({
        rules: [
          rule({ kind: "frais_livraison_part_resto_fixe", valueCents: 900 }),
        ],
      }),
    );
    expect(r.fraisLivraisonRestoCents).toBe(GROSS); // capped
    expect(r.fraisLivraisonClientCents).toBe(0); // never below 0
  });
});

describe("action: frais_livraison_part_resto_pourcentage_panier", () => {
  it("computes the percentage on the cart total, not on the delivery cost", () => {
    // 10% of a 30,00 € (3000) cart = 300, well under the 590 cap.
    const r = engine.evaluate(
      input({
        totalPanierCents: 3000,
        rules: [
          rule({
            kind: "frais_livraison_part_resto_pourcentage_panier",
            percent: 10,
          }),
        ],
      }),
    );
    expect(r.fraisLivraisonRestoCents).toBe(300);
    expect(r.fraisLivraisonClientCents).toBe(GROSS - 300); // 290
  });

  it("caps the percentage share at the gross cost", () => {
    // 50% of a 30,00 € cart = 1500 > 590 → capped to 590.
    const r = engine.evaluate(
      input({
        totalPanierCents: 3000,
        rules: [
          rule({
            kind: "frais_livraison_part_resto_pourcentage_panier",
            percent: 50,
          }),
        ],
      }),
    );
    expect(r.fraisLivraisonRestoCents).toBe(GROSS);
    expect(r.fraisLivraisonClientCents).toBe(0);
  });
});

// ─── PRD default-rule cases: 10% on 12 € / 30 € / 60 € (PRD §7) ──────────────
describe("PRD default rule (10% panier) on the three reference baskets", () => {
  const defaultRule = rule({
    kind: "frais_livraison_part_resto_pourcentage_panier",
    percent: 10,
  });

  it("panier 12 € → resto absorbs 1,20 €, client pays 4,70 €", () => {
    const r = engine.evaluate(
      input({ totalPanierCents: 1200, rules: [defaultRule] }),
    );
    expect(r.fraisLivraisonRestoCents).toBe(120);
    expect(r.fraisLivraisonClientCents).toBe(470);
  });

  it("panier 30 € → resto absorbs 3,00 €, client pays 2,90 €", () => {
    const r = engine.evaluate(
      input({ totalPanierCents: 3000, rules: [defaultRule] }),
    );
    expect(r.fraisLivraisonRestoCents).toBe(300);
    expect(r.fraisLivraisonClientCents).toBe(290);
  });

  it("panier 60 € → resto absorbs 5,90 € (capped), client pays 0 €", () => {
    const r = engine.evaluate(
      input({ totalPanierCents: 6000, rules: [defaultRule] }),
    );
    expect(r.fraisLivraisonRestoCents).toBe(590);
    expect(r.fraisLivraisonClientCents).toBe(0);
  });
});

// ─── condition matrix (the 6 conditions, each operator, AND, false cases) ────
describe("condition: total_panier", () => {
  it("gte matches when cart total is at or above the threshold", () => {
    const r = engine.evaluate(
      input({
        totalPanierCents: 2500,
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "total_panier", operator: "gte", valueCents: 2500 },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });

  it("gte does not match below the threshold", () => {
    const r = engine.evaluate(
      input({
        totalPanierCents: 2499,
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "total_panier", operator: "gte", valueCents: 2500 },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBeNull();
  });

  it("lte matches at or below the threshold", () => {
    const r = engine.evaluate(
      input({
        totalPanierCents: 1500,
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "total_panier", operator: "lte", valueCents: 1500 },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });

  it("lte does not match above the threshold", () => {
    const r = engine.evaluate(
      input({
        totalPanierCents: 1501,
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "total_panier", operator: "lte", valueCents: 1500 },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBeNull();
  });
});

describe("condition: premiere_cmd_client", () => {
  it("matches when the flag equals the customer's first-order status", () => {
    const r = engine.evaluate(
      input({
        customer: { isFirstOrder: true, orderCount: 0 },
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "premiere_cmd_client", value: true },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });

  it("does not match when the flag differs", () => {
    const r = engine.evaluate(
      input({
        customer: { isFirstOrder: false, orderCount: 5 },
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "premiere_cmd_client", value: true },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBeNull();
  });

  it("matches when explicitly requiring a non-first order", () => {
    const r = engine.evaluate(
      input({
        customer: { isFirstOrder: false, orderCount: 5 },
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "premiere_cmd_client", value: false },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });
});

describe("condition: nombre_cmds_client", () => {
  it("gte matches at or above the count", () => {
    const r = engine.evaluate(
      input({
        customer: { isFirstOrder: false, orderCount: 10 },
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "nombre_cmds_client", operator: "gte", value: 10 },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });

  it("gte does not match below the count", () => {
    const r = engine.evaluate(
      input({
        customer: { isFirstOrder: false, orderCount: 9 },
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "nombre_cmds_client", operator: "gte", value: 10 },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBeNull();
  });

  it("lte matches at or below the count", () => {
    const r = engine.evaluate(
      input({
        customer: { isFirstOrder: false, orderCount: 2 },
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "nombre_cmds_client", operator: "lte", value: 2 },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });
});

describe("condition: plage_horaire", () => {
  it("matches inside the time range (boundaries inclusive)", () => {
    const r = engine.evaluate(
      input({
        orderDateTime: new Date("2026-05-26T12:00:00"),
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "plage_horaire", start: "12:00", end: "14:00" },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });

  it("matches at the closing boundary", () => {
    const r = engine.evaluate(
      input({
        orderDateTime: new Date("2026-05-26T14:00:00"),
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "plage_horaire", start: "12:00", end: "14:00" },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });

  it("does not match outside the time range", () => {
    const r = engine.evaluate(
      input({
        orderDateTime: new Date("2026-05-26T14:01:00"),
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "plage_horaire", start: "12:00", end: "14:00" },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBeNull();
  });
});

describe("condition: jour_semaine", () => {
  it("matches when the order day is in the selected set", () => {
    // 2026-05-26 is a Tuesday (MA).
    const r = engine.evaluate(
      input({
        orderDateTime: new Date("2026-05-26T13:00:00"),
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "jour_semaine", days: ["MA", "ME"] },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });

  it("does not match when the order day is not selected", () => {
    const r = engine.evaluate(
      input({
        orderDateTime: new Date("2026-05-26T13:00:00"), // Tuesday
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "jour_semaine", days: ["SA", "DI"] },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBeNull();
  });

  it("matches a Sunday correctly (DI)", () => {
    // 2026-05-24 is a Sunday.
    const r = engine.evaluate(
      input({
        orderDateTime: new Date("2026-05-24T10:00:00"),
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "jour_semaine", days: ["DI"] },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });
});

describe("condition: contient_item", () => {
  const cart = [
    { itemId: "burger", category: "plats", quantity: 1 },
    { itemId: "coca", category: "boissons", quantity: 2 },
  ];

  it("matches by category", () => {
    const r = engine.evaluate(
      input({
        items: cart,
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "contient_item", category: "boissons" },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });

  it("matches by specific item id", () => {
    const r = engine.evaluate(
      input({
        items: cart,
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "contient_item", itemId: "burger" },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });

  it("does not match an absent category", () => {
    const r = engine.evaluate(
      input({
        items: cart,
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "contient_item", category: "desserts" },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBeNull();
  });

  it("does not match an absent item id", () => {
    const r = engine.evaluate(
      input({
        items: cart,
        rules: [
          rule({ kind: "livraison_offerte_resto" }, [
            { kind: "contient_item", itemId: "pizza" },
          ]),
        ],
      }),
    );
    expect(r.winningRuleId).toBeNull();
  });
});

// ─── AND combination ─────────────────────────────────────────────────────────
describe("conditions combine with AND", () => {
  const conds: Condition[] = [
    { kind: "total_panier", operator: "gte", valueCents: 2500 },
    { kind: "premiere_cmd_client", value: true },
  ];

  it("matches only when ALL conditions are true", () => {
    const r = engine.evaluate(
      input({
        totalPanierCents: 3000,
        customer: { isFirstOrder: true, orderCount: 0 },
        rules: [rule({ kind: "livraison_offerte_resto" }, conds)],
      }),
    );
    expect(r.winningRuleId).toBe("r");
  });

  it("does not match when one condition is false", () => {
    const r = engine.evaluate(
      input({
        totalPanierCents: 3000,
        customer: { isFirstOrder: false, orderCount: 4 }, // second condition fails
        rules: [rule({ kind: "livraison_offerte_resto" }, conds)],
      }),
    );
    expect(r.winningRuleId).toBeNull();
  });
});

// ─── deterministic multi-rule selection (minimise client fee) ────────────────
describe("multi-rule selection (deterministic, minimise client fee)", () => {
  it("picks the rule that minimises the client fee (CONTEXT example)", () => {
    // 30 € new-customer cart. Rule A (≥25 € → offerte) and rule B (1st cmd →
    // 50% absorbed) both match. A makes the client pay 0; B would make them pay
    // 590-1500-capped... → A wins. (CONTEXT "Priorité" example.)
    const ruleA = rule(
      { kind: "livraison_offerte_resto" },
      [{ kind: "total_panier", operator: "gte", valueCents: 2500 }],
      "A",
    );
    const ruleB = rule(
      { kind: "frais_livraison_part_resto_fixe", valueCents: 295 },
      [{ kind: "premiere_cmd_client", value: true }],
      "B",
    );
    const r = engine.evaluate(
      input({
        totalPanierCents: 3000,
        customer: { isFirstOrder: true, orderCount: 0 },
        rules: [ruleB, ruleA], // order in the array must NOT matter
      }),
    );
    expect(r.winningRuleId).toBe("A");
    expect(r.fraisLivraisonClientCents).toBe(0);
  });

  it("is order-independent: same winner whatever the array order", () => {
    const cheaper = rule(
      { kind: "frais_livraison_part_resto_fixe", valueCents: 400 },
      [],
      "cheaper",
    );
    const pricier = rule(
      { kind: "frais_livraison_part_resto_fixe", valueCents: 100 },
      [],
      "pricier",
    );
    const r1 = engine.evaluate(input({ rules: [cheaper, pricier] }));
    const r2 = engine.evaluate(input({ rules: [pricier, cheaper] }));
    expect(r1.winningRuleId).toBe("cheaper");
    expect(r2.winningRuleId).toBe("cheaper");
    expect(r1.fraisLivraisonClientCents).toBe(r2.fraisLivraisonClientCents);
  });

  it("never stacks two rules (only one winner applies)", () => {
    const a = rule(
      { kind: "frais_livraison_part_resto_fixe", valueCents: 200 },
      [],
      "a",
    );
    const b = rule(
      { kind: "frais_livraison_part_resto_fixe", valueCents: 200 },
      [],
      "b",
    );
    const r = engine.evaluate(input({ rules: [a, b] }));
    // If they stacked, resto would absorb 400. Only one applies → 200.
    expect(r.fraisLivraisonRestoCents).toBe(200);
    expect(r.fraisLivraisonClientCents).toBe(GROSS - 200);
  });

  it("on an exact tie, the result is deterministic across calls", () => {
    const a = rule(
      { kind: "frais_livraison_part_resto_fixe", valueCents: 200 },
      [],
      "a",
    );
    const b = rule(
      { kind: "frais_livraison_part_resto_fixe", valueCents: 200 },
      [],
      "b",
    );
    const r1 = engine.evaluate(input({ rules: [a, b] }));
    const r2 = engine.evaluate(input({ rules: [a, b] }));
    expect(r1.winningRuleId).toBe(r2.winningRuleId);
  });
});

// ─── invariant ────────────────────────────────────────────────────────────
describe("invariant: client + resto = gross cost", () => {
  const cases: Array<{ name: string; in: PricingInput }> = [
    { name: "fallback", in: input({ rules: [] }) },
    {
      name: "offerte resto",
      in: input({ rules: [rule({ kind: "livraison_offerte_resto" })] }),
    },
    {
      name: "fixe under cap",
      in: input({
        rules: [
          rule({ kind: "frais_livraison_part_resto_fixe", valueCents: 250 }),
        ],
      }),
    },
    {
      name: "fixe over cap",
      in: input({
        rules: [
          rule({ kind: "frais_livraison_part_resto_fixe", valueCents: 9999 }),
        ],
      }),
    },
    {
      name: "pourcentage",
      in: input({
        totalPanierCents: 4321,
        rules: [
          rule({
            kind: "frais_livraison_part_resto_pourcentage_panier",
            percent: 7,
          }),
        ],
      }),
    },
  ];

  for (const c of cases) {
    it(`holds for: ${c.name}`, () => {
      const r = engine.evaluate(c.in);
      expect(r.fraisLivraisonClientCents + r.fraisLivraisonRestoCents).toBe(
        c.in.grossDeliveryCostCents,
      );
      expect(r.fraisLivraisonClientCents).toBeGreaterThanOrEqual(0);
      expect(r.fraisLivraisonRestoCents).toBeLessThanOrEqual(
        c.in.grossDeliveryCostCents,
      );
      expect(r.fraisLivraisonRestoCents).toBeGreaterThanOrEqual(0);
    });
  }
});

// ─── purity / determinism ────────────────────────────────────────────────────
describe("purity", () => {
  it("does not mutate its input", () => {
    const original = input({
      rules: [
        rule({ kind: "frais_livraison_part_resto_fixe", valueCents: 200 }),
      ],
    });
    const snapshot = JSON.stringify({
      totalPanierCents: original.totalPanierCents,
      grossDeliveryCostCents: original.grossDeliveryCostCents,
      rules: original.rules,
      items: original.items,
      customer: original.customer,
    });
    engine.evaluate(original);
    expect(
      JSON.stringify({
        totalPanierCents: original.totalPanierCents,
        grossDeliveryCostCents: original.grossDeliveryCostCents,
        rules: original.rules,
        items: original.items,
        customer: original.customer,
      }),
    ).toBe(snapshot);
  });

  it("returns the same output for the same input (deterministic)", () => {
    const i = input({
      totalPanierCents: 3333,
      rules: [
        rule({
          kind: "frais_livraison_part_resto_pourcentage_panier",
          percent: 10,
        }),
      ],
    });
    expect(engine.evaluate(i)).toEqual(engine.evaluate(i));
  });
});
