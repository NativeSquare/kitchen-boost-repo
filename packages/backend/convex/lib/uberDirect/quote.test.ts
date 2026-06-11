import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../_generated/api";
import schema from "../../schema";
import {
  type FuzzActor,
  runCrossTenantFuzz,
  seedTwoTenantsAllRoles,
} from "../tenancy/fuzz";
import { interpretQuoteResponse } from "./quote";

// convex-test needs the function modules; array-negation glob form is required —
// extglob `!(*.test)` returns ZERO modules (project memory). This file lives in
// convex/lib/uberDirect/, so normalise every key to be relative to the convex
// root (../../) so convex-test's findModulesRoot has ONE common prefix (same
// shape as credentials.test.ts / deliveries.test.ts).
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
 * 2.6-B — `lib/uberDirect.requestQuote(tenantId, address)`, written BEFORE the
 * implementation (TDD red). The address-first [[Quote]] (delivery CONTEXT,
 * PRD 40 §2): on PWA entry the backend calls Uber Direct
 * `POST /customers/{customer_id}/delivery_quotes` and returns fee + ETA, or a
 * refusal reason. Only THIS module talks to the Uber API; the per-tenant Uber
 * credentials are decrypted ONLY inside this action (reusing the 2.6-A
 * action-only decrypt). All Uber HTTP is MOCKED — no real network.
 *
 * The OAuth2 client-credentials token exchange + the quote endpoint shapes are
 * the documented Uber Direct ones (research/uber_direct_deep_dive §1.1 / §1.2),
 * not invented:
 *  - `POST https://auth.uber.com/oauth/v2/token` (grant_type=client_credentials)
 *  - `POST https://api.uber.com/v1/customers/{customer_id}/delivery_quotes`
 */

type Seed = Awaited<ReturnType<typeof seedTwoTenantsAllRoles>>;

const CREDS = {
  clientId: "kb-client-id",
  clientSecret: "sk_live_uber_secret_777",
  customerId: "cus_uber_A",
  webhookSigningKey: "whsec_uber",
};

const ADDRESS = "12 rue de Paris, 91000 Évry";

/** A token response then a quote response, in call order. */
function mockUberSequence(quote: {
  status: number;
  body: Record<string, unknown>;
}): ReturnType<typeof vi.spyOn> {
  const spy = vi.spyOn(global, "fetch");
  // 1st call = OAuth token, 2nd call = delivery_quotes.
  spy.mockResolvedValueOnce(
    new Response(
      JSON.stringify({ access_token: "ub_token_abc", expires_in: 2592000 }),
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

describe("2.6-B interpretQuoteResponse — pure mapping of the Uber quote HTTP result", () => {
  it("a successful quote yields { ok, quoteId, fee, eta }", () => {
    const r = interpretQuoteResponse(200, {
      id: "dqt_123",
      fee: 590,
      duration: 18,
    });
    expect(r).toEqual({ ok: true, quoteId: "dqt_123", fee: 590, eta: 18 });
  });

  it("an out-of-zone refusal (Uber address_undeliverable) yields hors_zone", () => {
    const r = interpretQuoteResponse(422, {
      code: "address_undeliverable",
      message: "We are unable to deliver to this address.",
    });
    expect(r).toEqual({ ok: false, reason: "hors_zone" });
  });

  it("a surge / temporarily-unavailable refusal yields surge", () => {
    const r = interpretQuoteResponse(409, {
      code: "request_unavailable",
      message: "Temporarily unavailable.",
    });
    expect(r).toEqual({ ok: false, reason: "surge" });
  });

  it("any other non-OK status is mapped to hors_zone (not deliverable)", () => {
    const r = interpretQuoteResponse(400, { code: "invalid_params" });
    expect(r).toEqual({ ok: false, reason: "hors_zone" });
  });
});

describe("2.6-B requestQuote — action: decrypt creds, OAuth, call Uber, map result", () => {
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Pickup address required by Uber Direct on the quote endpoint.
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, {
        address: "1 Rue de Rivoli, 75001 Paris",
      });
    });
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

  it("returns fee + eta on a deliverable address, hitting auth then quote", async () => {
    fetchSpy = mockUberSequence({
      status: 200,
      body: { id: "dqt_OK", fee: 590, duration: 22 },
    });

    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .action(api.lib.uberDirect.quote.requestQuote, {
        tenantId: seed.tenantA.tenantId,
        address: ADDRESS,
      });

    expect(res).toEqual({ ok: true, quoteId: "dqt_OK", fee: 590, eta: 22 });
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    // 1st call = OAuth token at auth.uber.com with client_credentials grant.
    const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(tokenUrl).toContain("auth.uber.com/oauth/v2/token");
    expect(String(tokenInit.body)).toContain("grant_type=client_credentials");

    // 2nd call = the quote endpoint, scoped to the tenant's Uber customer_id,
    // Bearer the token we just fetched. The secret is NEVER on the quote URL.
    const [quoteUrl, quoteInit] = fetchSpy.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(quoteUrl).toContain("/customers/cus_uber_A/delivery_quotes");
    const headers = new Headers(quoteInit.headers);
    expect(headers.get("Authorization")).toBe("Bearer ub_token_abc");
    expect(quoteUrl).not.toContain("sk_live_uber_secret_777");
  });

  it("returns hors_zone (deliverable false) when Uber refuses the address", async () => {
    fetchSpy = mockUberSequence({
      status: 422,
      body: { code: "address_undeliverable" },
    });
    const res = await t
      .withIdentity({ subject: seed.tenantA.managerId })
      .action(api.lib.uberDirect.quote.requestQuote, {
        tenantId: seed.tenantA.tenantId,
        address: "999 nowhere",
      });
    expect(res).toEqual({ ok: false, reason: "hors_zone" });
  });

  it("throws when the tenant has no Uber credentials stored", async () => {
    fetchSpy = mockUberSequence({ status: 200, body: { id: "x", fee: 1 } });
    await expect(
      t
        .withIdentity({ subject: seed.tenantB.managerId })
        .action(api.lib.uberDirect.quote.requestQuote, {
          tenantId: seed.tenantB.tenantId,
          address: ADDRESS,
        }),
    ).rejects.toThrow();
  });
});

describe("2.6-B cross-tenant fuzz — the requestQuote access gate (ADR 0010)", () => {
  // The action dispatches its access gate to the kb_manager-scoped credential
  // blob query (2.6-A) before any Uber call — that exported query is the surface
  // the fuzz harness replays (the harness drives queries/mutations, not actions).
  let t: ReturnType<typeof convexTest>;
  let seed: Seed;
  beforeEach(async () => {
    t = convexTest(schema, modules);
    seed = await seedTwoTenantsAllRoles(t);
    // Pickup address is REQUIRED by Uber Direct on the quote endpoint — seed
    // it server-side so `requestQuote` doesn't throw TENANT_PICKUP_MISSING.
    await t.run(async (ctx) => {
      await ctx.db.patch(seed.tenantA.tenantId, {
        address: "1 Rue de Rivoli, 75001 Paris",
      });
    });
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

  it("requestQuote itself is PUBLIC since PWA-S3 — decrypts via the internalAction variant, no kb_manager gate", async () => {
    // CONTRACT CHANGE 2026-06-11: the public-facing `requestDeliveryQuote`
    // (called from the PWA Client's anonymous address-first chain) cascades
    // here. Wrapping it behind a kb_manager gate would break the chain at the
    // first selection. The credential read it dispatches now goes through the
    // SYSTEM (internalAction) variant of `getDecryptedUberCredentials`, which
    // server-to-server bypasses the gate without ever leaking the credentials
    // back to the caller. The kb_manager gate is preserved on the PUBLIC
    // `getUberCredentialBlob` query (asserted in the previous test) so
    // direct probing of the credential blob from the client remains forbidden.
    const fetchSpy = mockUberSequence({
      status: 200,
      body: { id: "qt_x", fee: 350, duration: 22 },
    });
    const verdict = await t
      .withIdentity({ subject: seed.tenantB.managerId })
      .action(api.lib.uberDirect.quote.requestQuote, {
        tenantId: seed.tenantA.tenantId,
        address: ADDRESS,
      });
    expect(verdict.ok).toBe(true);
    fetchSpy.mockRestore();
  });
});
