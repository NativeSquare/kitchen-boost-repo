import { describe, expect, it } from "vitest";
import { type WalletPushPayload, buildWalletPushPayload } from "./pushPayload";

/**
 * 2.8-D — the PURE Wallet push payload builder, written BEFORE the implementation
 * (TDD red).
 *
 * `triggerUpdate` (the Convex action) decides WHAT to push (which serial, on which
 * device tokens, alert vs silent) but the crypto/transport (APNs HTTP/2) lives in
 * the Next.js Node route (`apps/admin/api/wallet/push`, STACK §2.3/§5.4). The
 * SHAPE of the body the action signs + forwards to that route is a pure value: no
 * Convex ctx, no network, so it is unit-testable in isolation (same discipline as
 * `internalAuth` / the notifications engine).
 *
 * The product distinction it carries (US 16 / PRD 80 §1):
 *  - `silent: true`  → "Wallet update silencieux" (Info statut) — the visible card
 *    content updates WITHOUT a lock-screen push. Used for the intermediate order
 *    steps AND for the re-branding (US 17 / ADR 0003 — name/logo change, no alert).
 *  - `silent: false` → a real lock-screen Wallet push (Temps-réel / Archive).
 */

describe("2.8-D buildWalletPushPayload — shape forwarded to the Node APNs route", () => {
  it("carries the serial, the FIXED passTypeIdentifier and the active push tokens", () => {
    const payload = buildWalletPushPayload({
      serialNumber: "kb-push-1",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      pushTokens: ["tok-a", "tok-b"],
      silent: false,
    });
    expect(payload.serialNumber).toBe("kb-push-1");
    expect(payload.passTypeIdentifier).toBe("pass.com.kitchen-boost.card");
    expect(payload.pushTokens).toEqual(["tok-a", "tok-b"]);
  });

  it("marks a silent Wallet update (Info statut, US 16) — no lock-screen push", () => {
    const payload = buildWalletPushPayload({
      serialNumber: "kb-push-2",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      pushTokens: ["tok"],
      silent: true,
    });
    expect(payload.silent).toBe(true);
  });

  it("marks an effective lock-screen push (Temps-réel / Archive, US 16)", () => {
    const payload = buildWalletPushPayload({
      serialNumber: "kb-push-3",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      pushTokens: ["tok"],
      silent: false,
    });
    expect(payload.silent).toBe(false);
  });

  it("is JSON-serialisable (it travels as the signed HMAC body)", () => {
    const payload: WalletPushPayload = buildWalletPushPayload({
      serialNumber: "kb-push-4",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      pushTokens: ["tok"],
      silent: true,
    });
    const round = JSON.parse(JSON.stringify(payload)) as WalletPushPayload;
    expect(round).toEqual(payload);
  });

  it("preserves an empty token list (a pass with no active device → nothing to push)", () => {
    const payload = buildWalletPushPayload({
      serialNumber: "kb-push-5",
      passTypeIdentifier: "pass.com.kitchen-boost.card",
      pushTokens: [],
      silent: false,
    });
    expect(payload.pushTokens).toEqual([]);
  });
});
