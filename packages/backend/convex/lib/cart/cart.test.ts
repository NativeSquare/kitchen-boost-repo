import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";

// convex-test needs the function modules; array-negation glob form is required
// (extglob `!(*.test)` returns ZERO modules — project memory). This file lives in
// convex/lib/cart/, so Vite emits keys relative to THIS dir (`./cart.ts`,
// `../menu/...`, `../../table/...`). Re-anchor EVERY key at the convex root so
// convex-test's findModulesRoot has ONE common prefix (same intent as the orders /
// menu / customer suites): `./x` → `../../lib/cart/x`, `../x` → `../../lib/x`.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (key.startsWith("./")) key = `../../lib/cart/${key.slice(2)}`;
    else if (key.startsWith("../") && !key.startsWith("../../"))
      key = `../../lib/${key.slice(3)}`;
    return [key, loader];
  }),
);

/**
 * 2.3-B — `createOrderFromCart` (checkout → order `en attente de paiement`,
 * FROZEN lines), written BEFORE the implementation (TDD red).
 *
 * The mutation is a `customerMutation` (self-scope): the order belongs to the
 * CALLER's own `customers` fiche (resolved silently from `ctx.actor.userId` — no
 * `customerId` arg). The cart submitted by the eater is validated against the 2.2
 * menu (item exists + belongs to the SAME tenant + available + modifier
 * min/max-select satisfied) and the resulting `orderItems` are an IMMUTABLE
 * snapshot of name/price/modifiers+priceDelta/allergens at checkout time (PRD 10
 * §7) — a later menu edit never mutates them. 1 line per item × modifiers
 * combination (Q10-Q8c). Reaches the tables ONLY through the sanctioned
 * `lib/tenancy` seam (ADR 0010 / `no-untenanted-query`); ships a cross-tenant
 * fuzz suite.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** A menu fixture for one tenant: an item + two reusable groups (1 mandatory). */
type MenuFixture = {
  categoryId: Id<"menuCategories">;
  /** "Smash Double", available, allergens gluten+lait. */
  itemId: Id<"menuItems">;
  /** A second AVAILABLE item with no modifier groups. */
  friesId: Id<"menuItems">;
  /** An UNAVAILABLE item. */
  soldOutId: Id<"menuItems">;
  /** Mandatory single-choice "Sauce" group (min 1, max 1): Ketchup / Mayo(+50). */
  sauceGroupId: Id<"modifierGroups">;
  /** Optional multi-choice "Extras" group (min 0, max 2): Bacon(+100)/Egg(+80). */
  extrasGroupId: Id<"modifierGroups">;
};

/**
 * Seed a small menu on the given tenant using the 2.2 CRUD (kb_manager), so the
 * fixture mirrors exactly how a real menu is built (no hand-poked rows).
 */
async function seedMenu(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  managerId: Id<"users">,
): Promise<MenuFixture> {
  const as = t.withIdentity({ subject: managerId });

  // Slice F (#57) gates the checkout on the resto's operational status: a resto
  // with NO service hours is CLOSED, so the 2.3-B fixtures open it all week (and
  // leave the pause unset) — the menu-validation cases this suite exercises must
  // not be masked by the closed/pause gate.
  await as.mutation(api.lib.menu.serviceHours.set, {
    tenantId,
    windows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      startMinute: 0,
      endMinute: 1439,
    })),
  });

  const categoryId = (await as.mutation(api.lib.menu.categories.create, {
    tenantId,
    name: "Smashs",
  })) as Id<"menuCategories">;

  const itemId = (await as.mutation(api.lib.menu.items.create, {
    tenantId,
    categoryId,
    name: "Smash Double",
    description: "Double steak, cheddar",
    basePrice: 1290,
    allergens: ["gluten", "lait"],
  })) as Id<"menuItems">;

  const friesId = (await as.mutation(api.lib.menu.items.create, {
    tenantId,
    categoryId,
    name: "Frites",
    description: "",
    basePrice: 390,
    allergens: [],
  })) as Id<"menuItems">;

  const soldOutId = (await as.mutation(api.lib.menu.items.create, {
    tenantId,
    categoryId,
    name: "Milkshake",
    description: "",
    basePrice: 590,
    allergens: ["lait"],
  })) as Id<"menuItems">;
  // Toggle it out of stock.
  await as.mutation(api.lib.menu.items.update, {
    tenantId,
    itemId: soldOutId,
    categoryId,
    name: "Milkshake",
    description: "",
    basePrice: 590,
    allergens: ["lait"],
    available: false,
  });

  const sauceGroupId = (await as.mutation(api.lib.menu.modifiers.createGroup, {
    tenantId,
    name: "Sauce",
    minSelect: 1,
    maxSelect: 1,
    options: [
      { label: "Ketchup", priceDelta: 0 },
      { label: "Mayo", priceDelta: 50 },
    ],
  })) as Id<"modifierGroups">;

  const extrasGroupId = (await as.mutation(api.lib.menu.modifiers.createGroup, {
    tenantId,
    name: "Extras",
    minSelect: 0,
    maxSelect: 2,
    options: [
      { label: "Bacon", priceDelta: 100 },
      { label: "Egg", priceDelta: 80 },
    ],
  })) as Id<"modifierGroups">;

  await as.mutation(api.lib.menu.modifiers.attachGroupToItem, {
    tenantId,
    itemId,
    modifierGroupId: sauceGroupId,
  });
  await as.mutation(api.lib.menu.modifiers.attachGroupToItem, {
    tenantId,
    itemId,
    modifierGroupId: extrasGroupId,
  });

  return {
    categoryId,
    itemId,
    friesId,
    soldOutId,
    sauceGroupId,
    extrasGroupId,
  };
}

/** Seed an anonymous customer (the shape the Anonymous provider produces). */
async function seedAnonymousCustomer(
  t: ReturnType<typeof convexTest>,
): Promise<Id<"users">> {
  return t.run(async (ctx) =>
    ctx.db.insert("users", { role: "customer", isAnonymous: true }),
  );
}

describe("2.3-B createOrderFromCart — checkout → en attente de paiement", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let menu: MenuFixture;
  let eater: Id<"users">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    menu = await seedMenu(t, seed.tenantA.tenantId, seed.tenantA.managerId);
    eater = await seedAnonymousCustomer(t);
  });

  it("creates an order in 'en attente de paiement' with frozen lines, owned by the caller", async () => {
    const as = t.withIdentity({ subject: eater });
    const orderId = await as.mutation(api.lib.cart.cart.createOrderFromCart, {
      tenantId: seed.tenantA.tenantId,
      mode: "delivery",
      address: "12 rue de Paris, 91000 Évry",
      lat: 48.62,
      lng: 2.44,
      restaurantNote: "Sans oignon svp",
      items: [
        {
          itemId: menu.itemId,
          quantity: 1,
          modifierSelections: [
            { modifierGroupId: menu.sauceGroupId, optionLabels: ["Ketchup"] },
          ],
        },
      ],
    });
    expect(orderId).toBeTypeOf("string");

    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.status).toBe("en attente de paiement");
    expect(order?.mode).toBe("delivery");
    expect(order?.source).toBe("direct");
    expect(order?.restaurantNote).toBe("Sans oignon svp");
    expect(order?.address).toBe("12 rue de Paris, 91000 Évry");
    // No pricing yet — the snapshot is filled/frozen at payment (slice C).
    expect(order?.pricingSnapshot).toBeUndefined();
    // The order is owned by the CALLER's own fiche (self-scope provisioning).
    const fiche = await t.run((ctx) => ctx.db.get(order!.customerId));
    expect(fiche?.userId).toBe(eater);

    const lines = await t.run((ctx) =>
      ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("orderId", orderId),
        )
        .collect(),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].itemName).toBe("Smash Double");
    expect(lines[0].unitPrice).toBe(1290);
    expect(lines[0].quantity).toBe(1);
    expect(lines[0].allergens).toEqual(["gluten", "lait"]);
    expect(lines[0].modifiers).toEqual([
      { groupName: "Sauce", optionName: "Ketchup", priceDelta: 0 },
    ]);
  });

  it("snapshots the modifier priceDelta from the menu (not 0)", async () => {
    const as = t.withIdentity({ subject: eater });
    const orderId = await as.mutation(api.lib.cart.cart.createOrderFromCart, {
      tenantId: seed.tenantA.tenantId,
      mode: "pickup",
      items: [
        {
          itemId: menu.itemId,
          quantity: 1,
          modifierSelections: [
            { modifierGroupId: menu.sauceGroupId, optionLabels: ["Mayo"] },
            {
              modifierGroupId: menu.extrasGroupId,
              optionLabels: ["Bacon", "Egg"],
            },
          ],
        },
      ],
    });
    const lines = await t.run((ctx) =>
      ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("orderId", orderId),
        )
        .collect(),
    );
    const deltas = lines[0].modifiers.map((m) => [m.optionName, m.priceDelta]);
    expect(deltas).toEqual([
      ["Mayo", 50],
      ["Bacon", 100],
      ["Egg", 80],
    ]);
  });

  it("produces 1 line per item × modifiers combination (no aggregation)", async () => {
    const as = t.withIdentity({ subject: eater });
    const orderId = await as.mutation(api.lib.cart.cart.createOrderFromCart, {
      tenantId: seed.tenantA.tenantId,
      mode: "pickup",
      items: [
        {
          itemId: menu.itemId,
          quantity: 1,
          modifierSelections: [
            { modifierGroupId: menu.sauceGroupId, optionLabels: ["Ketchup"] },
          ],
        },
        {
          // Same item, DIFFERENT modifier ⇒ a distinct line.
          itemId: menu.itemId,
          quantity: 2,
          modifierSelections: [
            { modifierGroupId: menu.sauceGroupId, optionLabels: ["Mayo"] },
          ],
        },
      ],
    });
    const lines = await t.run((ctx) =>
      ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("orderId", orderId),
        )
        .collect(),
    );
    expect(lines).toHaveLength(2);
    const byQty = [...lines].sort((a, b) => a.quantity - b.quantity);
    expect(byQty[0].modifiers[0].optionName).toBe("Ketchup");
    expect(byQty[0].quantity).toBe(1);
    expect(byQty[1].modifiers[0].optionName).toBe("Mayo");
    expect(byQty[1].quantity).toBe(2);
  });

  it("freezes the lines: editing the menu AFTER checkout never mutates the order", async () => {
    const as = t.withIdentity({ subject: eater });
    const orderId = await as.mutation(api.lib.cart.cart.createOrderFromCart, {
      tenantId: seed.tenantA.tenantId,
      mode: "pickup",
      items: [
        {
          itemId: menu.itemId,
          quantity: 1,
          modifierSelections: [
            { modifierGroupId: menu.sauceGroupId, optionLabels: ["Ketchup"] },
          ],
        },
      ],
    });

    // The resto raises the price + renames the item + changes a modifier delta.
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    await asMgr.mutation(api.lib.menu.items.update, {
      tenantId: seed.tenantA.tenantId,
      itemId: menu.itemId,
      categoryId: menu.categoryId,
      name: "Smash Triple",
      description: "now triple",
      basePrice: 9999,
      allergens: ["gluten", "lait", "œufs"],
      available: true,
    });
    await asMgr.mutation(api.lib.menu.modifiers.updateGroup, {
      tenantId: seed.tenantA.tenantId,
      modifierGroupId: menu.sauceGroupId,
      name: "Sauce",
      minSelect: 1,
      maxSelect: 1,
      options: [
        { label: "Ketchup", priceDelta: 777 },
        { label: "Mayo", priceDelta: 888 },
      ],
    });

    const lines = await t.run((ctx) =>
      ctx.db
        .query("orderItems")
        .withIndex("by_order", (q) =>
          q.eq("tenantId", seed.tenantA.tenantId).eq("orderId", orderId),
        )
        .collect(),
    );
    expect(lines[0].itemName).toBe("Smash Double"); // frozen name
    expect(lines[0].unitPrice).toBe(1290); // frozen price
    expect(lines[0].allergens).toEqual(["gluten", "lait"]); // frozen allergens
    expect(lines[0].modifiers[0].priceDelta).toBe(0); // frozen modifier delta
  });

  it("a click & collect order needs no delivery address", async () => {
    const as = t.withIdentity({ subject: eater });
    const orderId = await as.mutation(api.lib.cart.cart.createOrderFromCart, {
      tenantId: seed.tenantA.tenantId,
      mode: "pickup",
      items: [
        {
          itemId: menu.friesId,
          quantity: 1,
          modifierSelections: [],
        },
      ],
    });
    const order = await t.run((ctx) => ctx.db.get(orderId));
    expect(order?.mode).toBe("pickup");
    expect(order?.address).toBeUndefined();
  });

  // ── Validation against the menu (2.2) ────────────────────────────────────

  it("rejects an UNAVAILABLE item (Item out of stock)", async () => {
    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        items: [
          { itemId: menu.soldOutId, quantity: 1, modifierSelections: [] },
        ],
      }),
    ).rejects.toThrow(/stock|disponible|available/i);
  });

  it("rejects an unsatisfied mandatory modifier (min_select)", async () => {
    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        items: [
          {
            itemId: menu.itemId,
            quantity: 1,
            // "Sauce" is mandatory (min 1) but absent.
            modifierSelections: [],
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects selecting MORE options than max_select", async () => {
    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        items: [
          {
            itemId: menu.itemId,
            quantity: 1,
            modifierSelections: [
              // Sauce is single-choice (max 1) — two options is too many.
              {
                modifierGroupId: menu.sauceGroupId,
                optionLabels: ["Ketchup", "Mayo"],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects an option label that does not belong to the group", async () => {
    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        items: [
          {
            itemId: menu.itemId,
            quantity: 1,
            modifierSelections: [
              { modifierGroupId: menu.sauceGroupId, optionLabels: ["Aioli"] },
            ],
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects a modifier group NOT attached to the item", async () => {
    // A standalone group not attached to the item → not a valid choice for it.
    const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
    const looseGroupId = (await asMgr.mutation(
      api.lib.menu.modifiers.createGroup,
      {
        tenantId: seed.tenantA.tenantId,
        name: "Cuisson",
        minSelect: 0,
        maxSelect: 1,
        options: [{ label: "Saignant", priceDelta: 0 }],
      },
    )) as Id<"modifierGroups">;

    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        items: [
          {
            itemId: menu.friesId, // fries have NO groups attached
            quantity: 1,
            modifierSelections: [
              { modifierGroupId: looseGroupId, optionLabels: ["Saignant"] },
            ],
          },
        ],
      }),
    ).rejects.toThrow();
  });

  it("rejects an empty cart", async () => {
    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        items: [],
      }),
    ).rejects.toThrow();
  });

  it("rejects a non-positive quantity", async () => {
    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        items: [{ itemId: menu.friesId, quantity: 0, modifierSelections: [] }],
      }),
    ).rejects.toThrow();
  });

  it("rejects a restaurantNote longer than 200 chars", async () => {
    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        restaurantNote: "x".repeat(201),
        items: [{ itemId: menu.friesId, quantity: 1, modifierSelections: [] }],
      }),
    ).rejects.toThrow();
  });

  // ── Cross-tenant: an item reference belonging to ANOTHER tenant is rejected ──

  it("rejects a cart referencing an item that belongs to ANOTHER tenant", async () => {
    // Tenant B has its own menu; the eater orders on tenant A but smuggles a B item.
    const menuB = await seedMenu(
      t,
      seed.tenantB.tenantId,
      seed.tenantB.managerId,
    );
    const as = t.withIdentity({ subject: eater });
    await expect(
      as.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        items: [{ itemId: menuB.friesId, quantity: 1, modifierSelections: [] }],
      }),
    ).rejects.toThrow();
  });

  // ── Auth gate ─────────────────────────────────────────────────────────────

  it("throws Unauthenticated for an anonymous (no-identity) caller", async () => {
    await expect(
      t.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "pickup",
        items: [{ itemId: menu.friesId, quantity: 1, modifierSelections: [] }],
      }),
    ).rejects.toThrow(/unauthenticated/i);
  });

  it("throws Forbidden for a PRO (kb_admin) — checkout is a customer surface", async () => {
    await expect(
      t
        .withIdentity({ subject: seed.adminId })
        .mutation(api.lib.cart.cart.createOrderFromCart, {
          tenantId: seed.tenantA.tenantId,
          mode: "pickup",
          items: [
            { itemId: menu.friesId, quantity: 1, modifierSelections: [] },
          ],
        }),
    ).rejects.toThrow(/forbidden/i);
  });
});

describe("2.3-B cross-tenant fuzz — createOrderFromCart rejects unauthorized actors", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let menu: MenuFixture;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    menu = await seedMenu(t, seed.tenantA.tenantId, seed.tenantA.managerId);
  });

  // The customer wrapper's only GLOBAL non-customer actor is kb_admin (resto roles
  // are per-tenant; a manager/staff is globally a `customer` and IS a legitimate
  // eater — same convention as 2.1-B identity). So the isolation pinned here: the
  // global root + an anonymous caller never create an order through the checkout
  // surface, complemented by the structural self-scope (the handler only ever sees
  // its own `actor.userId`, so an order is born owned by the caller — never another
  // customer's fiche).
  it("the global root (kb_admin) + an anonymous caller are rejected by the checkout surface", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.cart.cart.createOrderFromCart],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "kb_admin", subject: seed.adminId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
      extraArgs: {
        mode: "pickup",
        items: [{ itemId: menu.friesId, quantity: 1, modifierSelections: [] }],
      },
    });
    expect(pairs).toBe(2);
    expect(leaks).toEqual([]);
  });
});
