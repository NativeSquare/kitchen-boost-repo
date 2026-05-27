import { describe, expect, it } from "vitest";
import { signInternalRequest, verifyInternalRequest } from "./internalAuth";

/**
 * 2.8-B — the HMAC-signed internal channel between Convex and the Next.js Node
 * Wallet routes (US 23, STACK §2.3/§5.4), written BEFORE the implementation (TDD
 * red).
 *
 * The Apple Wallet Web Service routes (`apps/admin/api/wallet/*`) run the
 * crypto-heavy / binary work that does not belong in the Convex V8 runtime; the
 * data lives in Convex. The two sides authenticate each other with an HMAC-SHA256
 * signature over `${timestamp}.${body}` keyed on a shared secret
 * (`WALLET_INTERNAL_HMAC_SECRET`) — "seules des requêtes authentifiées de KB
 * déclenchent la génération" (issue). Same `crypto.subtle` HMAC the Stripe / Uber
 * webhook verifiers use (default runtime, no `"use node"`), so it is unit-testable
 * in isolation. We sign a body, then assert the verifier accepts the genuine pair
 * and rejects every tampered / wrong-secret / missing / stale case.
 */

const SECRET = "kb-internal-shared-secret";

describe("2.8-B signInternalRequest / verifyInternalRequest — accepts a genuine pair", () => {
  it("verifies a freshly signed body", async () => {
    const body = JSON.stringify({ serialNumber: "kb-1", pushToken: "tok" });
    const { timestamp, signature } = await signInternalRequest(SECRET, body);
    expect(
      await verifyInternalRequest({
        secret: SECRET,
        body,
        timestamp,
        signature,
      }),
    ).toBe(true);
  });

  it("verifies an empty body (a GET / DELETE with no payload)", async () => {
    const { timestamp, signature } = await signInternalRequest(SECRET, "");
    expect(
      await verifyInternalRequest({
        secret: SECRET,
        body: "",
        timestamp,
        signature,
      }),
    ).toBe(true);
  });
});

describe("2.8-B verifyInternalRequest — rejects tampering / misuse", () => {
  it("rejects a body altered after signing", async () => {
    const { timestamp, signature } = await signInternalRequest(
      SECRET,
      '{"amount":1}',
    );
    expect(
      await verifyInternalRequest({
        secret: SECRET,
        body: '{"amount":999}',
        timestamp,
        signature,
      }),
    ).toBe(false);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const body = '{"serialNumber":"kb-1"}';
    const { timestamp, signature } = await signInternalRequest(
      "attacker-secret",
      body,
    );
    expect(
      await verifyInternalRequest({
        secret: SECRET,
        body,
        timestamp,
        signature,
      }),
    ).toBe(false);
  });

  it("rejects a missing / empty signature", async () => {
    expect(
      await verifyInternalRequest({
        secret: SECRET,
        body: "{}",
        timestamp: "1700000000",
        signature: "",
      }),
    ).toBe(false);
  });

  it("rejects a missing timestamp", async () => {
    const { signature } = await signInternalRequest(SECRET, "{}");
    expect(
      await verifyInternalRequest({
        secret: SECRET,
        body: "{}",
        timestamp: null,
        signature,
      }),
    ).toBe(false);
  });

  it("rejects a stale request when a tolerance is enforced (replay protection)", async () => {
    const body = '{"serialNumber":"kb-old"}';
    const at = 1700000000;
    const { timestamp, signature } = await signInternalRequest(
      SECRET,
      body,
      at,
    );
    expect(
      await verifyInternalRequest({
        secret: SECRET,
        body,
        timestamp,
        signature,
        nowSeconds: at + 10_000, // far past tolerance
        toleranceSeconds: 300,
      }),
    ).toBe(false);
  });
});
