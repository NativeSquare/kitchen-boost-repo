/**
 * PWA-S9a (#460) — `decideWalletPromptVisibility` — pure decision returning
 * whether either Wallet install prompt (palier 1 card after address-first,
 * palier 2 banner permanent on menu/panier) should be visible (decisions-log
 * Q5 « 3 paliers Wallet install », US 27 + US 28).
 *
 * Same shape as `decidePaymentGate` (PWA-S6 / #454) — splits the decision from
 * the React IO so every branch is vitest-pinnable in node env (mirrors the
 * `checkout-gate` / `push-enrollment` / `address-first` modules).
 *
 * Branch map (issue acceptance criteria + decisions-log Q5) :
 *  1. walletStatus undefined (no fiche / no pushEnrollment / never asked) +
 *     not dismissed → SHOW (the fresh fiche case is the primary moat surface).
 *  2. walletStatus "not_enrolled" + not dismissed → SHOW.
 *  3. walletStatus "revoked" + not dismissed → SHOW (revoked = the user
 *     removed the pass; we re-offer it just like a fresh fiche — Q5 « hide
 *     paliers SI déjà enrolled »: only `enrolled` vetoes).
 *  4. walletStatus "enrolled" → HIDDEN regardless of `dismissed` (the moat
 *     is captured — no point nagging an already-converted user).
 *  5. walletStatus undefined / not_enrolled / revoked + dismissed = true →
 *     HIDDEN (the banner X / the « Plus tard » link respected within the
 *     session — issue AC « dismiss palier 2 ne ré-apparaît pas pour la
 *     session, re-apparaît à la session suivante »).
 *
 * `dismissed` is a session-scoped boolean (the banner uses sessionStorage,
 * the card's « Plus tard » is a navigation away — both consume the same pure
 * decision so a future palier 0 / palier 3 can re-use it).
 */
import { describe, expect, it } from "vitest";
import {
  type PushChannelStatus,
  type WalletPromptVisibility,
  decideWalletPromptVisibility,
} from "./decide-wallet-prompt-visibility";

describe("decideWalletPromptVisibility — show branches", () => {
  it("returns show when walletStatus is undefined (fresh fiche) and not dismissed", () => {
    const v = decideWalletPromptVisibility({
      walletStatus: undefined,
      dismissed: false,
    });
    expect(v.kind).toBe("show");
  });

  it("returns show when walletStatus is `not_enrolled` and not dismissed", () => {
    const v = decideWalletPromptVisibility({
      walletStatus: "not_enrolled",
      dismissed: false,
    });
    expect(v.kind).toBe("show");
  });

  it("returns show when walletStatus is `revoked` and not dismissed (re-offer after pass removal)", () => {
    // Q5: only `enrolled` vetoes — `revoked` is treated like `not_enrolled`
    // (the user removed the pass; we re-offer the moat).
    const v = decideWalletPromptVisibility({
      walletStatus: "revoked",
      dismissed: false,
    });
    expect(v.kind).toBe("show");
  });
});

describe("decideWalletPromptVisibility — hidden branches (enrolled wins)", () => {
  it("returns hidden when walletStatus is `enrolled`, even if not dismissed", () => {
    // Issue AC: « install Wallet effectif → 3 paliers hidden via Convex sub
    // realtime ». `enrolled` ALWAYS hides — the user already converted.
    const v = decideWalletPromptVisibility({
      walletStatus: "enrolled",
      dismissed: false,
    });
    expect(v.kind).toBe("hidden");
    if (v.kind !== "hidden") throw new Error("unreachable");
    expect(v.reason).toBe("already-enrolled");
  });

  it("returns hidden when walletStatus is `enrolled` AND dismissed (enrolled wins)", () => {
    const v = decideWalletPromptVisibility({
      walletStatus: "enrolled",
      dismissed: true,
    });
    expect(v.kind).toBe("hidden");
    if (v.kind !== "hidden") throw new Error("unreachable");
    expect(v.reason).toBe("already-enrolled");
  });
});

describe("decideWalletPromptVisibility — hidden branches (dismissed)", () => {
  it("returns hidden when walletStatus is undefined but dismissed in session", () => {
    // Issue AC palier 2: « dismiss palier 2 → ne ré-apparaît pas pour la
    // session, re-apparaît à la session suivante » — dismissed is the
    // session-scoped flag the banner sets in sessionStorage.
    const v = decideWalletPromptVisibility({
      walletStatus: undefined,
      dismissed: true,
    });
    expect(v.kind).toBe("hidden");
    if (v.kind !== "hidden") throw new Error("unreachable");
    expect(v.reason).toBe("dismissed");
  });

  it("returns hidden when walletStatus is `not_enrolled` and dismissed", () => {
    const v = decideWalletPromptVisibility({
      walletStatus: "not_enrolled",
      dismissed: true,
    });
    expect(v.kind).toBe("hidden");
    if (v.kind !== "hidden") throw new Error("unreachable");
    expect(v.reason).toBe("dismissed");
  });

  it("returns hidden when walletStatus is `revoked` and dismissed", () => {
    const v = decideWalletPromptVisibility({
      walletStatus: "revoked",
      dismissed: true,
    });
    expect(v.kind).toBe("hidden");
  });
});

describe("decideWalletPromptVisibility — pure / referential transparency", () => {
  it("returns the same shape twice for the same input (no hidden state)", () => {
    const input = {
      walletStatus: "not_enrolled" as PushChannelStatus,
      dismissed: false,
    };
    const a = decideWalletPromptVisibility(input);
    const b = decideWalletPromptVisibility(input);
    expect(a).toEqual(b);
  });

  it("never mutates the input (pure function)", () => {
    const input = Object.freeze({
      walletStatus: "not_enrolled" as PushChannelStatus,
      dismissed: false,
    });
    expect(() => decideWalletPromptVisibility(input)).not.toThrow();
  });
});

describe("decideWalletPromptVisibility — typing surface", () => {
  it("exposes a discriminated union on `kind` so callers can switch exhaustively", () => {
    const cases: WalletPromptVisibility[] = [
      { kind: "show" },
      { kind: "hidden", reason: "already-enrolled" },
      { kind: "hidden", reason: "dismissed" },
    ];
    for (const c of cases) {
      switch (c.kind) {
        case "show":
          expect(c).toEqual({ kind: "show" });
          break;
        case "hidden":
          expect(
            c.reason === "already-enrolled" || c.reason === "dismissed",
          ).toBe(true);
          break;
        default: {
          const _exhaustive: never = c;
          throw new Error(
            `Unhandled visibility kind: ${String((_exhaustive as { kind: string }).kind)}`,
          );
        }
      }
    }
  });
});
