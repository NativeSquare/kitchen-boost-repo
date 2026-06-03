import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";
import { parisLocalParts } from "./serviceHours";

/**
 * #409 — E2E acceptance tests (PRD 20 §7d + issue body « 1-3 tests E2E »).
 *
 * Two end-to-end pin-downs of the « Modif horaires d'ouverture »
 * KB Orders → PWA client gating behaviour. The native screen
 * (`apps/native/src/lib/service-hours/`) wires the SAME
 * `api.lib.menu.serviceHours.set` mutation the KB Admin mirror uses
 * (#236 / #397), so this E2E exercises the cross-context contract end-to-end:
 * the KB Manager updates the windows via the native mutation seam, and
 * the public PWA-client read (`acceptsOrderNow`) AND the cart's
 * `createOrderFromCart` gate flip atomically with the new schedule.
 *
 *   (a) Modif horaire de fermeture du soir → checkout PWA bloqué dès
 *       le nouveau créneau (l'AC PRD 20 §7d explicite). On compose
 *       deux windows[] : la première INCLUT l'instant courant Paris,
 *       la seconde l'EXCLUT (gérant ferme « plus tôt »). Le checkout
 *       PWA passe puis échoue avec ce signal seul — pas une régression
 *       cross-feature.
 *
 *   (b) Horaire revient à la normale → le checkout PWA repasse (mirror
 *       de (a), prouve la symétrie event-driven : la décision n'est PAS
 *       one-shot, elle est state-coupled à `windows[]` lu par
 *       `isWithinServiceHours` à chaque appel `acceptsOrderNow` /
 *       `createOrderFromCart`).
 *
 * Source unique
 * -------------
 * Pas de nouvelle table, pas de nouvelle mutation. `serviceHours.set`
 * existe depuis 2.2-E, est cross-tenant fuzzé via
 * `seedTwoTenantsAllRoles`, et la pure `assertServiceWindows` rejette
 * déjà les windows invalides en backend (défense en profondeur — le
 * front native fait la validation pour l'UX mais ne peut pas être
 * contourné). Ce fichier ajoute UNIQUEMENT le pin-down du round-trip
 * native-side du contrat ; il ne re-teste pas l'isolation tenant
 * (`serviceHours.test.ts` couvre déjà ça en `2.2-E cross-tenant`).
 *
 * Module-glob convention identique aux autres `*-e2e.test.ts` de
 * `lib/*` : le fichier vit dans `convex/lib/menu/`, donc vite key les
 * matches same-dir comme `./x` ; on normalise au root du convex.
 */

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (key.startsWith("./")) key = `../../lib/menu/${key.slice(2)}`;
    else if (key.startsWith("../") && !key.startsWith("../../"))
      key = `../../lib/${key.slice(3)}`;
    return [key, loader];
  }),
);

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/**
 * Compose a `windows[]` for tenant A that OPENS the resto in a wide span
 * around the current real-time Paris wall-clock. Used as the « état
 * normal » baseline before the gérant edits.
 *
 * The window covers the FULL Paris day-of-week the test is running in
 * — from 00:00 to 24:00 — so the `isWithinServiceHours` gate always
 * lets a checkout through regardless of the CI runner clock.
 */
function widelyOpenWindowsForCurrentParisDay(): {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}[] {
  const { dayOfWeek } = parisLocalParts(Date.now());
  return [{ dayOfWeek, startMinute: 0, endMinute: 1440 }];
}

/**
 * Compose a `windows[]` that DOES NOT cover the current real-time Paris
 * wall-clock — used to simulate « Khan ferme à 22h au lieu de 23h »,
 * the exact scenario PRD 20 §7d §9 cites (« un seul cuisinier ce soir
 * → ferme tôt »). The window is a tiny 1-minute slice on a DIFFERENT
 * day (the next dayOfWeek), so the gate cannot match the current
 * wall-clock no matter what minute the CI runner is on.
 */
function windowsThatExcludeCurrentInstant(): {
  dayOfWeek: number;
  startMinute: number;
  endMinute: number;
}[] {
  const { dayOfWeek } = parisLocalParts(Date.now());
  const otherDay = (dayOfWeek + 1) % 7;
  return [{ dayOfWeek: otherDay, startMinute: 0, endMinute: 60 }];
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

describe("#409 E2E — Khan édite les horaires depuis KB Orders → PWA gate flips (PRD 20 §7d)", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let itemId: Id<"menuItems">;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    itemId = await seedOneItem(t, seed);
  });

  it("(a) horaire réduit qui n'inclut plus maintenant → acceptsOrderNow flips false et checkout PWA bloqué", async () => {
    const asKhan = t.withIdentity({ subject: seed.tenantA.managerId });
    const asCustomer = t.withIdentity({ subject: seed.customerId });

    // 1. État normal : la grille couvre maintenant largement → le
    //    checkout PWA passe.
    await asKhan.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: widelyOpenWindowsForCurrentParisDay(),
    });
    const openBefore = await t.query(api.lib.orders.status.acceptsOrderNow, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(openBefore).toBe(true);

    const orderIdBefore = await asCustomer.mutation(
      api.lib.cart.cart.createOrderFromCart,
      {
        tenantId: seed.tenantA.tenantId,
        mode: "delivery",
        address: "1 rue de la Paix, Paris",
        items: [{ itemId, quantity: 1, modifierSelections: [] }],
      },
    );
    expect(orderIdBefore).toBeDefined();

    // 2. ÉDITION : Khan ferme tôt depuis l'app native (« ce soir on ferme
    //    à 22h au lieu de 23h », PRD 20 §9 / §7d). La mutation est la
    //    MÊME que celle qu'utilise le KB Admin mirror — pas de mutation
    //    `setTenantHoursOverride` séparée.
    await asKhan.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: windowsThatExcludeCurrentInstant(),
    });

    // 3. PROOF : la PUBLIC read `acceptsOrderNow` flip à false immédiate
    //    (lue par le PWA client pour gate la CTA Checkout) ET le backend
    //    cart gate rejette une nouvelle tentative de commande avec
    //    `RESTO_CLOSED`. Aucun republish, aucun snapshot menu touché.
    const openAfter = await t.query(api.lib.orders.status.acceptsOrderNow, {
      tenantId: seed.tenantA.tenantId,
    });
    expect(openAfter).toBe(false);
    await expect(
      asCustomer.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "delivery",
        address: "1 rue de la Paix, Paris",
        items: [{ itemId, quantity: 1, modifierSelections: [] }],
      }),
    ).rejects.toThrow(/closed|fermé/i);
  });

  it("(b) Khan ré-élargit l'horaire → acceptsOrderNow repasse true (symétrie event-driven, mirror du retour à la normale à minuit)", async () => {
    const asKhan = t.withIdentity({ subject: seed.tenantA.managerId });
    const asCustomer = t.withIdentity({ subject: seed.customerId });

    // Fermé d'abord (l'horaire courant n'inclut pas maintenant).
    await asKhan.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: windowsThatExcludeCurrentInstant(),
    });
    expect(
      await t.query(api.lib.orders.status.acceptsOrderNow, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).toBe(false);
    await expect(
      asCustomer.mutation(api.lib.cart.cart.createOrderFromCart, {
        tenantId: seed.tenantA.tenantId,
        mode: "delivery",
        address: "1 rue de la Paix, Paris",
        items: [{ itemId, quantity: 1, modifierSelections: [] }],
      }),
    ).rejects.toThrow(/closed|fermé/i);

    // Khan rétablit l'horaire (mirror du « retour à la normale à minuit »
    // côté PRD AC). Le checkout PWA repasse SANS aucune republication du
    // catalogue : la gate est state-coupled à `windows[]`, pas à un
    // snapshot.
    await asKhan.mutation(api.lib.menu.serviceHours.set, {
      tenantId: seed.tenantA.tenantId,
      windows: widelyOpenWindowsForCurrentParisDay(),
    });
    expect(
      await t.query(api.lib.orders.status.acceptsOrderNow, {
        tenantId: seed.tenantA.tenantId,
      }),
    ).toBe(true);
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

  it("(c) `serviceHours.set` rejette une payload invalide depuis l'app native (défense en profondeur backend)", async () => {
    // Le front native a `validateServiceWindows` qui désactive le bouton
    // Enregistrer si la grille est invalide, mais la mutation backend
    // reste la SoT — un client malveillant ou un bug front ne peut PAS
    // poser un windows[] interdit. Pin-down du contrat: backend
    // `assertServiceWindows` (V1) couvre bounds + start<end ; les autres
    // règles (chevauchement intra-jour) restent du ressort du front pour
    // l'UX, mais une grille `start >= end` est rejetée même si la mutation
    // est appelée hors du chemin natif.
    const asKhan = t.withIdentity({ subject: seed.tenantA.managerId });
    await expect(
      asKhan.mutation(api.lib.menu.serviceHours.set, {
        tenantId: seed.tenantA.tenantId,
        windows: [{ dayOfWeek: 1, startMinute: 900, endMinute: 600 }],
      }),
    ).rejects.toThrow();

    await expect(
      asKhan.mutation(api.lib.menu.serviceHours.set, {
        tenantId: seed.tenantA.tenantId,
        windows: [{ dayOfWeek: 7, startMinute: 600, endMinute: 700 }],
      }),
    ).rejects.toThrow();
  });
});
