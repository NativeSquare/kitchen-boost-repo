import { describe, expect, it } from "vitest";
import { parseStripeSignatureHeader, verifyStripeSignature } from "./signature";

/**
 * 2.5-A — Stripe webhook HMAC verification on the RAW body (PRD 30 §1, POC #1).
 * Written BEFORE the implementation (TDD red). We sign a payload exactly the way
 * Stripe does (`HMAC-SHA256(secret, "${t}.${rawBody}")`, hex) with `crypto.subtle`
 * and assert the verifier accepts a good signature and rejects every tampered /
 * malformed / stale case.
 */

const SECRET = "whsec_test_secret";

/** Re-implement Stripe's signing here (the verifier under test must agree). */
async function sign(rawBody: string, t: string, secret = SECRET) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${t}.${rawBody}`),
  );
  const hex = [...new Uint8Array(sig)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `t=${t},v1=${hex}`;
}

describe("2.5-A parseStripeSignatureHeader", () => {
  it("extracts the timestamp and all v1 MACs", () => {
    const parsed = parseStripeSignatureHeader("t=123,v1=aaa,v1=bbb");
    expect(parsed.timestamp).toBe("123");
    expect(parsed.v1).toEqual(["aaa", "bbb"]);
  });

  it("returns nulls/empties for a malformed header", () => {
    const parsed = parseStripeSignatureHeader("garbage");
    expect(parsed.timestamp).toBeNull();
    expect(parsed.v1).toEqual([]);
  });
});

describe("2.5-A verifyStripeSignature — accepts a genuine Stripe signature", () => {
  it("accepts a correctly signed raw body", async () => {
    const rawBody = '{"id":"evt_1","type":"account.updated"}';
    const header = await sign(rawBody, "1700000000");
    expect(
      await verifyStripeSignature({ rawBody, header, secret: SECRET }),
    ).toBe(true);
  });

  it("accepts when one of several v1 MACs matches (key rotation)", async () => {
    const rawBody = '{"id":"evt_2"}';
    const good = await sign(rawBody, "1700000000");
    // Inject a bogus v1 alongside the good one.
    const header = good.replace("v1=", "v1=deadbeef,v1=");
    expect(
      await verifyStripeSignature({ rawBody, header, secret: SECRET }),
    ).toBe(true);
  });
});

describe("2.5-A verifyStripeSignature — rejects tampering / misuse", () => {
  it("rejects a body that was altered after signing", async () => {
    const header = await sign('{"amount":1}', "1700000000");
    expect(
      await verifyStripeSignature({
        rawBody: '{"amount":999}',
        header,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a signature made with the wrong secret", async () => {
    const rawBody = '{"id":"evt_3"}';
    const header = await sign(rawBody, "1700000000", "whsec_attacker");
    expect(
      await verifyStripeSignature({ rawBody, header, secret: SECRET }),
    ).toBe(false);
  });

  it("rejects a missing header", async () => {
    expect(
      await verifyStripeSignature({
        rawBody: "{}",
        header: null,
        secret: SECRET,
      }),
    ).toBe(false);
  });

  it("rejects a stale event when a tolerance is enforced", async () => {
    const rawBody = '{"id":"evt_old"}';
    const t = "1700000000";
    const header = await sign(rawBody, t);
    expect(
      await verifyStripeSignature({
        rawBody,
        header,
        secret: SECRET,
        nowSeconds: 1700000000 + 10_000, // far past tolerance
        toleranceSeconds: 300,
      }),
    ).toBe(false);
  });
});
