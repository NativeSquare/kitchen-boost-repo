/**
 * PWA-S3 (#451) — `decideAddressFirstAction` — pure routing decision returning
 * the UI action to perform after the address-first chain
 * (`signIn → getOrCreateCurrentCustomer → updateAddress → requestDeliveryQuote`)
 * resolves into a delivery verdict. Written BEFORE the implementation (TDD red).
 *
 * The `<AddressFirstForm>` component (client) consumes this pure function to
 * branch on the 4 verdicts spec'd in decisions-log Q7 (PRD §10 PWA Client) —
 * splitting "decide" from "perform" lets vitest pin every branch in node env,
 * mirroring the `tenant-resolver` / `pwa-manifest` pattern of PWA-S1 / PWA-S2.
 *
 * Branches we pin (one per delivery verdict, US 2-8):
 *   1. `deliverable: true`  → redirect `/menu`, mode `delivery` pre-selected.
 *   2. `hors_zone`          → stay on `/` showing a toast + CTA "Voir le menu
 *      (retrait sur place)" that navigates to `/menu` in C&C mode.
 *   3. `hors_horaire`       → stay on `/` showing the closed message; no CTA
 *      offered (checkout is disabled at this stage; pre-ordering deferred V3).
 *   4. `surge`              → stay on `/` showing a transient message + Retry
 *      CTA that re-fires `requestDeliveryQuote` for the same address.
 *
 * The verdict shape mirrors `lib/delivery/quote.DeliveryQuoteVerdict` (the
 * backend action's declared return). We keep a local `DeliveryQuoteVerdict`
 * type here so the front never depends on backend internals — only on the
 * stable wire shape — and the test can build verdict fixtures without
 * importing convex types.
 */
import { describe, expect, it } from "vitest";
import {
  type DeliveryQuoteVerdict,
  decideAddressFirstAction,
} from "./decide-address-first-action";

const DELIVERABLE: DeliveryQuoteVerdict = {
  deliverable: true,
  fee: 295,
  eta: 24,
  quoteId: "dqt_fixture_42",
};

describe("decideAddressFirstAction — deliverable verdict", () => {
  it("redirects to /menu with the delivery mode pre-selected", () => {
    const action = decideAddressFirstAction(DELIVERABLE);
    expect(action.kind).toBe("redirect");
    if (action.kind !== "redirect") throw new Error("unreachable");
    expect(action.path).toBe("/menu");
    expect(action.mode).toBe("delivery");
  });

  it("carries the fee + eta + quoteId so /menu can show the verdict without re-quoting", () => {
    const action = decideAddressFirstAction(DELIVERABLE);
    if (action.kind !== "redirect") throw new Error("unreachable");
    // PRD Q7 (3): the two modes are cached in the verdict initial — /menu /
    // /panier toggle switches without re-quote, so the redirect carries
    // exactly what /menu needs to render `[🛵 Livraison · 2,95 €]`.
    expect(action.fee).toBe(295);
    expect(action.eta).toBe(24);
    expect(action.quoteId).toBe("dqt_fixture_42");
  });
});

describe("decideAddressFirstAction — hors_zone verdict", () => {
  it("stays on / with a toast + CTA navigating to /menu in C&C mode", () => {
    const action = decideAddressFirstAction({
      deliverable: false,
      reason: "hors_zone",
    });
    expect(action.kind).toBe("show-message");
    if (action.kind !== "show-message") throw new Error("unreachable");
    expect(action.reason).toBe("hors_zone");
    // US 5: « trop éloignée — viens chercher » + CTA to switch to C&C.
    expect(action.cta?.label).toBe("Voir le menu (retrait sur place)");
    expect(action.cta?.path).toBe("/menu");
    expect(action.cta?.mode).toBe("click_and_collect");
    expect(action.canRetry).toBe(false);
  });
});

describe("decideAddressFirstAction — hors_horaire verdict", () => {
  it("stays on / with the closed message and NO CTA (no pre-ordering V1)", () => {
    const action = decideAddressFirstAction({
      deliverable: false,
      reason: "hors_horaire",
    });
    expect(action.kind).toBe("show-message");
    if (action.kind !== "show-message") throw new Error("unreachable");
    expect(action.reason).toBe("hors_horaire");
    // US 6 + decisions-log Q7: « Le resto est fermé, ouvre à 18h30 » + checkout
    // bloqué. No `cta` is surfaced — C&C is unavailable when closed too.
    expect(action.cta).toBeUndefined();
    expect(action.canRetry).toBe(false);
  });
});

describe("decideAddressFirstAction — surge verdict", () => {
  it("stays on / with a transient message + Retry CTA (idempotent re-fire)", () => {
    const action = decideAddressFirstAction({
      deliverable: false,
      reason: "surge",
    });
    expect(action.kind).toBe("show-message");
    if (action.kind !== "show-message") throw new Error("unreachable");
    expect(action.reason).toBe("surge");
    // US 7: « Indisponible à cet horaire, réessaie dans quelques minutes » +
    // bouton Retry → re-fire `requestDeliveryQuote` for the same address. The
    // pure decision surfaces `canRetry: true` and leaves the IO to the form.
    expect(action.cta).toBeUndefined();
    expect(action.canRetry).toBe(true);
  });
});

describe("decideAddressFirstAction — exhaustiveness", () => {
  it("returns the same shape for every reason (typescript exhaustiveness on `reason`)", () => {
    // Defensive: if a new reason is added to `DeliveryQuoteVerdict` later
    // without updating the action map, this test forces an explicit update
    // (the switch in the implementation must compile against `never` for the
    // default branch).
    const reasons = ["hors_zone", "hors_horaire", "surge"] as const;
    for (const reason of reasons) {
      const action = decideAddressFirstAction({ deliverable: false, reason });
      expect(action.kind).toBe("show-message");
    }
  });
});
