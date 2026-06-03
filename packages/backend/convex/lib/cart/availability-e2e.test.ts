import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * #408 — E2E acceptance tests (PRD 20 §7c + issue body « 1-3 tests E2E »).
 *
 * Two end-to-end pin-downs of the « Toggle dispo item » event-driven
 * checkout reject behaviour:
 *
 *   (a) Khan toggles an item indispo while a client has it in the cart →
 *       the client's `createOrderFromCart` (the PWA checkout entry) is
 *       REJECTED with `INVALID_CART` « Item "..." is out of stock. » This
 *       proves the live-overlay rejection contract end-to-end across the two
 *       tenants of the model: KB Manager flips `available=false` →
 *       `setItemAvailability` mutation → the customer-facing
 *       `createOrderFromCart` (which calls `freezeCartItem` → reads the
 *       LIVE `menuItems.available`) refuses the line. No republication of
 *       the menu snapshot needed (ADR 0015 pivot, already pinned in
 *       availability.test.ts slice 6).
 *
 *   (b) Toggle the item BACK to available → the customer's
 *       `createOrderFromCart` SUCCEEDS for the same line. The proof of
 *       symmetry — the rejection is event-driven (state-coupled to the
 *       LIVE `available` field), not a one-shot rule.
 *
 *   (c) Per-device tooltip flag — first call to
 *       `markItemToggleTooltipSeen` flips the flag, subsequent calls are
 *       no-op (idempotent). This is the backend half of the « tooltip 1er
 *       usage » UX contract pinned at the native pure-decision layer
 *       (`decide-item-availability.test.ts` — gate maps absent/undefined →
 *       show-tooltip, true → proceed).
 *
 * Same module-glob convention as the other lib/* e2e files. The file lives
 * in convex/lib/cart/, so vitest keys same-dir matches as "./x"; normalise
 * to be relative to the convex root.
 */

// Same module-glob convention as cart.test.ts next door — vitest emits keys
// relative to this dir, re-anchor every key at the convex root so
// convex-test's findModulesRoot has ONE common prefix: `./x` →
// `../../lib/cart/x`, `../x` (siblings in lib/) → `../../lib/x`.
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

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/**
 * Seed an ALL-DAY service window on tenant A so `acceptsOrderNow` lets the
 * checkout through (the cart gate refuses outside service hours, which would
 * mask the availability rejection — we want THE availability path to be the
 * only failure mode here).
 */
async function seedTenantOpenAllDay(
  t: ReturnType<typeof convexTest>,
  seed: Seed,
): Promise<void> {
  const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
  await asMgr.mutation(api.lib.menu.serviceHours.set, {
    tenantId: seed.tenantA.tenantId,
    windows: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
      dayOfWeek,
      startMinute: 0,
      endMinute: 1439,
    })),
  });
}

/** Create a category + item, return the item id. The item is born AVAILABLE. */
async function seedOneItem(
  t: ReturnType<typeof convexTest>,
  seed: Seed,
): Promise<Id<"menuItems">> {
  const asMgr = t.withIdentity({ subject: seed.tenantA.managerId });
  const cat = await asMgr.mutation(api.lib.menu.categories.create, {
    tenantId: seed.tenantA.tenantId,
    name: "Smashs",
  });
  return (await asMgr.mutation(api.lib.menu.items.create, {
    tenantId: seed.tenantA.tenantId,
    categoryId: cat,
    name: "Smash Double",
    description: "Double smash, sauce maison",
    basePrice: 1290,
    allergens: [],
  })) as Id<"menuItems">;
}

describe("#408 E2E — Khan toggles item indispo → PWA client checkout rejected (PRD 20 §7c)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let itemId: Id<"menuItems">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await seedTenantOpenAllDay(t, seed);
    itemId = await seedOneItem(t, seed);
  });

  it("(a) Khan flips item available=false → customer's createOrderFromCart REJECTS the line with 'out of stock'", async () => {
    // 1. SANITY: the customer can place an order WHILE the item is available.
    //    This isolates the post-toggle rejection as a state-coupled effect.
    const asCustomer = t.withIdentity({ subject: seed.customerId });
    const orderIdBefore = await asCustomer.mutation(
      api.lib.cart.cart.createOrderFromCart,
      {
        tenantId: seed.tenantA.tenantId,
        mode: "delivery",
        address: "1 rue de la Paix, Paris",
        items: [
          {
            itemId,
            quantity: 1,
            modifierSelections: [],
          },
        ],
      },
    );
    // Sanity: an order was created (proves the open-all-day + customer fiche
    // + cart freeze path all work in this fixture).
    expect(orderIdBefore).toBeDefined();

    // 2. EVENT: Khan (kb_manager of tenant A) flips the item indispo via the
    //    SHARED backend mutation the KB Orders native app calls.
    const asKhan = t.withIdentity({ subject: seed.tenantA.managerId });
    await asKhan.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });

    // 3. CHECKOUT: the SAME customer submits the SAME cart payload — the
    //    backend gate must now reject. Error code is `INVALID_CART`, message
    //    is the EXACT wording of `freezeCartItem` (cart.ts §145-147).
    await expect(
      asCustomer.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "delivery",
        address: "1 rue de la Paix, Paris",
        items: [{ itemId, quantity: 1, modifierSelections: [] }],
      }),
    ).rejects.toThrow(/out of stock/i);
  });

  it("(b) toggle BACK to available → next createOrderFromCart succeeds for the same line (event-driven symmetry)", async () => {
    const asKhan = t.withIdentity({ subject: seed.tenantA.managerId });
    const asCustomer = t.withIdentity({ subject: seed.customerId });

    // Off → checkout fails.
    await asKhan.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: false,
    });
    await expect(
      asCustomer.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "delivery",
        address: "1 rue de la Paix, Paris",
        items: [{ itemId, quantity: 1, modifierSelections: [] }],
      }),
    ).rejects.toThrow(/out of stock/i);

    // Back ON → checkout succeeds without ANY republication of the snapshot.
    await asKhan.mutation(api.lib.menu.availability.setItemAvailability, {
      tenantId: seed.tenantA.tenantId,
      itemId,
      available: true,
    });
    const orderId = await asCustomer.mutation(
      api.lib.cart.cart.createOrderFromCart,
      {
        tenantId: seed.tenantA.tenantId,
        mode: "delivery",
        address: "1 rue de la Paix, Paris",
        items: [{ itemId, quantity: 1, modifierSelections: [] }],
      },
    );
    expect(orderId).toBeDefined();
  });
});

describe("#408 E2E — per-device tooltip flag (PRD 20 §7c « 1er usage / plus au 2e »)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
  });

  it("(c) first call flips the flag, the SECOND call leaves it true → native decideTooltipGate switches 'show-tooltip' → 'proceed'", async () => {
    const asKhan = t.withIdentity({ subject: seed.tenantA.managerId });

    // Premier usage: pas de flag.
    const before = await asKhan.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "tab-khan",
    });
    expect(before?.itemToggleTooltipSeen).toBeUndefined();

    // Khan dismisse le tooltip dans la native sheet (« OK, j'ai compris »).
    await asKhan.mutation(api.lib.devices.devices.markItemToggleTooltipSeen, {
      deviceId: "tab-khan",
    });

    // Le flag est désormais à true — le pure `decideTooltipGate` côté native
    // verra ce row au prochain render et renverra `proceed` (truth table
    // pinned in apps/native/src/lib/item-availability/decide-item-availability.test.ts).
    const afterFirst = await asKhan.query(api.lib.devices.devices.getMyDevice, {
      deviceId: "tab-khan",
    });
    expect(afterFirst?.itemToggleTooltipSeen).toBe(true);

    // 2e usage: même Khan re-tape un toggle plus tard. La native re-call la
    // mutation pour idempotence (la sheet n'apparaît plus en réalité car la
    // décision pure renvoie `proceed`, mais ici on simule le worst-case).
    // Le flag reste true — pas de régression « tooltip revient ».
    await asKhan.mutation(api.lib.devices.devices.markItemToggleTooltipSeen, {
      deviceId: "tab-khan",
    });
    const afterSecond = await asKhan.query(
      api.lib.devices.devices.getMyDevice,
      { deviceId: "tab-khan" },
    );
    expect(afterSecond?.itemToggleTooltipSeen).toBe(true);
  });
});
