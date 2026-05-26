import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import schema from "../../schema";
import { runCrossTenantFuzz, seedTwoTenantsAllRoles } from "../tenancy/fuzz";
import {
  type DeadPushChannel,
  pushStatusPatchForDeadChannel,
} from "./reachabilityFeedback";

/**
 * 2.7-E — MAJ joignabilité : retour du statut (web-push 410 / opt-out) vers 2.1,
 * écrite AVANT le module (TDD red). 2.7 ne POSSÈDE pas la joignabilité (ADR 0012) ;
 * il découvre seulement quand un canal meurt (410 Gone sur un envoi web-push) ou
 * qu'un client se désinscrit, et il REPORTE ce statut côté 2.1 (#16), la source de
 * vérité — 2.7 ne garde aucune copie locale.
 *
 * Cette slice ferme la boucle :
 *  - PURE : `pushStatusPatchForDeadChannel` — un canal mort (web_push / wallet_push)
 *    → le patch d'enrôlement 2.1 qui le passe `revoked` (le marqueur « inactive
 *    endpoint » côté 2.1). Aucun stockage local — on calcule juste le patch 2.1.
 *  - `recordChannelInactive` — `tenantMutation` opérationnel : le dispatch (slice C)
 *    reçoit un 410 → on écrit `revoked` côté 2.1 via la SEAM publique 2.1
 *    (`patchCustomerPushEnrollment`, référence customer par id), JAMAIS en écrivant
 *    les tables 2.1 directement, et on marque la ligne `notificationEvents`
 *    d'origine `inactive_endpoint`. La cascade (engine / pickMarketingChannel)
 *    bascule alors automatiquement sur le canal suivant puisqu'elle relit la
 *    joignabilité côté 2.1 (désormais `revoked`).
 *  - Opt-out (`unsubscribe`, slice D) propage déjà le statut de joignabilité
 *    marketing vers 2.1 (`marketingOptOutDate`) — vérifié ici de bout en bout.
 *
 * Isolation (ADR 0010) : `tenantMutation` keyée sur `ctx.tenantId` ; une ligne
 * `notificationEvents` d'un autre tenant est NOT_FOUND (pas d'oracle cross-tenant) ;
 * fuzz cross-tenant rejouant la fonction sous des acteurs non autorisés. MOAT : le
 * customer est référencé PAR ID uniquement, aucune coordonnée nominative.
 */

const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (path.startsWith("./")) {
      key = `../../lib/notifications/${path.slice(2)}`;
    } else if (path.startsWith("../") && !path.startsWith("../../")) {
      key = `../../lib/${path.slice(3)}`;
    }
    return [key, loader];
  }),
);

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

/** A customer enrolled on BOTH wallet + web-push (the cascade has somewhere to fall). */
async function seedPushCustomer(
  t: ReturnType<typeof convexTest>,
  email: string,
): Promise<{ customerId: Id<"customers">; userId: Id<"users"> }> {
  return t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", { email, role: "customer" });
    const customerId = await ctx.db.insert("customers", {
      userId,
      email,
      phone: "+33600000000",
      pushEnrollment: {
        webPushSubscriptionId: "sub-web-1",
        walletSerialNumber: "wallet-1",
        webPushStatus: "enrolled",
        walletStatus: "enrolled",
      },
      createdAt: Date.now(),
    });
    return { customerId, userId };
  });
}

/** Journal a transactional send row for a tenant's customer; returns its id. */
async function seedEvent(
  t: ReturnType<typeof convexTest>,
  tenantId: Id<"tenants">,
  customerId: Id<"customers">,
  channel: "web_push" | "wallet_push",
): Promise<Id<"notificationEvents">> {
  return t.run((ctx) =>
    ctx.db.insert("notificationEvents", {
      tenantId,
      customerId,
      kind: "transactional",
      transactionalTrigger: "order_paid",
      transactionalCategory: "archive",
      channel,
      status: "sent",
      createdAt: Date.now(),
      sentAt: Date.now(),
    }),
  );
}

async function readPushEnrollment(
  t: ReturnType<typeof convexTest>,
  customerId: Id<"customers">,
) {
  return t.run(async (ctx) => {
    const fiche = await ctx.db.get(customerId);
    return fiche?.pushEnrollment;
  });
}

describe("2.7-E pushStatusPatchForDeadChannel — pure dead-channel → 2.1 patch", () => {
  it("maps web_push to a webPushStatus:revoked patch (and nothing else)", () => {
    expect(pushStatusPatchForDeadChannel("web_push")).toEqual({
      webPushStatus: "revoked",
    });
  });

  it("maps wallet_push to a walletStatus:revoked patch (and nothing else)", () => {
    expect(pushStatusPatchForDeadChannel("wallet_push")).toEqual({
      walletStatus: "revoked",
    });
  });

  it("never clobbers another channel (single-channel patch)", () => {
    const channels: DeadPushChannel[] = ["web_push", "wallet_push"];
    for (const c of channels) {
      const patch = pushStatusPatchForDeadChannel(c);
      expect(Object.keys(patch)).toHaveLength(1);
    }
  });
});

describe("2.7-E recordChannelInactive — write status to 2.1, mark journal, cascade bascule", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let customerId: Id<"customers">;
  let eventId: Id<"notificationEvents">;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    ({ customerId } = await seedPushCustomer(t, "eater-a@x.fr"));
    eventId = await seedEvent(t, seed.tenantA.tenantId, customerId, "web_push");
  });

  it("on 410 Gone marks the web-push endpoint revoked side 2.1 (source de vérité)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(
      api.lib.notifications.reachabilityFeedback.recordChannelInactive,
      {
        tenantId: seed.tenantA.tenantId,
        customerId,
        channel: "web_push",
        eventId,
      },
    );

    const enrollment = await readPushEnrollment(t, customerId);
    // web-push now revoked side 2.1...
    expect(enrollment?.webPushStatus).toBe("revoked");
    // ...the OTHER channels untouched (no clobber, single-channel update, US #16)...
    expect(enrollment?.walletStatus).toBe("enrolled");
    expect(enrollment?.walletSerialNumber).toBe("wallet-1");
    // ...and the originating endpoint id is preserved (kept for audit / debug).
    expect(enrollment?.webPushSubscriptionId).toBe("sub-web-1");
  });

  it("marks the originating notificationEvents row inactive_endpoint", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(
      api.lib.notifications.reachabilityFeedback.recordChannelInactive,
      {
        tenantId: seed.tenantA.tenantId,
        customerId,
        channel: "web_push",
        eventId,
      },
    );
    const row = await t.run((ctx) => ctx.db.get(eventId));
    expect(row?.status).toBe("inactive_endpoint");
  });

  it("keeps no local copy in 2.7 — only 2.1's fiche carries reachability", async () => {
    // 2.7 owns no pushSubscriptions table; the only reachability mutation it makes
    // is the patch on the GLOBAL 2.1 fiche. After the 410, querying 2.7's own
    // tables yields nothing reachability-like — the status lives ONLY in 2.1.
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(
      api.lib.notifications.reachabilityFeedback.recordChannelInactive,
      {
        tenantId: seed.tenantA.tenantId,
        customerId,
        channel: "web_push",
        eventId,
      },
    );
    // The journal row carries a SEND status, not a per-channel reachability flag.
    const row = await t.run((ctx) => ctx.db.get(eventId));
    expect(row).not.toHaveProperty("webPushStatus");
    expect(row).not.toHaveProperty("reachable");
  });

  it("makes the transactional cascade bascule onto the next channel after the 410", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    // Place a real order for this customer so we can re-run the engine via the
    // public semantic event API and observe the cascade re-derivation from 2.1.
    const orderId = await asManager.mutation(api.lib.orders.orders.placeOrder, {
      tenantId: seed.tenantA.tenantId,
      customerId,
      mode: "delivery",
      items: [
        {
          itemName: "Smash",
          unitPrice: 1290,
          quantity: 1,
          modifiers: [],
          allergens: [],
        },
      ],
    });

    // Before the 410 an Archive trigger routes to wallet_push + web_push + email.
    const before = await asManager.mutation(
      api.lib.notifications.notify.notifyOrderEvent,
      { tenantId: seed.tenantA.tenantId, orderId, eventType: "order_paid" },
    );
    expect(before.map((p: { channel: string }) => p.channel)).toContain(
      "web_push",
    );

    // 410 on web-push → 2.1 marks it revoked.
    await asManager.mutation(
      api.lib.notifications.reachabilityFeedback.recordChannelInactive,
      {
        tenantId: seed.tenantA.tenantId,
        customerId,
        channel: "web_push",
        eventId,
      },
    );

    // Re-run the engine: web_push has fallen out of the cascade (read from 2.1),
    // wallet_push + email remain — the bascule is automatic, no local 2.7 state.
    const after = await asManager.mutation(
      api.lib.notifications.notify.notifyOrderEvent,
      { tenantId: seed.tenantA.tenantId, orderId, eventType: "order_paid" },
    );
    const channels = after.map((p: { channel: string }) => p.channel);
    expect(channels).not.toContain("web_push");
    expect(channels).toContain("wallet_push");
    expect(channels).toContain("email");
  });

  it("a foreign tenant's notificationEvents row is NOT_FOUND (no cross-tenant write)", async () => {
    const asManagerB = t.withIdentity({ subject: seed.tenantB.managerId });
    // eventId belongs to tenant A; manager B may not touch it.
    await expect(
      asManagerB.mutation(
        api.lib.notifications.reachabilityFeedback.recordChannelInactive,
        {
          tenantId: seed.tenantB.tenantId,
          customerId,
          channel: "web_push",
          eventId,
        },
      ),
    ).rejects.toThrow(/NOT_FOUND/);
  });

  it("works without an eventId (a 410 not tied to a journaled send still updates 2.1)", async () => {
    const asManager = t.withIdentity({ subject: seed.tenantA.managerId });
    await asManager.mutation(
      api.lib.notifications.reachabilityFeedback.recordChannelInactive,
      { tenantId: seed.tenantA.tenantId, customerId, channel: "wallet_push" },
    );
    const enrollment = await readPushEnrollment(t, customerId);
    expect(enrollment?.walletStatus).toBe("revoked");
    expect(enrollment?.webPushStatus).toBe("enrolled");
  });
});

describe("2.7-E opt-out → reachability status propagated to 2.1 (source de vérité)", () => {
  it("unsubscribe stamps marketingOptOutDate on the GLOBAL 2.1 fiche", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const { customerId, userId } = await seedPushCustomer(t, "eater-a@x.fr");

    const asCustomer = t.withIdentity({ subject: userId });
    await asCustomer.mutation(api.lib.notifications.unsubscribe.unsubscribe, {
      tenantId: seed.tenantA.tenantId,
    });

    const fiche = await t.run((ctx) => ctx.db.get(customerId));
    // The reachability/eligibility status now lives on the 2.1 fiche (#16), not in 2.7.
    expect(typeof fiche?.marketingOptOutDate).toBe("number");
  });
});

describe("2.7-E recordChannelInactive — cross-tenant fuzz (ADR 0010)", () => {
  it("throws for every unauthorized actor replaying the function", async () => {
    const t = convexTest(schema, modules);
    const seed = await seedTwoTenantsAllRoles(t);
    const { customerId } = await seedPushCustomer(t, "eater-a@x.fr");
    const eventId = await seedEvent(
      t,
      seed.tenantA.tenantId,
      customerId,
      "web_push",
    );

    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [
        api.lib.notifications.reachabilityFeedback.recordChannelInactive,
      ],
      isQuery: () => false,
      tenantId: seed.tenantA.tenantId,
      extraArgs: { customerId, channel: "web_push", eventId },
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "plain-customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ],
    });
    expect(leaks).toEqual([]);
    expect(pairs).toBe(5);
  });
});
