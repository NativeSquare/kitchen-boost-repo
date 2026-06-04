/**
 * PWA-S6b (#456) — `urlBase64ToUint8Array` — convert the VAPID server public
 * key (read from `NEXT_PUBLIC_VAPID_PUBLIC_KEY`) from its url-safe base64
 * encoding into the raw `Uint8Array` that `PushManager.subscribe` accepts in
 * `applicationServerKey` (RFC 8292 + Web Push API).
 *
 * VAPID public keys are P-256 ECDSA public keys, 65 bytes uncompressed
 * (`0x04` + 32-byte X + 32-byte Y). Encoded as url-safe base64 (no padding),
 * they round-trip to 87 chars. The `web-push` lib generates them in that
 * format, and Apple/Google `PushManager.subscribe` requires the raw bytes (a
 * string is also accepted by Chromium but Safari rejects it — passing the
 * Uint8Array is the portable form).
 *
 * Pure function, node-pinnable: takes the string, returns the bytes. No DOM,
 * no `atob` shim hassle in node 20+ (`atob` is in the global scope since
 * Node 16). Replaces `-` → `+`, `_` → `/`, then re-pads to a multiple of 4.
 */
import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./encode-vapid-key";

describe("urlBase64ToUint8Array — RFC 4648 url-safe base64 round-trip", () => {
  it("decodes a known fixture to the expected bytes", () => {
    // A 4-byte payload (`abcd` = 0x61 0x62 0x63 0x64) encodes as `YWJjZA`
    // (no padding); after re-padding (`YWJjZA==`) and url→standard substitution
    // it decodes back to those 4 bytes.
    const bytes = urlBase64ToUint8Array("YWJjZA");
    expect(Array.from(bytes)).toEqual([0x61, 0x62, 0x63, 0x64]);
  });

  it("decodes a realistic VAPID P-256 public key (65 bytes uncompressed) to a 65-byte Uint8Array", () => {
    // A real VAPID public key starts with 0x04 (uncompressed P-256 marker)
    // and is 65 bytes / 87 url-safe-base64 chars (no padding) long.
    const fixture =
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8nlh9CFFv-uy_-1aTuO5e_pvjK7q4";
    const bytes = urlBase64ToUint8Array(fixture);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(65);
    expect(bytes[0]).toBe(0x04);
  });

  it("handles the url-safe substitutions `-` → `+` and `_` → `/`", () => {
    // The standard-base64 of byte 0xfb is "+w==", url-safe = "-w==".
    // Without the substitutions, atob would throw / decode garbage.
    const bytes = urlBase64ToUint8Array("-w");
    expect(Array.from(bytes)).toEqual([0xfb]);
  });

  it("re-pads strings whose length is not already a multiple of 4", () => {
    // `YQ` (length 2) → `YQ==` after pad → byte 0x61. Without re-pad, atob
    // throws InvalidCharacterError on Chrome / DOMException on Node.
    const bytes = urlBase64ToUint8Array("YQ");
    expect(Array.from(bytes)).toEqual([0x61]);
  });

  it("returns an empty Uint8Array for the empty string (defensive — never throws)", () => {
    expect(urlBase64ToUint8Array("").length).toBe(0);
  });
});
