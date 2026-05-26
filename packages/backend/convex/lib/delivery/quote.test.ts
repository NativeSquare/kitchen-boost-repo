import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../_generated/api";
import type { Id } from "../../_generated/dataModel";
import type { ServiceWindow } from "../../table/serviceHours";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";
import { crossQuoteWithServiceHours } from "./quote";

// convex-test needs the function modules; array-negation glob form is required
// (extglob `!(*.test)` returns ZERO modules — project memory). This file lives in
// convex/lib/delivery/, so Vite emits keys relative to THIS dir (`./quote.ts`,
// `../uberDirect/...`, `../menu/...`, `../../table/...`). Re-anchor EVERY key at
// the convex root so convex-test's findModulesRoot has ONE common prefix (same
// shape as the cart suite, which also crosses lib dirs): `./x` →
// `../../lib/delivery/x`, `../x` → `../../lib/x`.
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => {
    let key = path;
    if (key.startsWith("./")) key = `../../lib/delivery/${key.slice(2)}`;
    else if (key.startsWith("../") && !key.startsWith("../../"))
      key = `../../lib/${key.slice(3)}`;
    return [key, loader];
  }),
);

/**
 * 2.6-B — `lib/delivery/quote`, written BEFORE the implementation (TDD red). The
 * orchestration that crosses the Uber [[Quote]] with the [[Plage horaire de
 * service]] (KB source of truth, READ from 2.2 — never configured here, the 2.2
 * frontier) and returns the front's livrabilité verdict
 * `{ deliverable, fee, eta, reason? }`, `reason ∈ { hors_zone, hors_horaire,
 * surge }` (delivery CONTEXT "Address-first flow", PRD 40 §2):
 *  - hors plage horaire ⇒ `hors_horaire` (checkout bloqué, pas de pré-commande
 *    V1) — and Uber is NOT called when closed;
 *  - hors zone ⇒ `hors_zone`; surge bloquant ⇒ `surge`; both lock delivery mode
 *    (only click & collect remains);
 *  - quote OK ⇒ `deliverable: true` + fee + eta.
 * A re-capture at payment (latching, anti-surge) returns a FRESH quote for 2.5.
 * All Uber HTTP is MOCKED.
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const CREDS = {
  clientId: "kb-client-id",
  clientSecret: "sk_live_uber_secret_555",
  customerId: "cus_uber_A",
};

const ADDRESS = "12 rue de Paris, 91000 Évry";

// An all-week 00:00–23:59 schedule so isOpenNow is true regardless of run clock.
const ALWAYS_OPEN: ServiceWindow[] = Array.from({ length: 7 }, (_, d) => ({
  dayOfWeek: d,
  startMinute: 0,
  endMinute: 1440,
}));

async function setHours(
  t: ReturnType<typeof convexTest>,
  managerId: Id<"users">,
  tenantId: Id<"tenants">,
  windows: ServiceWindow[],
): Promise<void> {
  await t
    .withIdentity({ subject: managerId })
    .mutation(api.lib.menu.serviceHours.set, { tenantId, windows });
}

async function setCreds(
  t: ReturnType<typeof convexTest>,
  managerId: Id<"users">,
  tenantId: Id<"tenants">,
): Promise<void> {
  await t
    .withIdentity({ subject: managerId })
    .mutation(api.lib.uberDirect.credentials.setUberCredentials, {
      tenantId,
      credentials: CREDS,
    });
}

function mockUberSequence(quote: {
  status: number;
  body: Record<string, unknown>;
}): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(global, "fetch");
  spy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ access_token: "ub_token_xyz", expires_in: 2592000 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    ),
  );
  spy.mockResolvedValueOnce(
    new Response(JSON.stringify(quote.body), {
      status: quote.status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  return spy as ReturnType<typeof vi.spyOn>;
}

describe("2.6-B crossQuoteWithServiceHours — pure verdict (Uber quote × open window)", () => {
  it("open + deliverable quote ⇒ deliverable with fee + eta", () => {
    const v = crossQuoteWithServiceHours({
      isOpen: true,
      quote: { ok: true, quoteId: "dqt_1", fee: 590, eta: 20 },
    });
    expect(v).toEqual({
      deliverable: true,
      fee: 590,
      eta: 20,
      quoteId: "dqt_1",
    });
  });

  it("closed ⇒ hors_horaire, regardless of the (un-fetched) quote", () => {
    const v = crossQuoteWithServiceHours({ isOpen: false, quote: null });
    expect(v).toEqual({ deliverable: false, reason: "hors_horaire" });
  });

  it("open but Uber refuses the zone ⇒ hors_zone", () => {
    const v = crossQuoteWithServiceHours({
      isOpen: true,
      quote: { ok: false, reason: "hors_zone" },
    });
    expect(v).toEqual({ deliverable: false, reason: "hors_zone" });
  });

  it("open but surge ⇒ surge", () => {
    const v = crossQuoteWithServiceHours({
      isOpen: true,
      quote: { ok: false, reason: "surge" },
    });
    expect(v).toEqual({ deliverable: false, reason: "surge" });
  });
});

describe("2.6-B requestDeliveryQuote — orchestration action", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await setCreds(t, seed.tenantA.managerId, seed.tenantA.tenantId);
    await setHours(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      ALWAYS_OPEN,
    );
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
    vi.useRealTimers();
  });

  it("in-window + deliverable ⇒ deliverable with fee + eta (one Uber quote call)", async () => {
    fetchSpy = mockUberSequence({
      status: 200,
      body: { id: "dqt_OK", fee: 590, duration: 18 },
    });
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .action(api.lib.delivery.quote.requestDeliveryQuote, {
        tenantId: seed.tenantA.tenantId,
        address: ADDRESS,
      });
    expect(res).toEqual({
      deliverable: true,
      fee: 590,
      eta: 18,
      quoteId: "dqt_OK",
    });
  });

  it("out of service hours ⇒ hors_horaire and Uber is NEVER called", async () => {
    // Empty schedule ⇒ always closed (a non-configured resto never opens).
    await setHours(t, seed.tenantA.managerId, seed.tenantA.tenantId, []);
    fetchSpy = vi.spyOn(global, "fetch");
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .action(api.lib.delivery.quote.requestDeliveryQuote, {
        tenantId: seed.tenantA.tenantId,
        address: ADDRESS,
      });
    expect(res).toEqual({ deliverable: false, reason: "hors_horaire" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("in-window but out of zone ⇒ hors_zone (delivery locked)", async () => {
    fetchSpy = mockUberSequence({
      status: 422,
      body: { code: "address_undeliverable" },
    });
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .action(api.lib.delivery.quote.requestDeliveryQuote, {
        tenantId: seed.tenantA.tenantId,
        address: "999 nowhere",
      });
    expect(res).toEqual({ deliverable: false, reason: "hors_zone" });
  });

  it("in-window but surge ⇒ surge", async () => {
    fetchSpy = mockUberSequence({
      status: 409,
      body: { code: "request_unavailable" },
    });
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .action(api.lib.delivery.quote.requestDeliveryQuote, {
        tenantId: seed.tenantA.tenantId,
        address: ADDRESS,
      });
    expect(res).toEqual({ deliverable: false, reason: "surge" });
  });
});

describe("2.6-B recaptureQuoteAtPayment — latching (anti-surge) re-quote for 2.5", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await setCreds(t, seed.tenantA.managerId, seed.tenantA.tenantId);
    await setHours(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      ALWAYS_OPEN,
    );
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    fetchSpy = undefined;
  });

  it("returns a FRESH quote at payment (a new Uber quote call, not a cached panier quote)", async () => {
    fetchSpy = mockUberSequence({
      status: 200,
      body: { id: "dqt_FRESH", fee: 640, duration: 25 },
    });
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .action(api.lib.delivery.quote.recaptureQuoteAtPayment, {
        tenantId: seed.tenantA.tenantId,
        address: ADDRESS,
      });
    expect(res).toEqual({
      deliverable: true,
      fee: 640,
      eta: 25,
      quoteId: "dqt_FRESH",
    });
    // A fresh quote was actually fetched (auth + quote), not served from a cache.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("surfaces a surge that appeared at payment time (latching blocks the stale fee)", async () => {
    fetchSpy = mockUberSequence({
      status: 409,
      body: { code: "request_unavailable" },
    });
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .action(api.lib.delivery.quote.recaptureQuoteAtPayment, {
        tenantId: seed.tenantA.tenantId,
        address: ADDRESS,
      });
    expect(res).toEqual({ deliverable: false, reason: "surge" });
  });
});

describe("2.6-B cross-tenant fuzz — the delivery-quote access gates (ADR 0010)", () => {
  // The orchestration actions dispatch their tenant access to two tenant-scoped
  // queries before any Uber call: the kb_manager credential blob (2.6-A) and the
  // service-hours read. The fuzz harness replays those queries (it drives
  // queries/mutations, not actions).
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    await setCreds(t, seed.tenantA.managerId, seed.tenantA.tenantId);
    await setHours(
      t,
      seed.tenantA.managerId,
      seed.tenantA.tenantId,
      ALWAYS_OPEN,
    );
  });

  it("the service-hours gate query rejects every unauthorized actor on tenant A", async () => {
    const { leaks, pairs } = await runCrossTenantFuzz(t, {
      functions: [api.lib.delivery.quote.readServiceOpen],
      isQuery: () => true,
      tenantId: seed.tenantA.tenantId,
      actors: [
        { label: "B-manager", subject: seed.tenantB.managerId },
        { label: "B-staff", subject: seed.tenantB.staffId },
        { label: "detached", subject: seed.detachedUserId },
        { label: "customer", subject: seed.customerId },
        { label: "anonymous", subject: null },
      ] satisfies FuzzActor[],
    });
    expect(pairs).toBe(5);
    expect(leaks).toEqual([]);
  });

  it("requestDeliveryQuote throws for a foreign manager (cross-tenant), before Uber", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .action(api.lib.delivery.quote.requestDeliveryQuote, {
          tenantId: seed.tenantA.tenantId,
          address: ADDRESS,
        }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
