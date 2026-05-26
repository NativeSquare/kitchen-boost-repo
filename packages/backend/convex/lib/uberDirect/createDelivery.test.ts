import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";
import { interpretCreateDeliveryResponse } from "./createDelivery";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/uberDirect/, so normalise every key to be relative to the convex
// root (../../) so convex-test's findModulesRoot has ONE common prefix.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/uberDirect/${path.slice(2)}` : path,
    loader,
  ]),
);

/**
 * 2.6-C — `lib/uberDirect.createDelivery`, written BEFORE the implementation
 * (TDD red). The ONLY caller of Uber Direct `POST /deliveries` (delivery CONTEXT
 * "Course", PRD 40 §3, research §1.2/§1.4). It is an ACTION: per-tenant Uber
 * creds are decrypted ONLY in an action (reusing 2.6-A's action-only decrypt),
 * OAuth, then the create call carries the `quote_id`, pickup, dropoff, ONE
 * aggregated manifest item + `manifest_reference` = KB order id + an
 * `idempotency_key` (research §1.4/§1.7). All Uber HTTP is MOCKED — no network.
 *
 * Wire shapes are the documented Uber Direct ones, not invented.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const CREDS = {
  clientId: "kb-client-id",
  clientSecret: "sk_live_uber_secret_777",
  customerId: "cus_uber_A",
  webhookSigningKey: "whsec_uber",
};

/** A token response then a create-delivery response, in call order. */
function mockUberSequence(create: {
  status: number;
  body: Record<string, unknown>;
}): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(global, "fetch");
  spy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ access_token: "ub_token_abc", expires_in: 2592000 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  spy.mockResolvedValueOnce(
    new Response(JSON.stringify(create.body), {
      status: create.status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  return spy as ReturnType<typeof vi.spyOn>;
}

const ARGS = {
  quoteId: "dqt_OK",
  manifestReference: "order_a_1",
  pickupName: "Buns & Bao",
  pickupAddress: "1 rue du Resto, 75019 Paris",
  dropoffAddress: "12 rue de Paris, 91000 Évry",
};

describe("2.6-C interpretCreateDeliveryResponse — pure mapping of POST /deliveries", () => {
  it("a created course yields ok + uberDeliveryId + status + courier/ETAs", () => {
    const r = interpretCreateDeliveryResponse(200, {
      id: "del_uber_42",
      status: "pending",
      pickup_eta: 1_700_000_000_000,
      dropoff_eta: 1_700_000_500_000,
      courier: { name: "Sami", phone_number: "+33600000000" },
    });
    expect(r).toEqual({
      ok: true,
      uberDeliveryId: "del_uber_42",
      status: "pending",
      pickupEta: 1_700_000_000_000,
      dropoffEta: 1_700_000_500_000,
      courierName: "Sami",
      courierPhone: "+33600000000",
    });
  });

  it("a 2xx without an id is treated as a refusal (course refused post-payment, Cas A)", () => {
    const r = interpretCreateDeliveryResponse(200, { status: "pending" });
    expect(r).toEqual({ ok: false, reason: "refused_post_payment" });
  });

  it("a non-OK status (Uber refuses the course) yields refused_post_payment (Cas A)", () => {
    const r = interpretCreateDeliveryResponse(422, {
      code: "address_undeliverable",
    });
    expect(r).toEqual({ ok: false, reason: "refused_post_payment" });
  });

  it("defaults an unknown/absent status to pending on a created course", () => {
    const r = interpretCreateDeliveryResponse(200, { id: "del_x" });
    expect(r).toMatchObject({
      ok: true,
      uberDeliveryId: "del_x",
      status: "pending",
    });
  });
});

describe("2.6-C createDelivery — action: decrypt creds, OAuth, POST /deliveries", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  it("creates the Uber course, passing the quote_id + manifest_reference + idempotency_key", async () => {
    fetchSpy = mockUberSequence({
      status: 200,
      body: {
        id: "del_uber_42",
        status: "pending",
        courier: { name: "Sami", phone_number: "+33600000000" },
      },
    });

    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .action(api.lib.uberDirect.createDelivery.createDelivery, {
        tenantId: seed.tenantA.tenantId,
        ...ARGS,
      });

    expect(res).toMatchObject({
      ok: true,
      uberDeliveryId: "del_uber_42",
      status: "pending",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const [createUrl, createInit] = fetchSpy.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(createUrl).toContain("/customers/cus_uber_A/deliveries");
    const headers = new Headers(createInit.headers);
    expect(headers.get("Authorization")).toBe("Bearer ub_token_abc");
    // Idempotency on Create Delivery (research §1.7) — avoid double-dispatch.
    expect(headers.get("Idempotency-Key")).toBe("order_a_1");
    const body = JSON.parse(String(createInit.body)) as Record<string, unknown>;
    expect(body.quote_id).toBe("dqt_OK");
    expect(body.manifest_reference).toBe("order_a_1");
    // The secret is NEVER on the URL.
    expect(createUrl).not.toContain("sk_live_uber_secret_777");
  });

  it("returns refused_post_payment when Uber refuses the course (Cas A)", async () => {
    fetchSpy = mockUberSequence({
      status: 422,
      body: { code: "address_undeliverable" },
    });
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .action(api.lib.uberDirect.createDelivery.createDelivery, {
        tenantId: seed.tenantA.tenantId,
        ...ARGS,
      });
    expect(res).toEqual({ ok: false, reason: "refused_post_payment" });
  });

  it("a foreign manager cannot create a course for tenant A (cross-tenant, before Uber)", async () => {
    fetchSpy = vi.spyOn(global, "fetch");
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .action(api.lib.uberDirect.createDelivery.createDelivery, {
          tenantId: seed.tenantA.tenantId,
          ...ARGS,
        }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("2.6-C cross-tenant fuzz — createDelivery access gate (ADR 0010)", () => {
  // The action dispatches its access gate to the kb_manager-scoped credential
  // blob query (2.6-A) before any Uber call — that exported query is the surface
  // the fuzz harness replays (the harness drives queries/mutations, not actions).
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
        tenantId: seed.tenantA.tenantId,
        credentials: CREDS,
      });
  });

  it("the credential blob gate rejects every unauthorized actor on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.uberDirect.credentials.getUberCredentialBlob],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "A-staff", subject: seed.tenantA.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
    });
    expect(pairs).toBe(6);
    expect(leaks).toEqual([]);
  });
});
