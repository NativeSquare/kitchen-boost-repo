/**
 * Pure decision: what should happen when the customer taps the « Livraison »
 * button while it is in its DISABLED state.
 *
 * Root-cause of the feedback (deep link in a fresh tab, no cookie, no cached
 * verdict): `decideInitialMode(null)` returns `deliveryDisabled: true`, so the
 * Livraison button renders as a DEAD disabled button. That is bad UX — the
 * customer has simply never entered an address yet, so we should INVITE them to
 * (open the address bottom sheet) rather than show an inert greyed button.
 *
 * But « disabled » covers two structurally different situations:
 *  - `null` verdict  → the address is simply UNKNOWN (deep-link without going
 *    through the address-first flow). Tapping Livraison should OPEN the address
 *    sheet so the customer can enter one and unlock delivery.
 *  - a REFUSAL verdict (`hors_zone` / `hors_horaire` / `surge`) → we already
 *    quoted this address and delivery is genuinely unavailable. Re-entering the
 *    same address won't change `hors_horaire` (resto closed); for `hors_zone` /
 *    `surge` the address-first flow already surfaced the message + CTA. Keep the
 *    current inert-disabled behaviour (no sheet).
 *
 * Splitting this into a pure predicate (vitest-pinned, node env) keeps the
 * toggle UI free of verdict re-narrowing — same architectural split as
 * `decideInitialMode` / `decideAddressFirstAction`.
 */
import type { DeliveryQuoteVerdict } from "@/lib/address-first";

/** What the Livraison button's onClick should do given the current verdict. */
export type LivraisonTapAction =
  /** Verdict is known + deliverable → normal mode switch (button is enabled). */
  | { kind: "switch-mode" }
  /** Verdict unknown (null) → open the address sheet to capture one. */
  | { kind: "open-address-sheet" }
  /** Known refusal verdict → inert (the resto is closed / address out of zone). */
  | { kind: "noop" };

/**
 * Decide the Livraison button's tap behaviour.
 *
 * Branch map:
 *  - deliverable verdict → `switch-mode` (the button is enabled anyway, this is
 *    the nominal click).
 *  - `null` verdict → `open-address-sheet` (address unknown — invite, do NOT
 *    render a dead disabled button).
 *  - refusal verdict (`hors_zone` / `hors_horaire` / `surge`) → `noop` (delivery
 *    is genuinely unavailable for the already-quoted address).
 */
export function decideLivraisonTap(
  verdict: DeliveryQuoteVerdict | null,
): LivraisonTapAction {
  if (verdict === null) return { kind: "open-address-sheet" };
  if (verdict.deliverable) return { kind: "switch-mode" };
  return { kind: "noop" };
}
