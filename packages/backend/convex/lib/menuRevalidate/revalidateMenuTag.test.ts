import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { internal } from "../../_generated/api";
import schema from "../../schema";
import { seedTwoTenantsAllRoles } from "../tenancy/fuzz";

/**
 * PWA-S4 (#452) — `revalidateMenuTag` internalAction (decisions-log Q2).
 *
 * The action signs `{ tenantId }` with HMAC-SHA256 over `${ts}.${body}`
 * keyed on `MENU_REVALIDATE_HMAC_SECRET`, then POSTs to
 * `MENU_REVALIDATE_ROUTE_URL`. Failures are NON-FATAL — the action returns
 * `{ ok: false, reason }` so the scheduling `publishMenu` mutation never
 * rolls back on a stale ISR cache.
 *
 * We pin 4 invariants:
 *  - misconfigured env (no secret / no URL) ⇒ silent no-op.
 *  - happy path: POST with the expected `x-kb-signature` / `x-kb-timestamp`
 *    headers + the `{ "tenantId": "<id>" }` body.
 *  - non-2xx HTTP ⇒ `{ ok: false, reason: "HTTP_<code>" }`.
 *  - thrown fetch (network error) ⇒ `{ ok: false, reason: "FETCH_ERROR" }`.
 *
 * Sourced via convex-test so the action runs inside the framework boundary
 * (it's an `internalAction`, not directly callable; we invoke via
 * `t.action(internal.lib.menuRevalidate.revalidateMenuTag.revalidateMenuTag)`).
 */
const rawModules = import.meta.glob([
  "../../**/*.{ts,js}",
  "!../../**/*.test.*",
]);
const modules = Object.fromEntries(
  Object.entries(rawModules).map(([path, loader]) => [
    path.startsWith("./") ? `../../lib/menuRevalidate/${path.slice(2)}` : path,
    loader,
  ]),
);

describe("revalidateMenuTag — Convex→Next ISR invalidation channel", () => {
  let t: ReturnType<typeof convexTest>;
  let originalSecret: string | undefined;
  let originalUrl: string | undefined;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    t = convexTest(schema, modules);
    originalSecret = process.env.MENU_REVALIDATE_HMAC_SECRET;
    originalUrl = process.env.MENU_REVALIDATE_ROUTE_URL;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalSecret === undefined)
      delete process.env.MENU_REVALIDATE_HMAC_SECRET;
    else process.env.MENU_REVALIDATE_HMAC_SECRET = originalSecret;
    if (originalUrl === undefined) delete process.env.MENU_REVALIDATE_ROUTE_URL;
    else process.env.MENU_REVALIDATE_ROUTE_URL = originalUrl;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function seedTenant(): Promise<string> {
    const seed = await seedTwoTenantsAllRoles(t);
    return seed.tenantA.tenantId;
  }

  it("no-ops silently when env is unset (dev / CI fallback)", async () => {
    delete process.env.MENU_REVALIDATE_HMAC_SECRET;
    delete process.env.MENU_REVALIDATE_ROUTE_URL;
    const tenantId = await seedTenant();
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await t.action(
      internal.lib.menuRevalidate.revalidateMenuTag.revalidateMenuTag,
      { tenantId: tenantId as never },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("MISCONFIGURED");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the signed body to the configured route on the happy path", async () => {
    process.env.MENU_REVALIDATE_HMAC_SECRET = "test-secret";
    process.env.MENU_REVALIDATE_ROUTE_URL =
      "https://example.test/api/revalidate";
    const tenantId = await seedTenant();
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ revalidated: true }), { status: 200 }),
      );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const result = await t.action(
      internal.lib.menuRevalidate.revalidateMenuTag.revalidateMenuTag,
      { tenantId: tenantId as never },
    );
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe("https://example.test/api/revalidate");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(typeof headers["x-kb-timestamp"]).toBe("string");
    expect(typeof headers["x-kb-signature"]).toBe("string");
    expect(headers["x-kb-signature"]?.length).toBeGreaterThan(0);
    // Body is the EXACT JSON the Next route's pure validator
    // (decideRevalidateRequest) reverses to `tag: menu:<tenantId>`.
    const parsedBody = JSON.parse(init.body as string);
    expect(parsedBody).toEqual({ tenantId });
  });

  it("returns { ok: false, reason: 'HTTP_500' } on a non-2xx response (NOT a throw — NON-FATAL)", async () => {
    process.env.MENU_REVALIDATE_HMAC_SECRET = "test-secret";
    process.env.MENU_REVALIDATE_ROUTE_URL =
      "https://example.test/api/revalidate";
    const tenantId = await seedTenant();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response("nope", { status: 500 }),
      ) as unknown as typeof fetch;

    const result = await t.action(
      internal.lib.menuRevalidate.revalidateMenuTag.revalidateMenuTag,
      { tenantId: tenantId as never },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("HTTP_500");
  });

  it("returns { ok: false, reason: 'FETCH_ERROR' } on a thrown fetch (network down)", async () => {
    process.env.MENU_REVALIDATE_HMAC_SECRET = "test-secret";
    process.env.MENU_REVALIDATE_ROUTE_URL =
      "https://example.test/api/revalidate";
    const tenantId = await seedTenant();
    globalThis.fetch = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED")) as unknown as typeof fetch;

    const result = await t.action(
      internal.lib.menuRevalidate.revalidateMenuTag.revalidateMenuTag,
      { tenantId: tenantId as never },
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("FETCH_ERROR");
  });
});
