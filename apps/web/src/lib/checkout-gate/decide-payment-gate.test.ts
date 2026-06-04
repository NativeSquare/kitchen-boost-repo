/**
 * PWA-S6 (#454) — `decidePaymentGate` — pure decision returning the state of
 * the "Payer X €" CTA on `/checkout`, given the customer's
 * `pushEnrollment.{walletStatus, webPushStatus, a2hsStatus}` snapshot
 * (decisions-log Q8 « Détection canal actif côté front pour gate Payer »,
 * CONTEXT customer-data « Règle d'or V1 : tout client qui valide une cmd
 * doit avoir au moins UN canal Push enrollment actif »).
 *
 * Splitting the gate decision from the React IO keeps every branch
 * vitest-pinnable in node env, mirroring the `decideAddressFirstAction` /
 * `decideManifest` / `decideTenantResolution` pattern of the previous PWA
 * slices.
 *
 * Branches we pin (one per relevant combination of channel statuses):
 *   1. `pushEnrollment` absent (anonymous fiche, never enrolled) → disabled,
 *      reason `no-channel-enrolled`.
 *   2. All 3 channels = `not_enrolled` (initial state) → disabled.
 *   3. All 3 channels = `revoked` (user removed pass + denied permission) →
 *      disabled (revoked ≠ enrolled).
 *   4. `walletStatus = "enrolled"` alone → active.
 *   5. `webPushStatus = "enrolled"` alone → active.
 *   6. `a2hsStatus = "enrolled"` alone → active.
 *   7. 2+ channels enrolled (mix) → active.
 *   8. 1 channel enrolled + others revoked → active (presence of ANY enrolled
 *      is sufficient — Q8 « si au moins UN = enrolled → modal NE s'affiche
 *      PAS, bouton actif direct »).
 *
 * Note: S6 is the *skeleton* slice — S6a/S6b/S6c will add the modal that
 * actually drives the enrollment when the gate is disabled. Here we only
 * decide the *state* of the button + a stub click handler.
 */
import { describe, expect, it } from "vitest";
import {
  type PaymentGateState,
  type PushEnrollmentSnapshot,
  decidePaymentGate,
} from "./decide-payment-gate";

const EMPTY: PushEnrollmentSnapshot = {};
const ALL_NOT_ENROLLED: PushEnrollmentSnapshot = {
  walletStatus: "not_enrolled",
  webPushStatus: "not_enrolled",
  a2hsStatus: "not_enrolled",
};
const ALL_REVOKED: PushEnrollmentSnapshot = {
  walletStatus: "revoked",
  webPushStatus: "revoked",
  a2hsStatus: "revoked",
};

describe("decidePaymentGate — disabled branches", () => {
  it("returns disabled when pushEnrollment is undefined (fresh fiche)", () => {
    const gate = decidePaymentGate(undefined);
    expect(gate.kind).toBe("disabled");
    if (gate.kind !== "disabled") throw new Error("unreachable");
    expect(gate.reason).toBe("no-channel-enrolled");
  });

  it("returns disabled when pushEnrollment is an empty object (provisioned but never enrolled)", () => {
    const gate = decidePaymentGate(EMPTY);
    expect(gate.kind).toBe("disabled");
    if (gate.kind !== "disabled") throw new Error("unreachable");
    expect(gate.reason).toBe("no-channel-enrolled");
  });

  it("returns disabled when all 3 channels are explicitly `not_enrolled`", () => {
    const gate = decidePaymentGate(ALL_NOT_ENROLLED);
    expect(gate.kind).toBe("disabled");
  });

  it("returns disabled when all 3 channels are `revoked` (revoked ≠ enrolled)", () => {
    const gate = decidePaymentGate(ALL_REVOKED);
    expect(gate.kind).toBe("disabled");
  });
});

describe("decidePaymentGate — active branches", () => {
  it("returns active when walletStatus alone is enrolled", () => {
    const gate = decidePaymentGate({
      walletStatus: "enrolled",
      webPushStatus: "not_enrolled",
      a2hsStatus: "not_enrolled",
    });
    expect(gate.kind).toBe("active");
    if (gate.kind !== "active") throw new Error("unreachable");
    expect(gate.enrolledChannels).toEqual(["wallet"]);
  });

  it("returns active when webPushStatus alone is enrolled", () => {
    const gate = decidePaymentGate({
      walletStatus: "not_enrolled",
      webPushStatus: "enrolled",
      a2hsStatus: "not_enrolled",
    });
    expect(gate.kind).toBe("active");
    if (gate.kind !== "active") throw new Error("unreachable");
    expect(gate.enrolledChannels).toEqual(["webPush"]);
  });

  it("returns active when a2hsStatus alone is enrolled", () => {
    const gate = decidePaymentGate({
      walletStatus: "not_enrolled",
      webPushStatus: "not_enrolled",
      a2hsStatus: "enrolled",
    });
    expect(gate.kind).toBe("active");
    if (gate.kind !== "active") throw new Error("unreachable");
    expect(gate.enrolledChannels).toEqual(["a2hs"]);
  });

  it("returns active and lists every enrolled channel when 2+ are enrolled", () => {
    const gate = decidePaymentGate({
      walletStatus: "enrolled",
      webPushStatus: "enrolled",
      a2hsStatus: "not_enrolled",
    });
    expect(gate.kind).toBe("active");
    if (gate.kind !== "active") throw new Error("unreachable");
    expect(gate.enrolledChannels).toEqual(["wallet", "webPush"]);
  });

  it("returns active when 1 channel is enrolled even if the other 2 are revoked", () => {
    // Q8: ANY enrolled is sufficient — revoked siblings do NOT veto.
    const gate = decidePaymentGate({
      walletStatus: "revoked",
      webPushStatus: "enrolled",
      a2hsStatus: "revoked",
    });
    expect(gate.kind).toBe("active");
    if (gate.kind !== "active") throw new Error("unreachable");
    expect(gate.enrolledChannels).toEqual(["webPush"]);
  });
});

describe("decidePaymentGate — noChannelPossible escape hatch (PWA-S6c #457)", () => {
  it("returns active with channel `noChannelPossible` when the flag is true and no channel is enrolled (the SMS fallback path)", () => {
    // S6c: after the 3-level frictional fallback is exhausted and the
    // backend mutation `customer.pushEnrollment.markNoChannelPossible` flips
    // the flag, the Convex sub re-renders the form and the Payer CTA MUST
    // unlock — the user proceeds without any push channel, with SMS fallback
    // transactionnel via Cascade Notifications (decisions-log Q8 (5),
    // CONTEXT customer-data « Push enrollment » + « SMS fallback »).
    const gate = decidePaymentGate({
      walletStatus: "revoked",
      webPushStatus: "revoked",
      a2hsStatus: "not_enrolled",
      noChannelPossible: true,
    });
    expect(gate.kind).toBe("active");
    if (gate.kind !== "active") throw new Error("unreachable");
    expect(gate.enrolledChannels).toEqual(["noChannelPossible"]);
  });

  it("keeps active branches intact when noChannelPossible is also true (a successfully-enrolled channel still wins the listing)", () => {
    // Defensive: if for some reason both an enrolled channel AND the flag are
    // present (e.g. user enrolled Wallet later from a Wallet card prompt),
    // the gate stays active and the enrolled channel is listed FIRST — the
    // SMS fallback is the LAST-resort label.
    const gate = decidePaymentGate({
      walletStatus: "enrolled",
      webPushStatus: "not_enrolled",
      a2hsStatus: "not_enrolled",
      noChannelPossible: true,
    });
    expect(gate.kind).toBe("active");
    if (gate.kind !== "active") throw new Error("unreachable");
    expect(gate.enrolledChannels).toEqual(["wallet", "noChannelPossible"]);
  });

  it("noChannelPossible = false / undefined is NOT a substitute for an enrolled channel (false === disabled)", () => {
    const gateFalse = decidePaymentGate({
      walletStatus: "not_enrolled",
      webPushStatus: "not_enrolled",
      a2hsStatus: "not_enrolled",
      noChannelPossible: false,
    });
    expect(gateFalse.kind).toBe("disabled");
    const gateUndef = decidePaymentGate({
      walletStatus: "not_enrolled",
      webPushStatus: "not_enrolled",
      a2hsStatus: "not_enrolled",
    });
    expect(gateUndef.kind).toBe("disabled");
  });
});

describe("decidePaymentGate — pure / referential transparency", () => {
  it("returns the same shape twice for the same input (no hidden state)", () => {
    const snap: PushEnrollmentSnapshot = { walletStatus: "enrolled" };
    const a = decidePaymentGate(snap);
    const b = decidePaymentGate(snap);
    // Deep equality (the same kind + the same enrolledChannels order).
    expect(a).toEqual(b);
  });

  it("never mutates the input snapshot (pure function)", () => {
    const snap: PushEnrollmentSnapshot = {
      walletStatus: "enrolled",
      webPushStatus: "not_enrolled",
    };
    const frozen = Object.freeze({ ...snap });
    // Will throw if the function tries to mutate the frozen object.
    expect(() => decidePaymentGate(frozen)).not.toThrow();
  });
});

describe("decidePaymentGate — typing surface", () => {
  it("exposes a discriminated union on `kind` so callers can switch exhaustively", () => {
    const gates: PaymentGateState[] = [
      { kind: "disabled", reason: "no-channel-enrolled" },
      { kind: "active", enrolledChannels: ["wallet"] },
    ];
    for (const g of gates) {
      switch (g.kind) {
        case "disabled":
          expect(g.reason).toBe("no-channel-enrolled");
          break;
        case "active":
          expect(g.enrolledChannels.length).toBeGreaterThan(0);
          break;
        default: {
          const _exhaustive: never = g;
          throw new Error(
            `Unhandled gate kind: ${String((_exhaustive as { kind: string }).kind)}`,
          );
        }
      }
    }
  });
});
