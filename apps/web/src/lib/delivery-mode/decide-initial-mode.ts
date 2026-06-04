/**
 * PWA-S5 (#453) — pure decision module: from the cached
 * `DeliveryQuoteVerdict` (S3 output), decide the initial state of the
 * `<DeliveryModeToggle>`: which mode is selected first, and which of the
 * two buttons must render disabled (CONTEXT client-ordering « Mode
 * toggle » / decisions-log Q7 / PRD US 24-26).
 *
 * The decision is the SINGLE source of truth for the toggle's enablement
 * — the React Context consumes it once at mount and the toggle UI does
 * NOT re-derive flags from the verdict on its own (one decision, pinned
 * by vitest, no duplicated narrowing in JSX). Same shape as
 * `decideAddressFirstAction` (S3) and `decideMenuDeepLink` (S4).
 */
import type { DeliveryQuoteVerdict } from "@/lib/address-first";

/** The two delivery modes the customer can pick at the toggle. */
export type DeliveryMode = "delivery" | "click_and_collect";

/** Output: initial mode + per-button enablement flags. */
export type InitialModeDecision = {
  initialMode: DeliveryMode;
  /** True iff the « Livraison » button must render disabled (greyed). */
  deliveryDisabled: boolean;
  /** True iff the « Retrait » button must render disabled (resto closed). */
  pickupDisabled: boolean;
};

/**
 * Decide the toggle's initial state.
 *
 * Branch map :
 *  - `deliverable: true` → delivery is the obvious default, both buttons
 *    enabled (the customer can switch any time, US 24).
 *  - `hors_zone` → delivery is unavailable, C&C is the only path forward
 *    (US 5 / US 26: « livraison grisée »).
 *  - `hors_horaire` → BOTH disabled (resto fermé, no pre-ordering V1 — US 6
 *    + CONTEXT delivery « Quote refusé »). C&C is selected as default just
 *    to have ONE value in `initialMode`, but the toggle UI will render
 *    everything disabled so it's never actionable.
 *  - `surge` → delivery is temporarily blocked, C&C remains (Khan can
 *    still serve walk-ups). The S3 Retry button stays on `/` so the user
 *    can re-try; if they push to /panier anyway, they get C&C.
 *  - `null` (verdict missing — deep-link into /panier without going
 *    through S3) → safe default: C&C, livraison disabled. We never crash
 *    on a missing verdict.
 */
export function decideInitialMode(
  verdict: DeliveryQuoteVerdict | null,
): InitialModeDecision {
  if (verdict === null) {
    return {
      initialMode: "click_and_collect",
      deliveryDisabled: true,
      pickupDisabled: false,
    };
  }
  if (verdict.deliverable) {
    return {
      initialMode: "delivery",
      deliveryDisabled: false,
      pickupDisabled: false,
    };
  }
  switch (verdict.reason) {
    case "hors_zone":
      return {
        initialMode: "click_and_collect",
        deliveryDisabled: true,
        pickupDisabled: false,
      };
    case "hors_horaire":
      return {
        initialMode: "click_and_collect",
        deliveryDisabled: true,
        pickupDisabled: true,
      };
    case "surge":
      return {
        initialMode: "click_and_collect",
        deliveryDisabled: true,
        pickupDisabled: false,
      };
    default: {
      // Exhaustiveness check (compile-time): a new reason without a branch
      // here becomes a type error — caught at build time.
      const _exhaustive: never = verdict.reason;
      throw new Error(
        `Unhandled delivery verdict reason: ${String(_exhaustive)}`,
      );
    }
  }
}
