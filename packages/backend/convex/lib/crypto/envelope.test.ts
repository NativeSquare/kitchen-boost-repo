import { describe, expect, it } from "vitest";
import {
  KEY_VERSION,
  decryptForTenant,
  encryptForTenant,
  packBlob,
  unpackBlob,
} from "./envelope";

/**
 * 1.x-E — envelope encryption of per-tenant secrets (Uber Direct credentials),
 * written BEFORE the implementation (TDD red). STACK.md §2.5: one master key in
 * the Convex env (`KMS_MASTER_KEY`, 32-byte base64), AES-256-GCM via Web Crypto
 * `crypto.subtle`, decrypt at-the-fly inside actions only.
 *
 * These are PURE crypto unit tests (no Convex pipeline): the round-trip and the
 * tamper-detection guarantees that everything else builds on. `KMS_MASTER_KEY`
 * is injected by `test.setup.ts` (a throw-away test key, never a real secret).
 *
 * Blob layout under test: `iv(12) + authTag(16) + ciphertext(n) + keyVersion`.
 */

describe("1.x-E envelope crypto — round-trip (AES-256-GCM, crypto.subtle)", () => {
  it("encrypt then decrypt returns the original plaintext", async () => {
    const plaintext = "uber-direct-customer-id:abc123|secret:s3cr3t-token";
    const blob = await encryptForTenant(plaintext);
    const recovered = await decryptForTenant(blob);
    expect(recovered).toBe(plaintext);
  });

  it("round-trips an empty string and unicode payloads", async () => {
    for (const pt of ["", "🍕 résumé naïve — Œuvre", "a".repeat(10_000)]) {
      expect(await decryptForTenant(await encryptForTenant(pt))).toBe(pt);
    }
  });

  it("produces a fresh random iv each time (no nonce reuse) yet both decrypt", async () => {
    const pt = "same plaintext";
    const a = await encryptForTenant(pt);
    const b = await encryptForTenant(pt);
    expect(a.iv).not.toBe(b.iv); // 96-bit random nonce per encryption
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(await decryptForTenant(a)).toBe(pt);
    expect(await decryptForTenant(b)).toBe(pt);
  });

  it("stamps the current keyVersion on every blob", async () => {
    const blob = await encryptForTenant("x");
    expect(blob.keyVersion).toBe(KEY_VERSION);
    expect(typeof blob.keyVersion).toBe("number");
  });

  it("separates the GCM auth tag from the ciphertext (16-byte tag, base64)", async () => {
    const blob = await encryptForTenant("payload");
    // authTag is the 128-bit GCM tag, base64 of exactly 16 bytes.
    const tagBytes = Buffer.from(blob.authTag, "base64");
    expect(tagBytes.length).toBe(16);
    // iv is the 96-bit nonce, base64 of exactly 12 bytes.
    const ivBytes = Buffer.from(blob.iv, "base64");
    expect(ivBytes.length).toBe(12);
  });
});

describe("1.x-E envelope crypto — tamper detection (GCM authTag)", () => {
  it("a flipped ciphertext byte fails decryption", async () => {
    const blob = await encryptForTenant("authentic message");
    const bytes = Buffer.from(blob.ciphertext, "base64");
    bytes[0] ^= 0x01; // flip one bit
    const tampered = { ...blob, ciphertext: bytes.toString("base64") };
    await expect(decryptForTenant(tampered)).rejects.toThrow();
  });

  it("a flipped auth-tag byte fails decryption", async () => {
    const blob = await encryptForTenant("authentic message");
    const tag = Buffer.from(blob.authTag, "base64");
    tag[0] ^= 0x80;
    const tampered = { ...blob, authTag: tag.toString("base64") };
    await expect(decryptForTenant(tampered)).rejects.toThrow();
  });

  it("a swapped iv fails decryption", async () => {
    const blob = await encryptForTenant("authentic message");
    const other = await encryptForTenant("another message");
    const tampered = { ...blob, iv: other.iv };
    await expect(decryptForTenant(tampered)).rejects.toThrow();
  });
});

describe("1.x-E envelope crypto — packed blob layout iv+authTag+ciphertext+keyVersion", () => {
  it("packs then unpacks to the same structured blob", async () => {
    const blob = await encryptForTenant("packed payload");
    const packed = packBlob(blob);
    const round = unpackBlob(packed);
    expect(round).toEqual(blob);
  });

  it("a packed blob still decrypts to the original after unpack", async () => {
    const pt = "decrypt-via-packed";
    const packed = packBlob(await encryptForTenant(pt));
    expect(await decryptForTenant(unpackBlob(packed))).toBe(pt);
  });

  it("tampering with the packed bytes fails decryption", async () => {
    const packed = packBlob(await encryptForTenant("packed authentic"));
    const bytes = Buffer.from(packed, "base64");
    // Flip a byte in the ciphertext region (after iv(12)+tag(16)).
    bytes[20] ^= 0x01;
    await expect(
      decryptForTenant(unpackBlob(bytes.toString("base64"))),
    ).rejects.toThrow();
  });
});
