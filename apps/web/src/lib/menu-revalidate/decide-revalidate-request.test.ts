/**
 * PWA-S4 (#452) — `decideRevalidateRequest` — PURE validator that turns the
 * raw inputs of `POST /api/revalidate` (HMAC-protected by the same internal
 * Convex→Node channel pattern as Web Push / Wallet) into a verdict the route
 * handler acts on. Written BEFORE the implementation (TDD red).
 *
 * The route lives in `apps/web/src/app/api/revalidate/route.ts`; the Convex
 * `publishMenu` mutation schedules an `internalAction` that POSTs here with
 * `{ tenantId: "<id>" }` body, signed `x-kb-signature` / `x-kb-timestamp`
 * (HMAC-SHA256 over `${timestamp}.${body}`, secret `MENU_REVALIDATE_HMAC_SECRET`).
 * On valid signature + parseable body, the verdict carries the
 * `tag` (`menu:<tenantId>`) the route then passes to `revalidateTag(…)`.
 *
 * Verdict shape:
 *  - `kind: "ok"` ⇒ route calls `revalidateTag(tag)` and returns 200.
 *  - `kind: "unauthorized"` ⇒ route returns 401 (forged / stale / unsigned).
 *  - `kind: "bad-request"` ⇒ route returns 400 (body parsed but tenantId missing
 *    / not a string / empty).
 *
 * Why pure: the HMAC verification + the body parsing + the tag derivation are
 * all decidable from inputs (`{ secret, body, timestamp, signature }`). The
 * route is a thin IO wrapper that reads the request, calls this function, and
 * branches on the verdict.
 */
import { describe, expect, it } from "vitest";
import { decideRevalidateRequest } from "./decide-revalidate-request";

const SECRET = "test-secret-key-fixture";

/** Build the exact signature the Convex internalAction would produce. */
async function signFixture(timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("decideRevalidateRequest — valid signature + valid body", () => {
  it("returns kind: 'ok' with tag `menu:<tenantId>`", async () => {
    const body = JSON.stringify({ tenantId: "tenant_bunsbao_42" });
    const ts = "1735720000"; // fixed seconds since epoch
    const sig = await signFixture(ts, body);

    const verdict = await decideRevalidateRequest({
      secret: SECRET,
      body,
      timestamp: ts,
      signature: sig,
      nowSeconds: 1735720005, // 5s after — within tolerance
      toleranceSeconds: 300,
    });

    expect(verdict.kind).toBe("ok");
    if (verdict.kind !== "ok") throw new Error("unreachable");
    expect(verdict.tag).toBe("menu:tenant_bunsbao_42");
  });
});

describe("decideRevalidateRequest — unauthorized (forged / stale / unsigned)", () => {
  it("rejects a missing signature", async () => {
    const body = JSON.stringify({ tenantId: "tenant_x" });
    const verdict = await decideRevalidateRequest({
      secret: SECRET,
      body,
      timestamp: "1735720000",
      signature: null,
      nowSeconds: 1735720005,
      toleranceSeconds: 300,
    });
    expect(verdict.kind).toBe("unauthorized");
  });

  it("rejects a wrong-secret signature", async () => {
    const body = JSON.stringify({ tenantId: "tenant_x" });
    const ts = "1735720000";
    const sig = await signFixture(ts, body); // signed with SECRET

    const verdict = await decideRevalidateRequest({
      secret: "different-secret",
      body,
      timestamp: ts,
      signature: sig,
      nowSeconds: 1735720005,
      toleranceSeconds: 300,
    });
    expect(verdict.kind).toBe("unauthorized");
  });

  it("rejects a stale timestamp beyond the tolerance (replay protection)", async () => {
    const body = JSON.stringify({ tenantId: "tenant_x" });
    const ts = "1735720000";
    const sig = await signFixture(ts, body);

    const verdict = await decideRevalidateRequest({
      secret: SECRET,
      body,
      timestamp: ts,
      signature: sig,
      // 600s later — outside the 300s tolerance (mirror Web Push window).
      nowSeconds: 1735720000 + 600,
      toleranceSeconds: 300,
    });
    expect(verdict.kind).toBe("unauthorized");
  });
});

describe("decideRevalidateRequest — bad request (auth OK but body invalid)", () => {
  it("rejects a body without tenantId", async () => {
    const body = JSON.stringify({ something: "else" });
    const ts = "1735720000";
    const sig = await signFixture(ts, body);

    const verdict = await decideRevalidateRequest({
      secret: SECRET,
      body,
      timestamp: ts,
      signature: sig,
      nowSeconds: 1735720005,
      toleranceSeconds: 300,
    });
    expect(verdict.kind).toBe("bad-request");
  });

  it("rejects a body with empty tenantId", async () => {
    const body = JSON.stringify({ tenantId: "" });
    const ts = "1735720000";
    const sig = await signFixture(ts, body);

    const verdict = await decideRevalidateRequest({
      secret: SECRET,
      body,
      timestamp: ts,
      signature: sig,
      nowSeconds: 1735720005,
      toleranceSeconds: 300,
    });
    expect(verdict.kind).toBe("bad-request");
  });

  it("rejects a non-JSON body (typo / corruption)", async () => {
    const body = "not json{";
    const ts = "1735720000";
    const sig = await signFixture(ts, body);

    const verdict = await decideRevalidateRequest({
      secret: SECRET,
      body,
      timestamp: ts,
      signature: sig,
      nowSeconds: 1735720005,
      toleranceSeconds: 300,
    });
    expect(verdict.kind).toBe("bad-request");
  });
});
